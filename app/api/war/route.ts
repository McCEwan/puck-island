import { createClient } from '@supabase/supabase-js';
import { getCurrentSeasonId } from '@/lib/seasons';
import { per60Min, deriveWinsPerGoal, replacementRate60, gar, finishingGAR } from '@/lib/war';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const season   = searchParams.get('season') ?? getCurrentSeasonId();
  const mpSeason = parseInt(season.split('-')[0]);

  // Box score, aggregated across team stints (a traded player has one row
  // per team) so goals/shots/assists reflect the whole season.
  const { data: basicRows } = await supabase
    .from('player_season_stats')
    .select(`player_id, gp, g, a, pts, shots, players!inner (position)`)
    .neq('players.position', 'G')
    .eq('season_id', season);

  if (!basicRows || basicRows.length === 0) return Response.json({});

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

  // Qualify on total season GP, matching the ratings/bulk convention.
  const qualified = [...basicByPlayer.entries()].filter(([, b]) => b.gp >= 30);
  if (qualified.length === 0) return Response.json({});
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

  // League-average finishing rate this season, for Bayesian shrinkage.
  const allEntries = [...mpAllMap.values()] as any[];
  const totalShotsAll = allEntries.reduce((s, r) => s + (basicByPlayer.get(r.player_id)?.shots ?? 0), 0);
  const totalGoalsAll = allEntries.reduce((s, r) => s + (basicByPlayer.get(r.player_id)?.g ?? 0), 0);
  const totalIXGAll   = allEntries.reduce((s, r) => s + (r.individual_xg ?? 0), 0);
  const leagueAvgFinishingRate = totalShotsAll > 0 ? (totalGoalsAll - totalIXGAll) / totalShotsAll : 0;

  function buildReplacementRates(entries: any[], isD: boolean) {
    const xgf60s = entries.map(s => ({ icetimeSeconds: s.icetime, value60: per60Min(s.xgf, s.icetime) }));
    const xga60s = entries.map(s => ({ icetimeSeconds: s.icetime, value60: per60Min(s.xga, s.icetime) }));
    return {
      xgf60: replacementRate60(xgf60s),
      xga60: replacementRate60(xga60s),
    };
  }

  const forwardIds5v5 = [...mp5v5Map.entries()].filter(([id]) => basicByPlayer.get(id)?.position !== 'D');
  const dmenIds5v5    = [...mp5v5Map.entries()].filter(([id]) => basicByPlayer.get(id)?.position === 'D');
  const replF = buildReplacementRates(forwardIds5v5.map(([, s]) => s), false);
  const replD = buildReplacementRates(dmenIds5v5.map(([, s]) => s), true);

  const ppEntries = [...mpPPMap.values()] as any[];
  const pkEntries = [...mpPKMap.values()] as any[];
  const replPP = { xgf60: replacementRate60(ppEntries.map(s => ({ icetimeSeconds: s.icetime, value60: per60Min(s.xgf, s.icetime) }))) };
  const replPK = { xga60: replacementRate60(pkEntries.map(s => ({ icetimeSeconds: s.icetime, value60: per60Min(s.xga, s.icetime) }))) };

  const results: Record<number, ReturnType<typeof buildResult>> = {};

  function buildResult(playerId: number) {
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
    const ppGAR = sPP ? gar(per60Min(sPP.xgf, sPP.icetime), replPP.xgf60, sPP.icetime) : 0;

    const sPK = mpPKMap.get(playerId) as any;
    const pkGAR = sPK ? gar(per60Min(sPK.xga, sPK.icetime), replPK.xga60, sPK.icetime, true) : 0;

    const sAll = mpAllMap.get(playerId) as any;
    const fGAR = sAll ? finishingGAR(basic.g, sAll.individual_xg ?? 0, basic.shots, leagueAvgFinishingRate) : 0;

    const totalGAR = offenseGAR + defenseGAR + ppGAR + pkGAR + fGAR;

    return {
      offenseGAR:   Math.round(offenseGAR * 100) / 100,
      defenseGAR:   Math.round(defenseGAR * 100) / 100,
      ppGAR:        Math.round(ppGAR * 100) / 100,
      pkGAR:        Math.round(pkGAR * 100) / 100,
      finishingGAR: Math.round(fGAR * 100) / 100,
      totalGAR:     Math.round(totalGAR * 100) / 100,
      war:          Math.round(totalGAR * winsPerGoal * 100) / 100,
    };
  }

  for (const id of qualifiedIds) {
    results[id] = buildResult(id);
  }

  return Response.json({ season, winsPerGoal: Math.round(winsPerGoal * 10000) / 10000, players: results });
}
