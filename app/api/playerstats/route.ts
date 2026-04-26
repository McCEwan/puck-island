import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const season = searchParams.get('season') ?? '2024-25';

  const { data, error } = await supabase
    .from('player_season_stats')
    .select(`*, players (id, full_name, position, current_team_id)`)
    .eq('season_id', season)
    .order('pts', { ascending: false })
    .limit(5000);

  if (error) return Response.json({ error }, { status: 500 });
  return Response.json(data);
}
