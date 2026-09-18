import { getCurrentSeasonId } from '@/lib/seasons';
import { computeSeasonWAR } from '@/lib/warServer';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const season = searchParams.get('season') ?? getCurrentSeasonId();

  const { winsPerGoal, players } = await computeSeasonWAR(season);

  return Response.json({ season, winsPerGoal: Math.round(winsPerGoal * 10000) / 10000, players });
}
