import fs from 'fs';
import pg from 'pg';
import Papa from 'papaparse';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function normalize(str) {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

async function main() {
  const csvPath = 'public/uploads/cards_import.csv';
  
  const { rows: sets } = await pool.query(`SELECT id, name FROM card_sets WHERE is_active = true`);
  const setCache = new Map();
  for (const s of sets) {
    setCache.set(normalize(s.name), s.id);
  }
  
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
  
  const missingSetNames = new Map();
  
  for (const row of parsed.data) {
    const fullCombo = (row['FULL COMBO'] || '').trim();
    if (!fullCombo) continue;
    
    const normalized = normalize(fullCombo);
    const setId = setCache.get(normalized);
    
    if (!setId) {
      missingSetNames.set(fullCombo, (missingSetNames.get(fullCombo) || 0) + 1);
    }
  }
  
  // Sort by count descending
  const sorted = [...missingSetNames.entries()].sort((a,b) => b[1] - a[1]);
  
  console.log(`Missing ${sorted.length} unique set names, affecting ${sorted.reduce((a,[,c])=>a+c, 0)} cards:\n`);
  
  for (const [name, count] of sorted) {
    console.log(`${count.toString().padStart(5)} cards: ${name}`);
  }
  
  await pool.end();
}
main();
