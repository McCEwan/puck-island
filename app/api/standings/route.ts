export async function GET() {
  const res = await fetch("https://api-web.nhle.com/v1/standings/now");
  const data = await res.json();
  return Response.json(data);
}
