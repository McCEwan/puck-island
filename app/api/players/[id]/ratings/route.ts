import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

function per60(stat: number, icetime: number) {
  return icetime > 0 ? (stat / icetime) * 60 : 0;
}

function percentileRank(value: number, values: number[]) {
  if (values.length <= 1) return 100;
  const sorted = [...values].sort((a, b) => a - b);
  const below  = sorted.filter(v => v < value).length;
  return Math.round((below / (values.length - 1)) * 100);
}

function inversePercentileRank(value: number, values: number[]) {
  return 100 - percentileRank(value, values);
}

const normalizeMP = (s: any) => {
  const gp = s.games_played || 1;
  return {
    ...s,
    xgf:             s.xgf             / gp,
    xga:             s.xga             / gp,
    ca:              s.ca              / gp,
    sca:             s.sca             / gp,
    shots_blocked:   s.shots_blocked   / gp,
    primary_assists: s.primary_assists / gp,
    individual_xg:   s.individual_xg   / gp,
    points:          s.points          / gp,
    icetime:         s.icetime         / gp,
  };
};

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/players/[id]/ratings'>) {
  const { id }    = await ctx.params;
  const { searchParams } = new URL(_req.url);
  const season    = searchParams.get('season') ?? '2025-26';
  const mpSeason  = parseInt(season.split('-')[0]);

  const { data: player } = await supabase
    .from('players')
    .select('position')
    .eq('id', id)
    .single();

  if (!player) return Response.json({ error: 'Player not found' }, { status: 404 });

  const isD = player.position === 'D';

  const { data: allBasic } = await supabase
    .from('player_season_stats')
    .select(`player_id, gp, g, a, pts, shots, players!inner (position)`)
    .neq('players.position', 'G')
    .eq('season_id', season)
    .gte('gp', 30);

  if (!allBasic) return Response.json({ error: 'No stats' }, { status: 500 });

  const posGroupBasic = allBasic.filter((s: any) =>
    isD ? s.players.position === 'D' : s.players.position !== 'D'
  );

  const playerIdsInGroup = new Set(posGroupBasic.map((s: any) => s.player_id));
  const basicMap = new Map(posGroupBasic.map((s: any) => [s.player_id, s]));

  // Fetch all three situations in one query
  const { data: allMPRaw } = await supabase
    .from('mp_skater_stats')
    .select('*')
    .eq('season', mpSeason)
    .in('situation', ['5on5', '5on4', '4on5']);

  const posGroupMP5v5 = (allMPRaw ?? []).filter((s: any) =>
    s.situation === '5on5' && playerIdsInGroup.has(s.player_id) && s.icetime >= 200
  );
  const posGroupMPPP = (allMPRaw ?? []).filter((s: any) =>
    s.situation === '5on4' &&
    playerIdsInGroup.has(s.player_id) &&
    s.games_played > 0 &&
    (s.icetime / s.games_played) > 30   // > 30 sec PP ice per game
  );
  const posGroupMPPK = (allMPRaw ?? []).filter((s: any) =>
    s.situation === '4on5' &&
    playerIdsInGroup.has(s.player_id) &&
    s.games_played > 0 &&
    (s.icetime / s.games_played) > 30   // > 30 sec PK ice per game
  );

  // ── 5v5 ──
  const entries5v5 = posGroupMP5v5
    .map((mp: any) => ({ mp: normalizeMP(mp), basic: basicMap.get(mp.player_id) }))
    .filter(({ basic }: any) => basic !== undefined);

  const target5v5Idx = entries5v5.findIndex(({ mp }: any) => mp.player_id === parseInt(id));

  let offense: number | null = null;
  let defense: number | null = null;
  let overall: number | null = null;

  if (entries5v5.length > 10 && target5v5Idx !== -1) {
    const pts5v5s   = entries5v5.map(({ mp }: any) => mp.points);
    const paPGs     = entries5v5.map(({ mp }: any) => mp.primary_assists);
    const xgf60s    = entries5v5.map(({ mp }: any) => per60(mp.xgf, mp.icetime));
    const ixg60s    = entries5v5.map(({ mp }: any) => per60(mp.individual_xg, mp.icetime));
    const xga60s    = entries5v5.map(({ mp }: any) => per60(mp.xga,          mp.icetime));
    const ca60s     = entries5v5.map(({ mp }: any) => per60(mp.ca,           mp.icetime));
    const hdxa60s   = entries5v5.map(({ mp }: any) => per60(mp.sca,          mp.icetime));
    const blk60s    = entries5v5.map(({ mp }: any) => per60(mp.shots_blocked, mp.icetime));
    const relXGPcts = entries5v5.map(({ mp }: any) =>
      (mp.on_ice_xg_pct ?? 50) - (mp.off_ice_xg_pct ?? 50)
    );

    const offenseRaw = entries5v5.map((_: any, i: number) =>
      percentileRank(paPGs[i],   paPGs)   * 0.35 +
      percentileRank(xgf60s[i],  xgf60s)  * 0.30 +
      percentileRank(pts5v5s[i], pts5v5s) * 0.20 +
      percentileRank(ixg60s[i],  ixg60s)  * 0.15
    );

    const defenseRaw = entries5v5.map((_: any, i: number) => isD
      ? inversePercentileRank(xga60s[i],  xga60s)   * 0.35 +
        inversePercentileRank(ca60s[i],   ca60s)    * 0.25 +
        inversePercentileRank(hdxa60s[i], hdxa60s)  * 0.20 +
        percentileRank(relXGPcts[i], relXGPcts)     * 0.10 +
        percentileRank(blk60s[i],    blk60s)        * 0.10
      : inversePercentileRank(xga60s[i],  xga60s)   * 0.40 +
        inversePercentileRank(ca60s[i],   ca60s)    * 0.30 +
        inversePercentileRank(hdxa60s[i], hdxa60s)  * 0.20 +
        percentileRank(relXGPcts[i], relXGPcts)     * 0.10
    );

    const overallRaw = entries5v5.map((_: any, i: number) => isD
      ? offenseRaw[i] * 0.35 + defenseRaw[i] * 0.65
      : offenseRaw[i] * 0.80 + defenseRaw[i] * 0.20
    );

    const i = target5v5Idx;
    offense = Math.round(percentileRank(offenseRaw[i], offenseRaw));
    defense = Math.round(percentileRank(defenseRaw[i], defenseRaw));
    overall = Math.round(percentileRank(overallRaw[i], overallRaw));
  }

  // ── Power Play ──
  let powerPlay: number | null = null;
  const targetPPIdx = posGroupMPPP.findIndex((s: any) => s.player_id === parseInt(id));

  if (posGroupMPPP.length > 10 && targetPPIdx !== -1) {
    const normPP    = posGroupMPPP.map(normalizeMP);
    const ppPts60s  = normPP.map((mp: any) => per60(mp.points,         mp.icetime));
    const ppXgf60s  = normPP.map((mp: any) => per60(mp.xgf,            mp.icetime));
    const ppPA60s   = normPP.map((mp: any) => per60(mp.primary_assists, mp.icetime));

    const ppRaw = normPP.map((_: any, i: number) =>
      percentileRank(ppPts60s[i], ppPts60s) * 0.40 +
      percentileRank(ppXgf60s[i], ppXgf60s) * 0.35 +
      percentileRank(ppPA60s[i],  ppPA60s)  * 0.25
    );

    powerPlay = Math.round(percentileRank(ppRaw[targetPPIdx], ppRaw));
  }

  // ── Penalty Kill ──
  let penaltyKill: number | null = null;
  const targetPKIdx = posGroupMPPK.findIndex((s: any) => s.player_id === parseInt(id));

  if (posGroupMPPK.length > 10 && targetPKIdx !== -1) {
    const normPK    = posGroupMPPK.map(normalizeMP);
    const pkXga60s  = normPK.map((mp: any) => per60(mp.xga, mp.icetime));
    const pkCa60s   = normPK.map((mp: any) => per60(mp.ca,  mp.icetime));
    const pkHdxa60s = normPK.map((mp: any) => per60(mp.sca, mp.icetime));

    const pkRaw = normPK.map((_: any, i: number) =>
      inversePercentileRank(pkXga60s[i],  pkXga60s)  * 0.45 +
      inversePercentileRank(pkCa60s[i],   pkCa60s)   * 0.30 +
      inversePercentileRank(pkHdxa60s[i], pkHdxa60s) * 0.25
    );

    penaltyKill = Math.round(percentileRank(pkRaw[targetPKIdx], pkRaw));
  }

  if (offense === null) {
    return Response.json({ error: 'Player not in qualified pool' }, { status: 404 });
  }

  return Response.json({
    position:      player.position,
    positionGroup: isD ? 'defensemen' : 'forwards',
    groupSize:     entries5v5.length,
    hasAdvanced:   true,
    percentiles:   { overall, offense, defense, powerPlay, penaltyKill },
  });
}
