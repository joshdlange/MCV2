import fs from 'fs';
import pg from 'pg';
import Papa from 'papaparse';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function normalize(str) {
  return (str || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

async function main() {
  const csvPath = 'Marvel_Cards_with_Images.csv';
  const reportPath = 'image-import-dryrun-report.csv';
  
  console.log('[DRY-RUN] Starting image import dry run...');
  console.log('[DRY-RUN] Loading set cache...');
  
  const { rows: sets } = await pool.query(
    `SELECT id, name FROM card_sets WHERE is_active = true`
  );
  const setCache = new Map();
  for (const s of sets) {
    setCache.set(normalize(s.name), s.id);
  }
  console.log(`[DRY-RUN] Cached ${setCache.size} sets`);
  
  console.log('[DRY-RUN] Loading card cache (set_id + card_number -> card)...');
  const { rows: cards } = await pool.query(
    `SELECT id, set_id, card_number, front_image_url FROM cards`
  );
  const cardCache = new Map();
  for (const c of cards) {
    const key = `${c.set_id}|${normalize(c.card_number)}`;
    cardCache.set(key, { id: c.id, front_image_url: c.front_image_url });
  }
  console.log(`[DRY-RUN] Cached ${cardCache.size} cards`);
  
  console.log('[DRY-RUN] Parsing CSV...');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
  const rows = parsed.data;
  console.log(`[DRY-RUN] Found ${rows.length} rows in CSV`);
  
  const stats = {
    total_rows: rows.length,
    rows_with_image_url: 0,
    blank_image_url: 0,
    matched_set: 0,
    unmatched_set: 0,
    matched_card: 0,
    unmatched_card: 0,
    would_skip_already_has_front_image_url: 0,
    would_update: 0,
    duplicates_in_csv: 0,
  };
  
  const seenKeys = new Map();
  const reportRows = [];
  const unmatchedSets = new Map();
  const unmatchedCards = [];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cardNumber = (row['Card Number'] || '').trim();
    const fullCombo = (row['FULL COMBO'] || '').trim();
    const imageUrl = (row['image_url'] || '').trim();
    
    const reportRow = {
      row_index: i + 1,
      full_combo: fullCombo,
      card_number: cardNumber,
      image_url: imageUrl,
      status: '',
      reason: '',
      set_id: '',
      card_id: '',
      existing_front_image_url: '',
    };
    
    if (!imageUrl) {
      stats.blank_image_url++;
      reportRow.status = 'SKIP';
      reportRow.reason = 'blank_image_url';
      reportRows.push(reportRow);
      continue;
    }
    
    stats.rows_with_image_url++;
    
    const normalizedFullCombo = normalize(fullCombo);
    const setId = setCache.get(normalizedFullCombo);
    
    if (!setId) {
      stats.unmatched_set++;
      reportRow.status = 'UNMATCHED';
      reportRow.reason = 'set_not_found';
      unmatchedSets.set(fullCombo, (unmatchedSets.get(fullCombo) || 0) + 1);
      reportRows.push(reportRow);
      continue;
    }
    
    stats.matched_set++;
    reportRow.set_id = setId;
    
    const cardKey = `${setId}|${normalize(cardNumber)}`;
    const cardData = cardCache.get(cardKey);
    
    if (!cardData) {
      stats.unmatched_card++;
      reportRow.status = 'UNMATCHED';
      reportRow.reason = 'card_not_found';
      unmatchedCards.push({ row: i + 1, fullCombo, cardNumber, setId });
      reportRows.push(reportRow);
      continue;
    }
    
    stats.matched_card++;
    reportRow.card_id = cardData.id;
    reportRow.existing_front_image_url = cardData.front_image_url || '';
    
    const csvKey = `${setId}|${normalize(cardNumber)}`;
    if (seenKeys.has(csvKey)) {
      stats.duplicates_in_csv++;
      reportRow.status = 'DUPLICATE';
      reportRow.reason = `duplicate_of_row_${seenKeys.get(csvKey)}`;
      reportRows.push(reportRow);
      continue;
    }
    seenKeys.set(csvKey, i + 1);
    
    if (cardData.front_image_url) {
      stats.would_skip_already_has_front_image_url++;
      reportRow.status = 'SKIP';
      reportRow.reason = 'already_has_front_image_url';
      reportRows.push(reportRow);
      continue;
    }
    
    stats.would_update++;
    reportRow.status = 'WOULD_UPDATE';
    reportRow.reason = 'ready_for_import';
    reportRows.push(reportRow);
  }
  
  console.log('\n========== DRY RUN SUMMARY ==========');
  console.log(`Total rows in CSV:              ${stats.total_rows.toLocaleString()}`);
  console.log(`Rows with image_url:            ${stats.rows_with_image_url.toLocaleString()}`);
  console.log(`Blank image_url (skipped):      ${stats.blank_image_url.toLocaleString()}`);
  console.log(`Matched sets:                   ${stats.matched_set.toLocaleString()}`);
  console.log(`Unmatched sets:                 ${stats.unmatched_set.toLocaleString()}`);
  console.log(`Matched cards:                  ${stats.matched_card.toLocaleString()}`);
  console.log(`Unmatched cards:                ${stats.unmatched_card.toLocaleString()}`);
  console.log(`Duplicates in CSV:              ${stats.duplicates_in_csv.toLocaleString()}`);
  console.log(`Would skip (already has image): ${stats.would_skip_already_has_front_image_url.toLocaleString()}`);
  console.log(`Would UPDATE:                   ${stats.would_update.toLocaleString()}`);
  console.log('======================================\n');
  
  if (unmatchedSets.size > 0) {
    console.log('Top 20 unmatched sets:');
    const sortedUnmatchedSets = [...unmatchedSets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    for (const [name, count] of sortedUnmatchedSets) {
      console.log(`  ${count} rows: "${name}"`);
    }
    console.log('');
  }
  
  if (unmatchedCards.length > 0) {
    console.log(`First 15 unmatched cards (set matched but card not found):`);
    for (const item of unmatchedCards.slice(0, 15)) {
      console.log(`  Row ${item.row}: set_id=${item.setId}, card_number="${item.cardNumber}"`);
    }
    console.log('');
  }
  
  console.log(`[DRY-RUN] Writing report to ${reportPath}...`);
  const reportCsv = Papa.unparse(reportRows);
  fs.writeFileSync(reportPath, reportCsv);
  console.log(`[DRY-RUN] Report written with ${reportRows.length.toLocaleString()} rows`);
  
  await pool.end();
  console.log('[DRY-RUN] Complete!');
}

main().catch(e => { console.error(e); process.exit(1); });
