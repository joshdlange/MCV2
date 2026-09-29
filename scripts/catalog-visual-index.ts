import sharp from 'sharp';
import { pool } from '../server/db';
import { buildCatalogVisualIndexBatch, getCatalogVisualStatus, queryCatalogByImage, MODEL_VERSION } from '../server/services/catalogVisual';
import { downloadCatalogReference } from '../server/services/catalogVisualFetch';

// Deliberately development-only. Runtime batches are owned by the application's
// explicit worker hook, not a deploy script or production startup migration.
if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1') {
  throw new Error('Catalog index CLI is development-only');
}
const batches = Math.min(20, Math.max(1, Number(process.argv.find(a => a.startsWith('--batches='))?.split('=')[1] ?? 1)));
const batchSize = Math.min(32, Math.max(1, Number(process.argv.find(a => a.startsWith('--batch-size='))?.split('=')[1] ?? 8)));
try {
  for (let i = 0; i < batches; i++) console.log('batch', await buildCatalogVisualIndexBatch(batchSize));
  console.log('status', await getCatalogVisualStatus());
  if (process.argv.includes('--sanity')) {
    const reference = await pool.query(`SELECT c.id, r.reference_url FROM catalog_visual_references r
      JOIN cards c ON c.front_image_url=r.reference_url
      JOIN card_sets s ON s.id=c.set_id LEFT JOIN main_sets m ON m.id=s.main_set_id
      WHERE r.model_version=$1 AND r.status='ready' AND c.archived_at IS NULL
      AND s.is_active AND s.archived_at IS NULL
      AND (m.id IS NULL OR (m.is_active AND m.archived_at IS NULL))
      ORDER BY c.id LIMIT 1`, [MODEL_VERSION]);
    if (!reference.rows.length) throw new Error('No actual indexed reference for sanity check');
    const row = reference.rows[0];
    const original = await downloadCatalogReference(row.reference_url);
    const transformed = await sharp(original).rotate(3, { background: '#888888' })
      .resize({ width: 360 }).modulate({ brightness: 0.9, saturation: 0.85 }).jpeg({ quality: 62 }).toBuffer();
    const result = await queryCatalogByImage(transformed, 10);
    const rank = result.matches.findIndex(match => match.cardId === row.id) + 1;
    console.log('REFERENCE-RETRIEVAL SANITY ONLY (not real-photo accuracy)', {
      referenceCardId: row.id, transformations: '3-degree rotation, resize, brightness/saturation, JPEG quality 62',
      textInput: false, rank, status: result.status, indexedCount: result.indexedCount,
      topMatches: result.matches.slice(0, 5),
    });
    if (rank !== 1) throw new Error('Transformed reference did not retrieve itself first');
  }
} finally { await pool.end(); }