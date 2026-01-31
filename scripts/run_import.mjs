import fs from 'fs';
import pg from 'pg';
import Papa from 'papaparse';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function normalize(str) {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

async function main() {
  const BATCH_SIZE = 2000;
  const START_OFFSET = parseInt(process.argv[2]) || 0;
  const csvPath = 'public/uploads/cards_import.csv';
  
  console.log(`[IMPORT] Starting from row ${START_OFFSET}`);
  console.log('[IMPORT] Loading set cache...');
  
  const { rows: sets } = await pool.query(
    `SELECT id, name FROM card_sets WHERE is_active = true`
  );
  const setCache = new Map();
  for (const s of sets) {
    setCache.set(normalize(s.name), s.id);
  }
  console.log(`[IMPORT] Cached ${setCache.size} sets`);
  
  console.log('[IMPORT] Parsing CSV...');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
  const allRows = parsed.data;
  const rows = allRows.slice(START_OFFSET);
  console.log(`[IMPORT] Processing rows ${START_OFFSET + 1} to ${allRows.length} (${rows.length} remaining)`);
  
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const missingSetNames = new Map();
  const setIdsUpdated = new Set();
  
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const insertData = [];
    
    for (const row of batch) {
      const cardNumber = (row['Card Number'] || '').trim();
      const cardTitle = (row['Card Title'] || '').trim();
      const fullCombo = (row['FULL COMBO'] || '').trim();
      
      if (!cardNumber || !cardTitle || !fullCombo) {
        errorCount++;
        continue;
      }
      
      const normalized = normalize(fullCombo);
      const setId = setCache.get(normalized);
      
      if (!setId) {
        missingSetNames.set(fullCombo, (missingSetNames.get(fullCombo) || 0) + 1);
        errorCount++;
        continue;
      }
      
      setIdsUpdated.add(setId);
      insertData.push({ cardNumber, name: cardTitle, setId, rarity: 'Common' });
    }
    
    if (insertData.length > 0) {
      // Batch insert
      const values = insertData.map((_, idx) => 
        `($${idx*4+1}, $${idx*4+2}, $${idx*4+3}, $${idx*4+4})`
      ).join(',');
      const params = insertData.flatMap(d => [d.cardNumber, d.name, d.setId, d.rarity]);
      
      try {
        const result = await pool.query(
          `INSERT INTO cards (card_number, name, set_id, rarity) VALUES ${values} ON CONFLICT DO NOTHING`,
          params
        );
        successCount += result.rowCount;
        skipCount += insertData.length - result.rowCount;
      } catch (e) {
        errorCount += insertData.length;
        console.error(`Batch error at ${START_OFFSET + i}: ${e.message}`);
      }
    }
    
    const absoluteRow = START_OFFSET + Math.min(i + BATCH_SIZE, rows.length);
    if ((i / BATCH_SIZE) % 10 === 0 || i + BATCH_SIZE >= rows.length) {
      console.log(`[IMPORT] Progress: ${absoluteRow}/${allRows.length} (${successCount} new, ${skipCount} skip, ${errorCount} err)`);
    }
  }
  
  console.log(`\n[IMPORT] COMPLETE: ${successCount} new cards, ${skipCount} skipped, ${errorCount} errors`);
  console.log(`[IMPORT] Missing ${missingSetNames.size} unique set names, affecting ${[...missingSetNames.values()].reduce((a,b)=>a+b, 0)} cards`);
  
  const sortedMissing = [...missingSetNames.entries()].sort((a,b) => b[1] - a[1]).slice(0, 10);
  console.log('[IMPORT] Top missing sets:');
  for (const [name, count] of sortedMissing) {
    console.log(`  ${count} cards: "${name}"`);
  }
  
  console.log(`[IMPORT] Updating card counts for ${setIdsUpdated.size} sets...`);
  await pool.query(`
    UPDATE card_sets cs SET total_cards = (SELECT COUNT(*) FROM cards WHERE set_id = cs.id)
    WHERE id = ANY($1::int[])
  `, [Array.from(setIdsUpdated)]);
  
  const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) as count FROM cards');
  console.log(`[IMPORT] Final card count: ${count}`);
  
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
