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

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/players/[id]/ratings'>) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(_req.url);
  const season = searchParams.get('season') ?? '2025-26';

  const { data: player } = await supabase
    .from('players')
    .select('position')
    .eq('id', id)
    .single();

  if (!player) return Response.json({ error: 'Player not found' }, { status: 404 });

  const isD = player.position === 'D';

  // ── Basic season stats ──
  const { data: allBasic } = await supabase
    .from('player_season_stats')
    .select(`
      player_id, gp, g, a, pts, shots,
      players!inner (position)
    `)
    .neq('players.position', 'G')
    .eq('season_id', season)
    .gt('gp', 30);

  if (!allBasic) return Response.json({ error: 'No stats' }, { status: 500 });

  // ── MoneyPuck 5v5 stats ──
  const mpSeason = parseInt(season.split('-')[0]);

  const { data: allMP } = await supabase
    .from('mp_skater_stats')
    .select('*')
    .eq('season', mpSeason)
    .eq('situation', '5on5');

  // Filter to position group
  const posGroupBasic = allBasic.filter((s: any) =>
    isD ? s.players.position === 'D' : s.players.position !== 'D'
  );

  const playerIdsInGroup = new Set(posGroupBasic.map((s: any) => s.player_id));

  // Only players who passed the 30 GP threshold, with 200+ min 5v5 icetime
  const qualifiedPlayerIds = new Set(allBasic.map((s: any) => s.player_id));
  const posGroupMP = (allMP ?? []).filter((s: any) =>
    qualifiedPlayerIds.has(s.player_id) && s.icetime >= 200
  );

  const basicMap = new Map(posGroupBasic.map((s: any) => [s.player_id, s]));
  const mpMap    = new Map(posGroupMP.map((s: any) => [s.player_id, s]));

  const targetBasic = basicMap.get(parseInt(id));
  const targetMP    = mpMap.get(parseInt(id));

  if (!targetBasic) {
    return Response.json({ error: 'Player not in qualified pool' }, { status: 404 });
  }

  // ── OFFENSE percentiles (per game) ──
  const ppgs      = posGroupBasic.map((s: any) => s.gp > 0 ? s.pts   / s.gp : 0);
  const gpgs      = posGroupBasic.map((s: any) => s.gp > 0 ? s.g     / s.gp : 0);
  const apgs      = posGroupBasic.map((s: any) => s.gp > 0 ? s.a     / s.gp : 0);
  const shotRates = posGroupBasic.map((s: any) => s.gp > 0 ? s.shots / s.gp : 0);

  const tPPG      = targetBasic.gp > 0 ? targetBasic.pts   / targetBasic.gp : 0;
  const tGPG      = targetBasic.gp > 0 ? targetBasic.g     / targetBasic.gp : 0;
  const tAPG      = targetBasic.gp > 0 ? targetBasic.a     / targetBasic.gp : 0;
  const tShotRate = targetBasic.gp > 0 ? targetBasic.shots / targetBasic.gp : 0;

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

  // ── DEFENSE percentiles (MoneyPuck based) ──
  let defense: number | null = null;

  if (targetMP && posGroupMP.length > 10) {
    // Normalize per-game before per-60 to stabilize across different GP totals
    const normalize = (s: any) => {
      const gp = s.games_played || 1;
      return {
        ...s,
        xgf:           s.xgf           / gp,
        xga:           s.xga           / gp,
        cf:            s.cf            / gp,
        ca:            s.ca            / gp,
        ff:            s.ff            / gp,
        fa:            s.fa            / gp,
        scf:           s.scf           / gp,
        sca:           s.sca           / gp,
        shots_blocked: s.shots_blocked / gp,
        icetime:       s.icetime       / gp,
      };
    };

    const normGroupMP  = posGroupMP.map(normalize);
    const normTargetMP = normalize(targetMP);

    const xga60s    = normGroupMP.map((s: any) => per60(s.xga,           s.icetime));
    const ca60s     = normGroupMP.map((s: any) => per60(s.ca,            s.icetime));
    const hdxa60s   = normGroupMP.map((s: any) => per60(s.sca,           s.icetime));
    const blk60s    = normGroupMP.map((s: any) => per60(s.shots_blocked, s.icetime));
    const relXGPcts = normGroupMP.map((s: any) =>
      (s.on_ice_xg_pct ?? 50) - (s.off_ice_xg_pct ?? 50)
    );

    const tXGA60    = per60(normTargetMP.xga,           normTargetMP.icetime);
    const tCA60     = per60(normTargetMP.ca,             normTargetMP.icetime);
    const tHDXA60   = per60(normTargetMP.sca,            normTargetMP.icetime);
    const tBlk60    = per60(normTargetMP.shots_blocked,  normTargetMP.icetime);
    const tRelXGPct = (normTargetMP.on_ice_xg_pct ?? 50) - (normTargetMP.off_ice_xg_pct ?? 50);

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

  // ── OVERALL ──
  let overall: number | null = null;
  if (defense !== null) {
    overall = isD
      ? Math.round(offense * 0.35 + defense * 0.65)
      : Math.round(offense * 0.60 + defense * 0.40);
  } else {
    overall = offense;
  }

  return Response.json({
    position:      player.position,
    positionGroup: isD ? 'defensemen' : 'forwards',
    groupSize:     posGroupBasic.length,
    hasAdvanced:   defense !== null,
    percentiles: {
      overall,
      offense,
      defense,
    }
  });
}
