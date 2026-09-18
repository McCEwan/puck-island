import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from '@supabase/supabase-js';
import { getAllSeasonIds, seasonIdToCode } from '../lib/seasons';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const NHL = 'https://api-web.nhle.com/v1';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; puck-island-sync/1.0)' };

const TEAM_NAME_TO_ABBREV: Record<string, string> = {
  'Anaheim Ducks': 'ana', 'Boston Bruins': 'bos', 'Buffalo Sabres': 'buf',
  'Calgary Flames': 'cgy', 'Carolina Hurricanes': 'car', 'Chicago Blackhawks': 'chi',
  'Colorado Avalanche': 'col', 'Columbus Blue Jackets': 'cbj', 'Dallas Stars': 'dal',
  'Detroit Red Wings': 'det', 'Edmonton Oilers': 'edm', 'Florida Panthers': 'fla',
  'Los Angeles Kings': 'lak', 'Minnesota Wild': 'min', 'Montréal Canadiens': 'mtl',
  'Montreal Canadiens': 'mtl', 'Nashville Predators': 'nsh', 'New Jersey Devils': 'njd',
  'New York Islanders': 'nyi', 'New York Rangers': 'nyr', 'Ottawa Senators': 'ott',
  'Philadelphia Flyers': 'phi', 'Pittsburgh Penguins': 'pit', 'San Jose Sharks': 'sjs',
  'Seattle Kraken': 'sea', 'St. Louis Blues': 'stl', 'Tampa Bay Lightning': 'tbl',
  'Toronto Maple Leafs': 'tor', 'Utah Hockey Club': 'uta', 'Utah Mammoth': 'uta', 'Vancouver Canucks': 'van',
  'Vegas Golden Knights': 'vgk', 'Washington Capitals': 'wsh', 'Winnipeg Jets': 'wpg',
};

const ALL_TEAMS = [
  'TOR','EDM','COL','NYR','VAN','BOS','CAR','DAL','FLA','VGK',
  'NJD','SEA','MIN','PIT','LAK','WPG','ANA','OTT','CBJ','BUF',
  'MTL','DET','CGY','STL','NSH','SJS','PHI','CHI','UTA','TBL','NYI','WSH'
];

async function nhlFetch(url: string) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`NHL API ${res.status} for ${url}`);
  return res.json();
}

async function syncTeams() {
  const { standings } = await nhlFetch(`${NHL}/standings/now`);
  const rows = standings.map((s: any) => ({
    id:           s.teamAbbrev.default.toLowerCase(),
    name:         s.teamName.default,
    abbreviation: s.teamAbbrev.default,
    city:         s.placeName.default,
    conference:   s.conferenceName,
    division:     s.divisionName,
  }));
  const { error } = await supabase.from('teams').upsert(rows, { onConflict: 'id' });
  console.log(error ?? `Teams synced: ${rows.length}`);
}

async function syncPlayers() {
  let total = 0;
  for (const abbr of ALL_TEAMS) {
    try {
      const data = await nhlFetch(`${NHL}/roster/${abbr}/current`);
      const all  = [...(data.forwards??[]), ...(data.defensemen??[])];
      const rows = all.map((p: any) => ({
        id:              p.id,
        full_name:       `${p.firstName.default} ${p.lastName.default}`,
        position:        p.positionCode,
        current_team_id: abbr.toLowerCase(),
      }));
      const { error } = await supabase.from('players').upsert(rows, { onConflict: 'id' });
      if (error) console.error(`${abbr}:`, error);
      else { total += rows.length; console.log(`${abbr}: ${rows.length} players`); }
    } catch (err) {
      console.error(`${abbr}: ${err}`);
    }
  }
  console.log(`Players synced: ${total}`);
}

// Generated from the current date, so a newly started season (e.g. 2026-27)
// is picked up automatically without editing this file.
const SEASONS = getAllSeasonIds().reverse().map(id => {
  const startYear = parseInt(id.split('-')[0], 10);
  return { id, label: id, code: seasonIdToCode(id), start: startYear, end: startYear + 1 };
});

async function syncSeasons() {
  const rows = SEASONS.map(s => ({
    id: s.id, label: s.label, start_year: s.start, end_year: s.end
  }));
  const { error } = await supabase.from('seasons').upsert(rows, { onConflict: 'id' });
  console.log(error ?? `Seasons synced: ${rows.length}`);
}

async function syncAllPlayerStats() {
  const { data: players } = await supabase.from('players').select('id');
  if (!players) return;

  console.log(`Syncing stats for ${players.length} players across ${SEASONS.length} seasons...`);
  let total = 0;

  for (const player of players) {
    try {
      const res = await fetch(`https://api-web.nhle.com/v1/player/${player.id}/landing`, { headers: HEADERS });
      const data = await res.json();
      if (!data.seasonTotals) continue;

      const rows = [];
      for (const season of SEASONS) {
        // Regular-season NHL stints only (gameTypeId 2), one row per team
        const stints = data.seasonTotals.filter(
          (t: any) => t.season === season.code && t.leagueAbbrev === 'NHL' && t.gameTypeId === 2
        );
        if (stints.length === 0) continue;

        for (const s of stints) {
          const abbr = TEAM_NAME_TO_ABBREV[s.teamName?.default] ?? null;
          if (!abbr) continue; // skip if team name not recognised

          rows.push({
            player_id:    player.id,
            team_id:      abbr,
            season_id:    season.id,
            gp:           s.gamesPlayed ?? 0,
            g:            s.goals ?? 0,
            a:            s.assists ?? 0,
            pts:          s.points ?? 0,
            shots:        s.shots ?? 0,
            pim:          s.pim ?? 0,
            pp_goals:     s.powerPlayGoals ?? 0,
            pp_points:    s.powerPlayPoints ?? 0,
            gw_goals:     s.gameWinningGoals ?? 0,
            plus_minus:   s.plusMinus ?? 0,
            toi_per_game: s.avgToi ?? null,
          });
        }
      }

      if (rows.length > 0) {
        await supabase.from('player_season_stats').upsert(rows, {
          onConflict: 'player_id,team_id,season_id'
        });
        total += rows.length;
      }
    } catch (e) {
      // skip players with errors
    }
  }
  console.log(`Total stat rows synced: ${total}`);
}

(async () => {
  await syncTeams();
  await syncPlayers();
  await syncSeasons();
  await syncAllPlayerStats();
})();
