import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/players/[id]/stats'>) {
  const { id } = await ctx.params;

  const { data, error } = await supabase
    .from('player_season_stats')
    .select('*')
    .eq('player_id', id)
    .order('season_id', { ascending: true });

  if (error) return Response.json({ error }, { status: 500 });
  return Response.json(data);
}
