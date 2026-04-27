import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from '@supabase/supabase-js';

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
  'Toronto Maple Leafs': 'tor', 'Utah Hockey Club': 'uta', 'Vancouver Canucks': 'van',
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

const SEASONS = [
  { id: '2000-01', label: '2000-01', code: 20002001, start: 2000, end: 2001 },
  { id: '2001-02', label: '2001-02', code: 20012002, start: 2001, end: 2002 },
  { id: '2002-03', label: '2002-03', code: 20022003, start: 2002, end: 2003 },
  { id: '2003-04', label: '2003-04', code: 20032004, start: 2003, end: 2004 },
  { id: '2005-06', label: '2005-06', code: 20052006, start: 2005, end: 2006 },
  { id: '2006-07', label: '2006-07', code: 20062007, start: 2006, end: 2007 },
  { id: '2007-08', label: '2007-08', code: 20072008, start: 2007, end: 2008 },
  { id: '2008-09', label: '2008-09', code: 20082009, start: 2008, end: 2009 },
  { id: '2009-10', label: '2009-10', code: 20092010, start: 2009, end: 2010 },
  { id: '2010-11', label: '2010-11', code: 20102011, start: 2010, end: 2011 },
  { id: '2011-12', label: '2011-12', code: 20112012, start: 2011, end: 2012 },
  { id: '2012-13', label: '2012-13', code: 20122013, start: 2012, end: 2013 },
  { id: '2013-14', label: '2013-14', code: 20132014, start: 2013, end: 2014 },
  { id: '2014-15', label: '2014-15', code: 20142015, start: 2014, end: 2015 },
  { id: '2015-16', label: '2015-16', code: 20152016, start: 2015, end: 2016 },
  { id: '2016-17', label: '2016-17', code: 20162017, start: 2016, end: 2017 },
  { id: '2017-18', label: '2017-18', code: 20172018, start: 2017, end: 2018 },
  { id: '2018-19', label: '2018-19', code: 20182019, start: 2018, end: 2019 },
  { id: '2019-20', label: '2019-20', code: 20192020, start: 2019, end: 2020 },
  { id: '2020-21', label: '2020-21', code: 20202021, start: 2020, end: 2021 },
  { id: '2021-22', label: '2021-22', code: 20212022, start: 2021, end: 2022 },
  { id: '2022-23', label: '2022-23', code: 20222023, start: 2022, end: 2023 },
  { id: '2023-24', label: '2023-24', code: 20232024, start: 2023, end: 2024 },
  { id: '2024-25', label: '2024-25', code: 20242025, start: 2024, end: 2025 },
  { id: '2025-26', label: '2025-26', code: 20252026, start: 2025, end: 2026 },
];

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
