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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const season = searchParams.get('season') ?? '2025-26';
  const mpSeason = parseInt(season.split('-')[0]);

  // ── Fetch all basic stats ──
  const { data: allBasic } = await supabase
    .from('player_season_stats')
    .select(`player_id, gp, g, a, pts, shots, players!inner (position)`)
    .neq('players.position', 'G')
    .eq('season_id', season)
    .gt('gp', 30);

  if (!allBasic) return Response.json({});

  // ── Fetch all MoneyPuck 5v5 stats for this season ──
  const { data: allMP } = await supabase
    .from('mp_skater_stats')
    .select('*')
    .eq('season', mpSeason)
    .eq('situation', '5on5');

  const mpMap = new Map((allMP ?? []).map((s: any) => [s.player_id, s]));

  // ── Split into position groups ──
  const forwards   = allBasic.filter((s: any) => s.players.position !== 'D');
  const defensemen = allBasic.filter((s: any) => s.players.position === 'D');

  function calcGroupRatings(group: any[]) {
    if (group.length === 0) return {};

    // ── Offense arrays ──
    const ppgs      = group.map(s => s.gp > 0 ? s.pts   / s.gp : 0);
    const gpgs      = group.map(s => s.gp > 0 ? s.g     / s.gp : 0);
    const apgs      = group.map(s => s.gp > 0 ? s.a     / s.gp : 0);
    const shotRates = group.map(s => s.gp > 0 ? s.shots / s.gp : 0);

    // ── Defense arrays (MoneyPuck) ──
    const groupMP = group
      .map(s => mpMap.get(s.player_id))
      .filter(Boolean)
      .filter((s: any) => s.icetime >= 200);

    const hasMP = groupMP.length > 10;

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

    const normGroupMP = groupMP.map(normalize);

    const xga60s    = normGroupMP.map(s => per60(s.xga,           s.icetime));
    const ca60s     = normGroupMP.map(s => per60(s.ca,            s.icetime));
    const hdxa60s   = normGroupMP.map(s => per60(s.sca,           s.icetime));
    const blk60s    = normGroupMP.map(s => per60(s.shots_blocked, s.icetime));
    const relXGPcts = normGroupMP.map(s =>
      (s.on_ice_xg_pct ?? 50) - (s.off_ice_xg_pct ?? 50)
    );

    const isD = group[0]?.players?.position === 'D';

    const results: Record<number, { overall: number, offense: number, defense: number | null }> = {};

    for (const player of group) {
      const tPPG      = player.gp > 0 ? player.pts   / player.gp : 0;
      const tGPG      = player.gp > 0 ? player.g     / player.gp : 0;
      const tAPG      = player.gp > 0 ? player.a     / player.gp : 0;
      const tShotRate = player.gp > 0 ? player.shots / player.gp : 0;

      let offense: number;
      if (isD) {
        offense = Math.round(
          percentileRank(tPPG,      ppgs)      * 0.35 +
          percentileRank(tAPG,      apgs)      * 0.30 +
          percentileRank(tShotRate, shotRates) * 0.20 +
          percentileRank(tGPG,      gpgs)      * 0.15
        );
      } else {
        offense = Math.round(
          percentileRank(tPPG,      ppgs)      * 0.40 +
          percentileRank(tGPG,      gpgs)      * 0.30 +
          percentileRank(tAPG,      apgs)      * 0.20 +
          percentileRank(tShotRate, shotRates) * 0.10
        );
      }

      let defense: number | null = null;
      if (hasMP) {
        const mp = mpMap.get(player.player_id);
        if (mp) {
          const norm = normalize(mp);
          const tXGA60    = per60(norm.xga,           norm.icetime);
          const tCA60     = per60(norm.ca,            norm.icetime);
          const tHDXA60   = per60(norm.sca,           norm.icetime);
          const tBlk60    = per60(norm.shots_blocked, norm.icetime);
          const tRelXGPct = (norm.on_ice_xg_pct ?? 50) - (norm.off_ice_xg_pct ?? 50);

          if (isD) {
            defense = Math.round(
              inversePercentileRank(tXGA60,  xga60s)  * 0.35 +
              inversePercentileRank(tCA60,   ca60s)   * 0.25 +
              inversePercentileRank(tHDXA60, hdxa60s) * 0.20 +
              percentileRank(tRelXGPct, relXGPcts)    * 0.10 +
              percentileRank(tBlk60, blk60s)          * 0.10
            );
          } else {
            defense = Math.round(
              inversePercentileRank(tXGA60,  xga60s)  * 0.40 +
              inversePercentileRank(tCA60,   ca60s)   * 0.30 +
              inversePercentileRank(tHDXA60, hdxa60s) * 0.20 +
              percentileRank(tRelXGPct, relXGPcts)    * 0.10
            );
          }
        }
      }

      const overall = defense !== null
        ? isD
          ? Math.round(offense * 0.35 + defense * 0.65)
          : Math.round(offense * 0.60 + defense * 0.40)
        : offense;

      results[player.player_id] = { overall, offense, defense };
    }

    return results;
  }

  const fwdRatings = calcGroupRatings(forwards);
  const defRatings = calcGroupRatings(defensemen);

  const defenseValues = Object.values(fwdRatings).map(r => r.defense).filter(v => v !== null).sort((a, b) => b - a);
  const offenseValues = Object.values(fwdRatings).map(r => r.offense).sort((a, b) => b - a);
  console.log('Top 5 defense:', defenseValues.slice(0, 5));
  console.log('Top 5 offense:', offenseValues.slice(0, 5));
  console.log('Pool size fwd:', forwards.length, 'def:', defensemen.length);

  return Response.json({ ...fwdRatings, ...defRatings });
}
