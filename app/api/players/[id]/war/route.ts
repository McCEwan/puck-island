import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeSeasonWAR } from '@/lib/warServer';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/players/[id]/war'>) {
  const { id } = await ctx.params;
  const playerId = parseInt(id);

  const { data: seasonRows } = await supabase
    .from('player_season_stats')
    .select('season_id')
    .eq('player_id', playerId);

  if (!seasonRows || seasonRows.length === 0) {
    return Response.json({ seasons: {} });
  }

  const seasonIds = [...new Set(seasonRows.map((r: any) => r.season_id))];

  const results = await Promise.all(
    seasonIds.map(async (season) => {
      const { players } = await computeSeasonWAR(season);
      return [season, players[playerId] ?? null] as const;
    })
  );

  return Response.json({ seasons: Object.fromEntries(results) });
}
