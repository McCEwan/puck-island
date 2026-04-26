import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const HUGHES_ID = 8480800;
const HEADERS   = { 'User-Agent': 'Mozilla/5.0 (compatible; puck-island-sync/1.0)' };

async function main() {
  const res  = await fetch(`https://api-web.nhle.com/v1/player/${HUGHES_ID}/landing`, { headers: HEADERS });
  const data = await res.json();

  const entries = data.seasonTotals?.filter((t: any) => t.season === 20252026);
  console.log('2025-26 seasonTotals entries:', JSON.stringify(entries, null, 2));
}

main();
