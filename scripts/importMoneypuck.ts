import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

// Put all your MoneyPuck CSV files in a /moneypuck folder in your project root
const MP_FOLDER = path.join(process.cwd(), 'moneypuck');

const SITUATIONS = ['5on5', '5on4', '4on5', 'all'];

async function parseCSV(filePath: string): Promise<any[]> {
  const rows: any[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let headers: string[] = [];
  let first = true;

  for await (const line of rl) {
    const values = line.split(',');
    if (first) {
      headers = values;
      first = false;
      continue;
    }
    const row: any = {};
    headers.forEach((h, i) => { row[h.trim()] = values[i]; });
    rows.push(row);
  }

  return rows;
}

async function importFile(filePath: string) {
  console.log(`Importing ${path.basename(filePath)}...`);
  const rows = await parseCSV(filePath);

  const filtered = rows.filter(r => SITUATIONS.includes(r.situation));

  const batch: any[] = [];
  for (const r of filtered) {
    const icetime = parseFloat(r.icetime) || 0;
    if (icetime === 0) continue;

    batch.push({
      player_id:    parseInt(r.playerId),
      season:       parseInt(r.season),
      situation:    r.situation,
      games_played: parseInt(r.games_played) || 0,
      icetime,
      xgf:          parseFloat(r.OnIce_F_xGoals) || 0,
      xga:          parseFloat(r.OnIce_A_xGoals) || 0,
      cf:           parseFloat(r.OnIce_F_shotAttempts) || 0,
      ca:           parseFloat(r.OnIce_A_shotAttempts) || 0,
      ff:           parseFloat(r.OnIce_F_unblockedShotAttempts) || 0,
      fa:           parseFloat(r.OnIce_A_unblockedShotAttempts) || 0,
      scf:          parseFloat(r.OnIce_F_highDangerxGoals) || 0,
      sca:          parseFloat(r.OnIce_A_highDangerxGoals) || 0,
      points:          parseFloat(r.I_F_points)              || 0,
      goals:           parseFloat(r.I_F_goals)               || 0,
      primary_assists: parseFloat(r.I_F_primaryAssists)      || 0,
      individual_xg:   parseFloat(r.I_F_xGoals)              || 0,
      shots_blocked:   parseFloat(r.shotsBlockedByPlayer)    || 0,
      on_ice_xg_pct:   parseFloat(r.onIce_xGoalsPercentage)  || 50,
      off_ice_xg_pct:  parseFloat(r.offIce_xGoalsPercentage) || 50,
    });
  }

  // Upsert in batches of 500
  let inserted = 0;
  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    const { error } = await supabase
      .from('mp_skater_stats')
      .upsert(chunk, { onConflict: 'player_id,season,situation' });
    if (error) console.error('Error:', error.message);
    else inserted += chunk.length;
  }

  console.log(`  ✓ ${inserted} rows inserted`);
}

async function main() {
  const files = fs.readdirSync(MP_FOLDER)
    .filter(f => f.endsWith('.csv'))
    .map(f => path.join(MP_FOLDER, f));

  if (files.length === 0) {
    console.error('No CSV files found in /moneypuck folder');
    process.exit(1);
  }

  console.log(`Found ${files.length} CSV files`);
  for (const file of files) {
    await importFile(file);
  }
  console.log('Done!');
}

main();
