import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const HEADERS  = { 'User-Agent': 'Mozilla/5.0 (compatible; puck-island-sync/1.0)' };

// Only re-sync the two most recent seasons so traded players get correct stints
const TARGET_SEASONS = [
  { id: '2025-26', code: 20252026 },
  { id: '2024-25', code: 20242025 },
];

async function main() {
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
          (t: any) => t.season === season.code && t.leagueAbbrev === 'NHL'
        );
        if (stints.length === 0) continue;

        for (const s of stints) {
          const abbr = s.teamAbbrevs?.toLowerCase() ?? null;
          // Skip aggregate rows like "VAN/MIN"
          if (abbr && abbr.includes('/')) continue;

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
