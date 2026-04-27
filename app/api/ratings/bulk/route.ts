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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const season   = searchParams.get('season') ?? '2025-26';
  const mpSeason = parseInt(season.split('-')[0]);

  const { data: allBasic } = await supabase
    .from('player_season_stats')
    .select(`player_id, gp, g, a, pts, shots, players!inner (position)`)
    .neq('players.position', 'G')
    .eq('season_id', season)
    .gte('gp', 30);

  if (!allBasic) return Response.json({});

  const qualifiedIds = new Set(allBasic.map((s: any) => s.player_id));

  // Fetch all three situations in one query
  const { data: allMPRaw } = await supabase
    .from('mp_skater_stats')
    .select('*')
    .eq('season', mpSeason)
    .in('situation', ['5on5', '5on4', '4on5']);

  const mp5v5Map = new Map(
    (allMPRaw ?? [])
      .filter((s: any) => s.situation === '5on5' && qualifiedIds.has(s.player_id) && s.icetime >= 200)
      .map((s: any) => [s.player_id, s])
  );
  const mpPPMap = new Map(
    (allMPRaw ?? [])
      .filter((s: any) =>
        s.situation === '5on4' &&
        qualifiedIds.has(s.player_id) &&
        s.games_played > 0 &&
        (s.icetime / s.games_played) > 30   // > 30 sec PP ice per game
      )
      .map((s: any) => [s.player_id, s])
  );
  const mpPKMap = new Map(
    (allMPRaw ?? [])
      .filter((s: any) =>
        s.situation === '4on5' &&
        qualifiedIds.has(s.player_id) &&
        s.games_played > 0 &&
        (s.icetime / s.games_played) > 30   // > 30 sec PK ice per game
      )
      .map((s: any) => [s.player_id, s])
  );

  const forwards   = allBasic.filter((s: any) => s.players.position !== 'D');
  const defensemen = allBasic.filter((s: any) => s.players.position === 'D');

  function calcGroupRatings(group: any[]) {
    if (group.length === 0) return {};
    const isD = group[0]?.players?.position === 'D';

    const results: Record<number, { overall: number, offense: number, defense: number, powerPlay: number | null, penaltyKill: number | null }> = {};

    // ── 5v5 Offense + Defense ──
    const entries5v5 = group
      .map(s => ({ basic: s, mp: mp5v5Map.get(s.player_id) }))
      .filter(({ mp }) => mp !== undefined);

    if (entries5v5.length > 10) {
      const norm = entries5v5.map(({ basic, mp }) => ({ basic, mp: normalizeMP(mp) }));

      const pts5v5s   = norm.map(({ mp }) => mp.points);
      const paPGs     = norm.map(({ mp }) => mp.primary_assists);
      const xgf60s    = norm.map(({ mp }) => per60(mp.xgf, mp.icetime));
      const ixg60s    = norm.map(({ mp }) => per60(mp.individual_xg, mp.icetime));
      const xga60s    = norm.map(({ mp }) => per60(mp.xga,          mp.icetime));
      const ca60s     = norm.map(({ mp }) => per60(mp.ca,           mp.icetime));
      const hdxa60s   = norm.map(({ mp }) => per60(mp.sca,          mp.icetime));
      const blk60s    = norm.map(({ mp }) => per60(mp.shots_blocked, mp.icetime));
      const relXGPcts = norm.map(({ mp }) => (mp.on_ice_xg_pct ?? 50) - (mp.off_ice_xg_pct ?? 50));

      const offenseRaw = norm.map((_, i) =>
        percentileRank(paPGs[i],   paPGs)   * 0.35 +
        percentileRank(xgf60s[i],  xgf60s)  * 0.30 +
        percentileRank(pts5v5s[i], pts5v5s) * 0.20 +
        percentileRank(ixg60s[i],  ixg60s)  * 0.15
      );

      const defenseRaw = norm.map((_, i) => isD
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

      const overallRaw = norm.map((_, i) => isD
        ? offenseRaw[i] * 0.35 + defenseRaw[i] * 0.65
        : offenseRaw[i] * 0.80 + defenseRaw[i] * 0.20
      );

      for (let i = 0; i < norm.length; i++) {
        const pid = norm[i].basic.player_id;
        results[pid] = {
          offense:     Math.round(percentileRank(offenseRaw[i], offenseRaw)),
          defense:     Math.round(percentileRank(defenseRaw[i], defenseRaw)),
          overall:     Math.round(percentileRank(overallRaw[i], overallRaw)),
          powerPlay:   null,
          penaltyKill: null,
        };
      }
    }

    // ── Power Play ──
    const entriesPP = group
      .map(s => ({ basic: s, mp: mpPPMap.get(s.player_id) }))
      .filter(({ mp }) => mp !== undefined);

    if (entriesPP.length > 10) {
      const normPP    = entriesPP.map(({ mp }) => normalizeMP(mp));
      const ppPts60s  = normPP.map(mp => per60(mp.points,          mp.icetime));
      const ppXgf60s  = normPP.map(mp => per60(mp.xgf,             mp.icetime));
      const ppPA60s   = normPP.map(mp => per60(mp.primary_assists,  mp.icetime));

      const ppRaw = normPP.map((_, i) =>
        percentileRank(ppPts60s[i], ppPts60s) * 0.40 +
        percentileRank(ppXgf60s[i], ppXgf60s) * 0.35 +
        percentileRank(ppPA60s[i],  ppPA60s)  * 0.25
      );

      for (let i = 0; i < entriesPP.length; i++) {
        const pid = entriesPP[i].basic.player_id;
        const pp  = Math.round(percentileRank(ppRaw[i], ppRaw));
        if (results[pid]) results[pid].powerPlay = pp;
      }
    }

    // ── Penalty Kill ──
    const entriesPK = group
      .map(s => ({ basic: s, mp: mpPKMap.get(s.player_id) }))
      .filter(({ mp }) => mp !== undefined);

    if (entriesPK.length > 10) {
      const normPK    = entriesPK.map(({ mp }) => normalizeMP(mp));
      const pkXga60s  = normPK.map(mp => per60(mp.xga, mp.icetime));
      const pkCa60s   = normPK.map(mp => per60(mp.ca,  mp.icetime));
      const pkHdxa60s = normPK.map(mp => per60(mp.sca, mp.icetime));

      const pkRaw = normPK.map((_, i) =>
        inversePercentileRank(pkXga60s[i],  pkXga60s)  * 0.45 +
        inversePercentileRank(pkCa60s[i],   pkCa60s)   * 0.30 +
        inversePercentileRank(pkHdxa60s[i], pkHdxa60s) * 0.25
      );

      for (let i = 0; i < entriesPK.length; i++) {
        const pid = entriesPK[i].basic.player_id;
        const pk  = Math.round(percentileRank(pkRaw[i], pkRaw));
        if (results[pid]) results[pid].penaltyKill = pk;
      }
    }

    return results;
  }

  return Response.json({
    ...calcGroupRatings(forwards),
    ...calcGroupRatings(defensemen),
  });
}
