import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from '@supabase/supabase-js';
import { getAllSeasonIds, seasonIdToCode } from '../lib/seasons';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const NHL = 'https://api-web.nhle.com/v1';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; puck-island-sync/1.0)' };

// team_season_stats.team_id has a FK to teams(id), which only lists the 32
// currently-active franchises. Relocated/renamed franchises are folded into
// their current successor so historical rows don't violate the FK.
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
  // Relocated / renamed franchises -> current successor
  'Atlanta Thrashers': 'wpg',
  'Phoenix Coyotes': 'uta',
  'Arizona Coyotes': 'uta',
};

async function nhlFetch(url: string) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`NHL API ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  const { seasons } = await nhlFetch(`${NHL}/standings-season`);
  const endDateBySeasonCode: Record<number, string> = {};
  for (const s of seasons) endDateBySeasonCode[s.id] = s.standingsEnd;

  const seasonIds = getAllSeasonIds(2000).reverse(); // oldest -> newest
  let total = 0;

  for (const seasonId of seasonIds) {
    const code = seasonIdToCode(seasonId);
    const endDate = endDateBySeasonCode[code];
    if (!endDate) {
      console.log(`${seasonId}: no standings-season entry, skipping`);
      continue;
    }

    try {
      const { standings } = await nhlFetch(`${NHL}/standings/${endDate}`);
      const rows = standings
        .filter((s: any) => s.gamesPlayed > 0)
        .map((s: any) => {
          const abbr = TEAM_NAME_TO_ABBREV[s.teamName?.default];
          if (!abbr) return null;
          return {
            team_id:   abbr,
            season_id: seasonId,
            gp:        s.gamesPlayed,
            wins:      s.wins,
            losses:    s.losses,
            otl:       s.otLosses ?? 0,
            gf:        s.goalFor,
            ga:        s.goalAgainst,
          };
        })
        .filter(Boolean);

      if (rows.length > 0) {
        const { error } = await supabase.from('team_season_stats').upsert(rows, {
          onConflict: 'team_id,season_id',
        });
        if (error) console.error(`${seasonId}:`, error);
        else { total += rows.length; console.log(`${seasonId}: ${rows.length} teams`); }
      }
    } catch (err) {
      console.error(`${seasonId}:`, err);
    }
  }

  console.log(`Team-season rows upserted: ${total}`);
}

main();
