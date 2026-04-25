import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const NHL = 'https://api-web.nhle.com/v1';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; puck-island-sync/1.0)' };

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
      const all  = [...(data.forwards??[]), ...(data.defensemen??[]), ...(data.goalies??[])];
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

async function syncSeasons() {
  const { error } = await supabase.from('seasons').upsert({
    id: '2024-25',
    label: '2024-25',
    start_year: 2024,
    end_year: 2025,
  }, { onConflict: 'id' });
  console.log(error ?? 'Season synced');
}

async function syncAllPlayerStats() {
  const { data: players } = await supabase.from('players').select('id');
  if (!players) return;

  console.log(`Syncing stats for ${players.length} players...`);
  let success = 0;

  for (const player of players) {
    try {
      const res = await fetch(`https://api-web.nhle.com/v1/player/${player.id}/landing`, { headers: HEADERS });
      const data = await res.json();
      const season = data.seasonTotals?.find(
        (s: any) => s.season === 20242025 && s.leagueAbbrev === 'NHL'
      );
      if (!season) continue;

      const row = {
        player_id:    player.id,
        team_id:      season.teamAbbrevs?.toLowerCase(),
        season_id:    '2024-25',
        gp:           season.gamesPlayed ?? 0,
        g:            season.goals ?? 0,
        a:            season.assists ?? 0,
        pts:          season.points ?? 0,
        shots:        season.shots ?? 0,
        pim:          season.pim ?? 0,
        pp_goals:     season.powerPlayGoals ?? 0,
        pp_points:    season.powerPlayPoints ?? 0,
        gw_goals:     season.gameWinningGoals ?? 0,
        plus_minus:   season.plusMinus ?? 0,
        toi_per_game: season.avgToi ?? null,
      };

      await supabase.from('player_season_stats').upsert(row, {
        onConflict: 'player_id,team_id,season_id'
      });
      success++;
    } catch (e) {
      // skip players with no data
    }
  }
  console.log(`Stats synced: ${success}/${players.length}`);
}

(async () => {
  await syncTeams();
  await syncPlayers();
  await syncSeasons();
  await syncAllPlayerStats();
})();
