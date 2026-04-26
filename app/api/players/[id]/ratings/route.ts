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

const normalize = (s: any) => {
  const gp = s.games_played || 1;
  return {
    ...s,
    xga:           s.xga           / gp,
    ca:            s.ca            / gp,
    sca:           s.sca           / gp,
    shots_blocked: s.shots_blocked / gp,
    icetime:       s.icetime       / gp,
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
    .gt('gp', 30);

  if (!allBasic) return Response.json({ error: 'No stats' }, { status: 500 });

  const { data: allMP } = await supabase
    .from('mp_skater_stats')
    .select('*')
    .eq('season', mpSeason)
    .eq('situation', '5on5');

  // Position group (forwards vs defensemen)
  const posGroupBasic = allBasic.filter((s: any) =>
    isD ? s.players.position === 'D' : s.players.position !== 'D'
  );

  const playerIdsInGroup = new Set(posGroupBasic.map((s: any) => s.player_id));

  const targetIdx = posGroupBasic.findIndex((s: any) => s.player_id === parseInt(id));
  if (targetIdx === -1) {
    return Response.json({ error: 'Player not in qualified pool' }, { status: 404 });
  }

  // ── Per-game stat arrays ──
  const ppgs      = posGroupBasic.map((s: any) => s.gp > 0 ? s.pts   / s.gp : 0);
  const gpgs      = posGroupBasic.map((s: any) => s.gp > 0 ? s.g     / s.gp : 0);
  const apgs      = posGroupBasic.map((s: any) => s.gp > 0 ? s.a     / s.gp : 0);
  const shotRates = posGroupBasic.map((s: any) => s.gp > 0 ? s.shots / s.gp : 0);

  // ── Pass 1: raw offense composite for every player ──
  const offenseRaw = posGroupBasic.map((_, i) => isD
    ? percentileRank(ppgs[i], ppgs)           * 0.35 +
      percentileRank(apgs[i], apgs)           * 0.30 +
      percentileRank(shotRates[i], shotRates) * 0.20 +
      percentileRank(gpgs[i], gpgs)           * 0.15
    : percentileRank(ppgs[i], ppgs)           * 0.40 +
      percentileRank(gpgs[i], gpgs)           * 0.30 +
      percentileRank(apgs[i], apgs)           * 0.20 +
      percentileRank(shotRates[i], shotRates) * 0.10
  );

  // ── Pass 2: rank the target's offense composite ──
  const offense = Math.round(percentileRank(offenseRaw[targetIdx], offenseRaw));

  // ── MoneyPuck defense — position-filtered pool ──
  const posGroupMP = (allMP ?? []).filter((s: any) =>
    playerIdsInGroup.has(s.player_id) && s.icetime >= 200
  );

  let defense: number | null = null;
  let overall: number;

  if (posGroupMP.length > 10) {
    const targetMPIdx = posGroupMP.findIndex((s: any) => s.player_id === parseInt(id));

    if (targetMPIdx !== -1) {
      const normGroupMP = posGroupMP.map(normalize);

      const xga60s    = normGroupMP.map((s: any) => per60(s.xga,           s.icetime));
      const ca60s     = normGroupMP.map((s: any) => per60(s.ca,            s.icetime));
      const hdxa60s   = normGroupMP.map((s: any) => per60(s.sca,           s.icetime));
      const blk60s    = normGroupMP.map((s: any) => per60(s.shots_blocked, s.icetime));
      const relXGPcts = normGroupMP.map((s: any) =>
        (s.on_ice_xg_pct ?? 50) - (s.off_ice_xg_pct ?? 50)
      );

      // Pass 1: raw defense composite for every player in MP pool
      const defenseRaw = normGroupMP.map((norm: any) => {
        const tXGA60    = per60(norm.xga,           norm.icetime);
        const tCA60     = per60(norm.ca,            norm.icetime);
        const tHDXA60   = per60(norm.sca,           norm.icetime);
        const tBlk60    = per60(norm.shots_blocked, norm.icetime);
        const tRelXGPct = (norm.on_ice_xg_pct ?? 50) - (norm.off_ice_xg_pct ?? 50);

        return isD
          ? inversePercentileRank(tXGA60,  xga60s)  * 0.35 +
            inversePercentileRank(tCA60,   ca60s)   * 0.25 +
            inversePercentileRank(tHDXA60, hdxa60s) * 0.20 +
            percentileRank(tRelXGPct, relXGPcts)    * 0.10 +
            percentileRank(tBlk60,    blk60s)       * 0.10
          : inversePercentileRank(tXGA60,  xga60s)  * 0.40 +
            inversePercentileRank(tCA60,   ca60s)   * 0.30 +
            inversePercentileRank(tHDXA60, hdxa60s) * 0.20 +
            percentileRank(tRelXGPct, relXGPcts)    * 0.10;
      });

      // Pass 2: rank the target's defense composite
      defense = Math.round(percentileRank(defenseRaw[targetMPIdx], defenseRaw));

      // ── Overall: two-pass across players who have both ──
      const mpPlayerIds = new Set(posGroupMP.map((s: any) => s.player_id));
      const overallRaw: number[] = [];
      let targetOverallRaw: number | null = null;

      for (let i = 0; i < posGroupBasic.length; i++) {
        const pid = posGroupBasic[i].player_id;
        if (!mpPlayerIds.has(pid)) continue;
        const mpIdx = posGroupMP.findIndex((s: any) => s.player_id === pid);
        if (mpIdx === -1) continue;
        const raw = isD
          ? offenseRaw[i] * 0.35 + defenseRaw[mpIdx] * 0.65
          : offenseRaw[i] * 0.60 + defenseRaw[mpIdx] * 0.40;
        overallRaw.push(raw);
        if (pid === parseInt(id)) targetOverallRaw = raw;
      }

      overall = targetOverallRaw !== null
        ? Math.round(percentileRank(targetOverallRaw, overallRaw))
        : offense;
    } else {
      overall = offense;
    }
  } else {
    overall = offense;
  }

  return Response.json({
    position:      player.position,
    positionGroup: isD ? 'defensemen' : 'forwards',
    groupSize:     posGroupBasic.length,
    hasAdvanced:   defense !== null,
    percentiles:   { overall, offense, defense },
  });
}
