import type { NextRequest } from "next/server";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/roster/[team]">) {
  const { team } = await ctx.params;
  const res = await fetch(`https://api-web.nhle.com/v1/roster/${team}/current`);
  const data = await res.json();
  return Response.json(data);
}
