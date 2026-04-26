import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

function percentileRank(value: number, values: number[]) {
  if (values.length <= 1) return 100;
  const sorted = [...values].sort((a, b) => a - b);
  const below  = sorted.filter(v => v < value).length;
  return Math.round((below / (values.length - 1)) * 100);
}

function inversePercentileRank(value: number, values: number[]) {
  return 100 - percentileRank(value, values);
}

function per60(stat: number, icetime: number) {
  return icetime > 0 ? (stat / icetime) * 60 : 0;
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const season   = searchParams.get('season') ?? '2025-26';
  const mpSeason = parseInt(season.split('-')[0]);

  const { data: allBasic } = await supabase
    .from('player_season_stats')
    .select(`player_id, gp, g, a, pts, shots, players!inner (position)`)
    .neq('players.position', 'G')
    .eq('season_id', season)
    .gt('gp', 30);

  if (!allBasic) return Response.json({});

  const { data: allMP } = await supabase
    .from('mp_skater_stats')
    .select('*')
    .eq('season', mpSeason)
    .eq('situation', '5on5');

  const qualifiedPlayerIds = new Set(allBasic.map((s: any) => s.player_id));

  const mpMap = new Map(
    (allMP ?? [])
      .filter((s: any) => qualifiedPlayerIds.has(s.player_id) && s.icetime >= 200)
      .map((s: any) => [s.player_id, s])
  );

  const forwards   = allBasic.filter((s: any) => s.players.position !== 'D');
  const defensemen = allBasic.filter((s: any) => s.players.position === 'D');

  function calcGroupRatings(group: any[]) {
    if (group.length === 0) return {};

    const isD = group[0]?.players?.position === 'D';

    // ── Per-game stat arrays ──
    const ppgs      = group.map(s => s.gp > 0 ? s.pts   / s.gp : 0);
    const gpgs      = group.map(s => s.gp > 0 ? s.g     / s.gp : 0);
    const apgs      = group.map(s => s.gp > 0 ? s.a     / s.gp : 0);
    const shotRates = group.map(s => s.gp > 0 ? s.shots / s.gp : 0);

    // ── Pass 1: raw offense composite per player (unrounded) ──
    const offenseRaw = group.map((_, i) => isD
      ? percentileRank(ppgs[i], ppgs)         * 0.35 +
        percentileRank(apgs[i], apgs)         * 0.30 +
        percentileRank(shotRates[i], shotRates) * 0.20 +
        percentileRank(gpgs[i], gpgs)         * 0.15
      : percentileRank(ppgs[i], ppgs)         * 0.40 +
        percentileRank(gpgs[i], gpgs)         * 0.30 +
        percentileRank(apgs[i], apgs)         * 0.20 +
        percentileRank(shotRates[i], shotRates) * 0.10
    );

    // ── MoneyPuck defense ──
    const groupMP    = group.map(s => mpMap.get(s.player_id)).filter(Boolean);
    const hasMP      = groupMP.length > 10;
    const normGroupMP = groupMP.map(normalize);

    const defRawById = new Map<number, number>();

    if (hasMP) {
      const xga60s    = normGroupMP.map(s => per60(s.xga,           s.icetime));
      const ca60s     = normGroupMP.map(s => per60(s.ca,            s.icetime));
      const hdxa60s   = normGroupMP.map(s => per60(s.sca,           s.icetime));
      const blk60s    = normGroupMP.map(s => per60(s.shots_blocked, s.icetime));
      const relXGPcts = normGroupMP.map(s => (s.on_ice_xg_pct ?? 50) - (s.off_ice_xg_pct ?? 50));

      // Pass 1: raw defense composite per MP player (unrounded)
      for (let j = 0; j < groupMP.length; j++) {
        const norm      = normGroupMP[j];
        const tXGA60    = per60(norm.xga,           norm.icetime);
        const tCA60     = per60(norm.ca,            norm.icetime);
        const tHDXA60   = per60(norm.sca,           norm.icetime);
        const tBlk60    = per60(norm.shots_blocked, norm.icetime);
        const tRelXGPct = (norm.on_ice_xg_pct ?? 50) - (norm.off_ice_xg_pct ?? 50);

        const raw = isD
          ? inversePercentileRank(tXGA60,  xga60s)  * 0.35 +
            inversePercentileRank(tCA60,   ca60s)   * 0.25 +
            inversePercentileRank(tHDXA60, hdxa60s) * 0.20 +
            percentileRank(tRelXGPct, relXGPcts)    * 0.10 +
            percentileRank(tBlk60,    blk60s)       * 0.10
          : inversePercentileRank(tXGA60,  xga60s)  * 0.40 +
            inversePercentileRank(tCA60,   ca60s)   * 0.30 +
            inversePercentileRank(tHDXA60, hdxa60s) * 0.20 +
            percentileRank(tRelXGPct, relXGPcts)    * 0.10;

        defRawById.set(groupMP[j].player_id, raw);
      }
    }

    const defRawValues     = [...defRawById.values()];

    // ── Pass 1: overall raws (only for players with both offense + defense) ──
    const overallRawById = new Map<number, number>();
    for (let i = 0; i < group.length; i++) {
      const pid    = group[i].player_id;
      const defRaw = defRawById.get(pid);
      if (defRaw !== undefined) {
        overallRawById.set(pid, isD
          ? offenseRaw[i] * 0.35 + defRaw * 0.65
          : offenseRaw[i] * 0.60 + defRaw * 0.40
        );
      }
    }
    const overallRawValues = [...overallRawById.values()];

    // ── Pass 2: percentile-rank the composites ──
    const results: Record<number, { overall: number, offense: number, defense: number | null }> = {};

    for (let i = 0; i < group.length; i++) {
      const pid     = group[i].player_id;
      const offense = Math.round(percentileRank(offenseRaw[i], offenseRaw));

      const defRaw  = defRawById.get(pid);
      const defense = (hasMP && defRaw !== undefined)
        ? Math.round(percentileRank(defRaw, defRawValues))
        : null;

      const overallRaw = overallRawById.get(pid);
      const overall    = overallRaw !== undefined
        ? Math.round(percentileRank(overallRaw, overallRawValues))
        : offense;

      results[pid] = { overall, offense, defense };
    }

    return results;
  }

  const fwdRatings = calcGroupRatings(forwards);
  const defRatings = calcGroupRatings(defensemen);

  return Response.json({ ...fwdRatings, ...defRatings });
}
