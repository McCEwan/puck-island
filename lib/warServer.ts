import { createClient } from '@supabase/supabase-js';
import { per60Min, deriveWinsPerGoal, replacementRate60, gar, finishingGAR, WARComponents } from './war';

// Server-only: uses the service key, never import this from client components.
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

export type SeasonWARResult = {
  winsPerGoal: number;
  players: Record<number, WARComponents>;
};

export async function computeSeasonWAR(season: string): Promise<SeasonWARResult> {
  const mpSeason = parseInt(season.split('-')[0]);

  const { data: basicRows } = await supabase
    .from('player_season_stats')
    .select(`player_id, gp, g, a, pts, shots, players!inner (position)`)
    .neq('players.position', 'G')
    .eq('season_id', season);

  if (!basicRows || basicRows.length === 0) return { winsPerGoal: 0, players: {} };

  const basicByPlayer = new Map<number, { gp: number; g: number; a: number; pts: number; shots: number; position: string }>();
  for (const r of basicRows as any[]) {
    const existing = basicByPlayer.get(r.player_id);
    if (existing) {
      existing.gp    += r.gp;
      existing.g     += r.g;
      existing.a     += r.a;
      existing.pts   += r.pts;
      existing.shots += r.shots;
    } else {
      basicByPlayer.set(r.player_id, { gp: r.gp, g: r.g, a: r.a, pts: r.pts, shots: r.shots, position: r.players.position });
    }
  }

  const qualified = [...basicByPlayer.entries()].filter(([, b]) => b.gp >= 30);
  if (qualified.length === 0) return { winsPerGoal: 0, players: {} };
  const qualifiedIds = new Set(qualified.map(([id]) => id));

  const { data: mpRaw } = await supabase
    .from('mp_skater_stats')
    .select('*')
    .eq('season', mpSeason)
    .in('situation', ['5on5', '5on4', '4on5', 'all']);

  const mp5v5Map = new Map((mpRaw ?? []).filter((s: any) => s.situation === '5on5' && qualifiedIds.has(s.player_id) && s.icetime >= 200).map((s: any) => [s.player_id, s]));
  const mpAllMap = new Map((mpRaw ?? []).filter((s: any) => s.situation === 'all'  && qualifiedIds.has(s.player_id)).map((s: any) => [s.player_id, s]));
  const mpPPMap  = new Map((mpRaw ?? []).filter((s: any) =>
    s.situation === '5on4' && qualifiedIds.has(s.player_id) && s.games_played > 0 && (s.icetime / s.games_played) > 30
  ).map((s: any) => [s.player_id, s]));
  const mpPKMap  = new Map((mpRaw ?? []).filter((s: any) =>
    s.situation === '4on5' && qualifiedIds.has(s.player_id) && s.games_played > 0 && (s.icetime / s.games_played) > 30
  ).map((s: any) => [s.player_id, s]));

  const { data: teamSeasons } = await supabase.from('team_season_stats').select('gp, wins, gf, ga');
  const winsPerGoal = deriveWinsPerGoal(teamSeasons ?? []);

  const allEntries = [...mpAllMap.values()] as any[];
  const totalShotsAll = allEntries.reduce((s, r) => s + (basicByPlayer.get(r.player_id)?.shots ?? 0), 0);
  const totalGoalsAll = allEntries.reduce((s, r) => s + (basicByPlayer.get(r.player_id)?.g ?? 0), 0);
  const totalIXGAll   = allEntries.reduce((s, r) => s + (r.individual_xg ?? 0), 0);
  const leagueAvgFinishingRate = totalShotsAll > 0 ? (totalGoalsAll - totalIXGAll) / totalShotsAll : 0;

  function buildReplacementRates(entries: any[]) {
    const xgf60s = entries.map(s => ({ icetimeSeconds: s.icetime, value60: per60Min(s.xgf, s.icetime) }));
    const xga60s = entries.map(s => ({ icetimeSeconds: s.icetime, value60: per60Min(s.xga, s.icetime) }));
    return {
      xgf60: replacementRate60(xgf60s),
      xga60: replacementRate60(xga60s),
    };
  }

  const forwardEntries5v5 = [...mp5v5Map.entries()].filter(([id]) => basicByPlayer.get(id)?.position !== 'D').map(([, s]) => s);
  const dmenEntries5v5    = [...mp5v5Map.entries()].filter(([id]) => basicByPlayer.get(id)?.position === 'D').map(([, s]) => s);
  const replF = buildReplacementRates(forwardEntries5v5);
  const replD = buildReplacementRates(dmenEntries5v5);

  const ppEntries = [...mpPPMap.values()] as any[];
  const pkEntries = [...mpPKMap.values()] as any[];
  const replPP = { xgf60: replacementRate60(ppEntries.map(s => ({ icetimeSeconds: s.icetime, value60: per60Min(s.xgf, s.icetime) }))) };
  const replPK = { xga60: replacementRate60(pkEntries.map(s => ({ icetimeSeconds: s.icetime, value60: per60Min(s.xga, s.icetime) }))) };

  function buildResult(playerId: number): WARComponents {
    const basic = basicByPlayer.get(playerId)!;
    const isD   = basic.position === 'D';
    const repl5v5 = isD ? replD : replF;

    const s5v5 = mp5v5Map.get(playerId) as any;
    let offenseGAR = 0, defenseGAR = 0;
    if (s5v5) {
      offenseGAR = gar(per60Min(s5v5.xgf, s5v5.icetime), repl5v5.xgf60, s5v5.icetime);
      defenseGAR = gar(per60Min(s5v5.xga, s5v5.icetime), repl5v5.xga60, s5v5.icetime, true);
    }

    const sPP = mpPPMap.get(playerId) as any;
    const ppGARval = sPP ? gar(per60Min(sPP.xgf, sPP.icetime), replPP.xgf60, sPP.icetime) : 0;

    const sPK = mpPKMap.get(playerId) as any;
    const pkGARval = sPK ? gar(per60Min(sPK.xga, sPK.icetime), replPK.xga60, sPK.icetime, true) : 0;

    const sAll = mpAllMap.get(playerId) as any;
    const fGAR = sAll ? finishingGAR(basic.g, sAll.individual_xg ?? 0, basic.shots, leagueAvgFinishingRate) : 0;

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const totalGAR = offenseGAR + defenseGAR + ppGARval + pkGARval + fGAR;

    return {
      offenseGAR:   round2(offenseGAR),
      defenseGAR:   round2(defenseGAR),
      ppGAR:        round2(ppGARval),
      pkGAR:        round2(pkGARval),
      finishingGAR: round2(fGAR),
      totalGAR:     round2(totalGAR),
      war:          round2(totalGAR * winsPerGoal),
    };
  }

  const players: Record<number, WARComponents> = {};
  for (const id of qualifiedIds) players[id] = buildResult(id);

  return { winsPerGoal, players };
}
