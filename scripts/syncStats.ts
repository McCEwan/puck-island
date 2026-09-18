import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from '@supabase/supabase-js';
import { getCurrentSeasonId, getPreviousSeasonId, seasonIdToCode } from '../lib/seasons';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const NHL      = 'https://api-web.nhle.com/v1';
const HEADERS  = { 'User-Agent': 'Mozilla/5.0 (compatible; puck-island-sync/1.0)' };

const ALL_TEAMS = [
  'TOR','EDM','COL','NYR','VAN','BOS','CAR','DAL','FLA','VGK',
  'NJD','SEA','MIN','PIT','LAK','WPG','ANA','OTT','CBJ','BUF',
  'MTL','DET','CGY','STL','NSH','SJS','PHI','CHI','UTA','TBL','NYI','WSH'
];

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
  'Toronto Maple Leafs': 'tor', 'Utah Hockey Club': 'uta', 'Vancouver Canucks': 'van',
  'Vegas Golden Knights': 'vgk', 'Washington Capitals': 'wsh', 'Winnipeg Jets': 'wpg',
};

// Only re-sync the two most recent seasons so traded players get correct stints.
// Computed from today's date so a new season (e.g. 2026-27) is picked up the
// day it starts, with no code change needed.
const CURRENT_SEASON_ID = getCurrentSeasonId();
const TARGET_SEASONS = [CURRENT_SEASON_ID, getPreviousSeasonId(CURRENT_SEASON_ID)].map(id => ({
  id,
  code: seasonIdToCode(id),
}));

async function syncTeams() {
  const res = await fetch(`${NHL}/standings/now`, { headers: HEADERS });
  const { standings } = await res.json();
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

// Refreshes rosters daily so rookies/call-ups and trades show up without a
// manual full sync.ts run.
async function syncPlayers() {
  let total = 0;
  for (const abbr of ALL_TEAMS) {
    try {
      const res  = await fetch(`${NHL}/roster/${abbr}/current`, { headers: HEADERS });
      const data = await res.json();
      const all  = [...(data.forwards ?? []), ...(data.defensemen ?? [])];
      const rows = all.map((p: any) => ({
        id:              p.id,
        full_name:       `${p.firstName.default} ${p.lastName.default}`,
        position:        p.positionCode,
        current_team_id: abbr.toLowerCase(),
      }));
      const { error } = await supabase.from('players').upsert(rows, { onConflict: 'id' });
      if (error) console.error(`${abbr}:`, error);
      else total += rows.length;
    } catch (err) {
      console.error(`${abbr}:`, err);
    }
  }
  console.log(`Players synced: ${total}`);
}

async function main() {
  await syncTeams();
  await syncPlayers();

  const { data: players } = await supabase.from('players').select('id');
  if (!players) return;

  console.log(`Re-syncing stats for ${players.length} players (current seasons only)…`);
  let total = 0;

  for (const player of players) {
    try {
      const res = await fetch(
        `https://api-web.nhle.com/v1/player/${player.id}/landing`,
        { headers: HEADERS }
      );
      const data = await res.json();
      if (!data.seasonTotals) continue;

      const rows: any[] = [];
      for (const season of TARGET_SEASONS) {
        const stints = data.seasonTotals.filter(
          (t: any) => t.season === season.code && t.leagueAbbrev === 'NHL' && t.gameTypeId === 2
        );
        if (stints.length === 0) continue;

        for (const s of stints) {
          const abbr = TEAM_NAME_TO_ABBREV[s.teamName?.default] ?? null;
          if (!abbr) continue;

          rows.push({
            player_id:    player.id,
            team_id:      abbr,
            season_id:    season.id,
            gp:           s.gamesPlayed     ?? 0,
            g:            s.goals           ?? 0,
            a:            s.assists         ?? 0,
            pts:          s.points          ?? 0,
            shots:        s.shots           ?? 0,
            pim:          s.pim             ?? 0,
            pp_goals:     s.powerPlayGoals  ?? 0,
            pp_points:    s.powerPlayPoints ?? 0,
            gw_goals:     s.gameWinningGoals ?? 0,
            plus_minus:   s.plusMinus       ?? 0,
            toi_per_game: s.avgToi          ?? null,
          });
        }
      }

      if (rows.length > 0) {
        await supabase.from('player_season_stats').upsert(rows, {
          onConflict: 'player_id,team_id,season_id'
        });
        total += rows.length;
      }
    } catch {
      // skip players with errors
    }
  }

  console.log(`Stats rows upserted: ${total}`);
}

main();
