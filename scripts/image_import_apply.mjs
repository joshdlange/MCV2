import fs from 'fs';
import pg from 'pg';
import Papa from 'papaparse';
import { v2 as cloudinary } from 'cloudinary';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || extractCloudName(process.env.CLOUDINARY_URL),
  api_key: process.env.CLOUDINARY_API_KEY || extractApiKey(process.env.CLOUDINARY_URL),
  api_secret: process.env.CLOUDINARY_API_SECRET || extractApiSecret(process.env.CLOUDINARY_URL),
});

function extractCloudName(url) {
  if (!url) return '';
  const match = url.match(/@([^/]+)/);
  return match ? match[1] : '';
}

function extractApiKey(url) {
  if (!url) return '';
  const match = url.match(/cloudinary:\/\/(\d+):/);
  return match ? match[1] : '';
}

function extractApiSecret(url) {
  if (!url) return '';
  const match = url.match(/cloudinary:\/\/\d+:([^@]+)@/);
  return match ? match[1] : '';
}

function normalize(str) {
  return (str || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function sanitize(str) {
  return (str || '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 100);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const BATCH_SIZE = 100;
const CONCURRENCY = 4;
const MAX_RETRIES = 2;

const checkpointPath = 'image-import-checkpoint.json';
const reportPath = 'image-import-apply-report.csv';
const failuresPath = 'image-import-failures.csv';

async function uploadToCloudinary(imageUrl, year, fullCombo, cardNumber, retries = 0) {
  const folder = `marvel-card-vault/cards/${year || 'unknown'}/${sanitize(fullCombo)}`;
  const publicId = `${folder}/${sanitize(cardNumber)}`;
  
  try {
    const result = await cloudinary.uploader.upload(imageUrl, {
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
      transformation: [
        { width: 400, aspect_ratio: '2:3', crop: 'fill', gravity: 'auto' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    });
    
    const transformedUrl = cloudinary.url(result.public_id, {
      transformation: [
        { width: 400, aspect_ratio: '2:3', crop: 'fill', gravity: 'auto' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
      secure: true,
    });
    
    return { success: true, url: transformedUrl };
  } catch (error) {
    if (retries < MAX_RETRIES) {
      await sleep(1000 * (retries + 1));
      return uploadToCloudinary(imageUrl, year, fullCombo, cardNumber, retries + 1);
    }
    return { success: false, error: error.message };
  }
}

async function processRow(row, rowIndex, setCache, cardCache) {
  const cardNumber = (row['Card Number'] || '').trim();
  const fullCombo = (row['FULL COMBO'] || '').trim();
  const imageUrl = (row['image_url'] || '').trim();
  const year = (row['year'] || '').trim();
  
  const result = {
    row_index: rowIndex,
    full_combo: fullCombo,
    card_number: cardNumber,
    image_url: imageUrl,
    status: '',
    reason: '',
    set_id: '',
    card_id: '',
    cloudinary_url: '',
  };
  
  if (!imageUrl) {
    result.status = 'SKIP';
    result.reason = 'blank_image_url';
    return result;
  }
  
  const normalizedFullCombo = normalize(fullCombo);
  const setId = setCache.get(normalizedFullCombo);
  
  if (!setId) {
    result.status = 'FAILED';
    result.reason = 'set_not_found';
    return result;
  }
  
  result.set_id = setId;
  
  const cardKey = `${setId}|${normalize(cardNumber)}`;
  const cardData = cardCache.get(cardKey);
  
  if (!cardData) {
    result.status = 'FAILED';
    result.reason = 'card_not_found';
    return result;
  }
  
  result.card_id = cardData.id;
  
  if (cardData.front_image_url) {
    result.status = 'SKIP';
    result.reason = 'already_has_front_image_url';
    return result;
  }
  
  const uploadResult = await uploadToCloudinary(imageUrl, year, fullCombo, cardNumber);
  
  if (!uploadResult.success) {
    result.status = 'FAILED';
    result.reason = `cloudinary_error: ${uploadResult.error}`;
    return result;
  }
  
  try {
    await pool.query(
      `UPDATE cards SET front_image_url = $1 WHERE id = $2`,
      [uploadResult.url, cardData.id]
    );
    cardData.front_image_url = uploadResult.url;
    result.status = 'UPDATED';
    result.reason = 'success';
    result.cloudinary_url = uploadResult.url;
  } catch (dbError) {
    result.status = 'FAILED';
    result.reason = `db_error: ${dbError.message}`;
  }
  
  return result;
}

async function processBatch(batch, startIndex, setCache, cardCache) {
  const results = [];
  const chunks = [];
  
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    chunks.push(batch.slice(i, i + CONCURRENCY).map((row, idx) => ({
      row,
      index: startIndex + i + idx + 1
    })));
  }
  
  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map(({ row, index }) => processRow(row, index, setCache, cardCache))
    );
    results.push(...chunkResults);
  }
  
  return results;
}

function loadCheckpoint() {
  try {
    if (fs.existsSync(checkpointPath)) {
      return JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    }
  } catch (e) {
    console.log('[APPLY] No valid checkpoint found, starting from beginning');
  }
  return { lastProcessedRow: 0 };
}

function saveCheckpoint(lastProcessedRow) {
  fs.writeFileSync(checkpointPath, JSON.stringify({ lastProcessedRow, timestamp: new Date().toISOString() }));
}

async function main() {
  const csvPath = 'Marvel_Cards_with_Images.csv';
  
  console.log('[APPLY] Starting image import apply...');
  console.log('[APPLY] Loading set cache...');
  
  const { rows: sets } = await pool.query(
    `SELECT id, name FROM card_sets WHERE is_active = true`
  );
  const setCache = new Map();
  for (const s of sets) {
    setCache.set(normalize(s.name), s.id);
  }
  console.log(`[APPLY] Cached ${setCache.size} sets`);
  
  console.log('[APPLY] Loading card cache...');
  const { rows: cards } = await pool.query(
    `SELECT id, set_id, card_number, front_image_url FROM cards`
  );
  const cardCache = new Map();
  for (const c of cards) {
    const key = `${c.set_id}|${normalize(c.card_number)}`;
    cardCache.set(key, { id: c.id, front_image_url: c.front_image_url });
  }
  console.log(`[APPLY] Cached ${cardCache.size} cards`);
  
  console.log('[APPLY] Parsing CSV...');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
  const allRows = parsed.data;
  console.log(`[APPLY] Found ${allRows.length} rows in CSV`);
  
  const checkpoint = loadCheckpoint();
  const startFrom = checkpoint.lastProcessedRow;
  console.log(`[APPLY] Resuming from row ${startFrom}`);
  
  const rows = allRows.slice(startFrom);
  console.log(`[APPLY] Processing ${rows.length} remaining rows`);
  
  const stats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  
  const allResults = [];
  const failures = [];
  
  let existingResults = [];
  if (startFrom > 0 && fs.existsSync(reportPath)) {
    const existingReport = fs.readFileSync(reportPath, 'utf8');
    existingResults = Papa.parse(existingReport, { header: true }).data;
    console.log(`[APPLY] Loaded ${existingResults.length} existing results from previous run`);
  }
  
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const batchResults = await processBatch(batch, startFrom + i, setCache, cardCache);
    
    for (const result of batchResults) {
      allResults.push(result);
      stats.processed++;
      
      if (result.status === 'UPDATED') {
        stats.updated++;
      } else if (result.status === 'SKIP') {
        stats.skipped++;
      } else if (result.status === 'FAILED') {
        stats.failed++;
        failures.push(result);
      }
    }
    
    const currentRow = startFrom + i + batch.length;
    saveCheckpoint(currentRow);
    
    console.log(`[APPLY] Progress: ${currentRow}/${allRows.length} | Updated: ${stats.updated} | Skipped: ${stats.skipped} | Failed: ${stats.failed}`);
    
    await sleep(100);
  }
  
  const finalResults = [...existingResults, ...allResults];
  
  console.log('[APPLY] Writing reports...');
  fs.writeFileSync(reportPath, Papa.unparse(finalResults));
  console.log(`[APPLY] Full report: ${reportPath} (${finalResults.length} rows)`);
  
  fs.writeFileSync(failuresPath, Papa.unparse(failures));
  console.log(`[APPLY] Failures report: ${failuresPath} (${failures.length} rows)`);
  
  if (fs.existsSync(checkpointPath)) {
    fs.unlinkSync(checkpointPath);
  }
  
  console.log('\n========== APPLY COMPLETE ==========');
  console.log(`Processed:    ${stats.processed.toLocaleString()}`);
  console.log(`Updated:      ${stats.updated.toLocaleString()}`);
  console.log(`Skipped:      ${stats.skipped.toLocaleString()}`);
  console.log(`Failed:       ${stats.failed.toLocaleString()}`);
  console.log('=====================================\n');
  
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
