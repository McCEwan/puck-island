import { supabase } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabase.from('teams').select('*');
  if (error) return Response.json({ error }, { status: 500 });
  return Response.json(data);
}
