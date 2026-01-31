import fs from 'fs';
import pg from 'pg';
import Papa from 'papaparse';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const csvPath = 'public/uploads/cards_import.csv';
  
  // Build set name lookup
  const { rows: sets } = await pool.query(
    `SELECT id, lower(trim(regexp_replace(name, E'\\s+', ' ', 'g'))) as normalized_name 
     FROM card_sets WHERE is_active = true`
  );
  const setCache = new Map();
  for (const s of sets) {
    setCache.set(s.normalized_name, s.id);
  }
  console.log(`Cached ${setCache.size} sets`);
  
  // Parse CSV
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  
  // Find rows that should match "Spider-Man Renditions - Marvel Universe Impel"
  let found = 0;
  for (const row of rows) {
    const fullCombo = (row['FULL COMBO'] || '').trim();
    if (fullCombo.includes('Spider-Man Renditions') && fullCombo.includes('Marvel Universe Impel')) {
      if (found < 3) {
        const normalized = fullCombo.toLowerCase().trim().replace(/\s+/g, ' ');
        const setId = setCache.get(normalized);
        console.log(`\nRow FULL COMBO: "${fullCombo}"`);
        console.log(`Normalized: "${normalized}"`);
        console.log(`Set ID found: ${setId || 'NOT FOUND'}`);
        
        // Check if DB has similar
        const dbMatch = [...setCache.entries()].find(([k, v]) => k.includes('spider-man renditions') && k.includes('marvel universe impel'));
        if (dbMatch) {
          console.log(`DB has similar: "${dbMatch[0]}" -> ID ${dbMatch[1]}`);
          console.log(`Match: ${dbMatch[0] === normalized}`);
          if (dbMatch[0] !== normalized) {
            // Show character-by-character difference
            for (let i = 0; i < Math.max(dbMatch[0].length, normalized.length); i++) {
              if (dbMatch[0][i] !== normalized[i]) {
                console.log(`Diff at position ${i}: DB="${dbMatch[0].charCodeAt(i)}" CSV="${normalized.charCodeAt(i)}"`);
                break;
              }
            }
          }
        }
      }
      found++;
    }
  }
  console.log(`\nTotal matching rows: ${found}`);
  
  await pool.end();
}
main();
