import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/players/[id]/ratings'>) {
  const { id } = await ctx.params;

  const { data: player } = await supabase
    .from('players')
    .select('position')
    .eq('id', id)
    .single();

  if (!player) return Response.json({ error: 'Player not found' }, { status: 404 });

  const isD = player.position === 'D';

  const { data: allStats } = await supabase
    .from('player_season_stats')
    .select(`
      player_id,
      gp, g, a, pts, shots,
      players!inner (position)
    `)
    .neq('players.position', 'G')
    .eq('season_id', '2024-25')
    .gt('gp', 20);

  if (!allStats) return Response.json({ error: 'No stats' }, { status: 500 });

  const grouped = allStats.filter((s: any) =>
    isD ? s.players.position === 'D' : s.players.position !== 'D'
  );

  function pctRank(value: number, values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const below = sorted.filter(v => v < value).length;
    return Math.round((below / sorted.length) * 100);
  }

  function calcStats(rows: any[]) {
    return rows.map(r => ({
      player_id: r.player_id,
      ppg:      r.gp > 0 ? r.pts / r.gp : 0,
      gpg:      r.gp > 0 ? r.g   / r.gp : 0,
      apg:      r.gp > 0 ? r.a   / r.gp : 0,
      shPct:    r.shots > 0 ? r.g / r.shots : 0,
      shotRate: r.gp > 0 ? r.shots / r.gp : 0,
    }));
  }

  const computed = calcStats(grouped);
  const target   = computed.find((c: any) => c.player_id === parseInt(id));

  if (!target) return Response.json({ error: 'Player not in position group' }, { status: 404 });

  const ppgs      = computed.map((c: any) => c.ppg);
  const gpgs      = computed.map((c: any) => c.gpg);
  const shotRates = computed.map((c: any) => c.shotRate);

  const offense = Math.round(
    pctRank(target.ppg,      ppgs)      * (isD ? 0.40 : 0.45) +
    pctRank(target.gpg,      gpgs)      * (isD ? 0.35 : 0.35) +
    pctRank(target.shotRate, shotRates) * (isD ? 0.25 : 0.20)
  );
  const overall = offense;

  return Response.json({
    position:      player.position,
    positionGroup: isD ? 'defensemen' : 'forwards',
    groupSize:     grouped.length,
    percentiles: {
      overall,
      offense,
      defense:     null,
      powerPlay:   null,
      penaltyKill: null,
    }
  });
}
