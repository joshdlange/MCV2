import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { embedCatalogVisualImage, embedCatalogVisualImages } from '../services/catalogVisualModel';
import { downloadCatalogReference } from '../services/catalogVisualFetch';

test('batch validates cardinality and input byte cap before inference', async () => {
  await assert.rejects(embedCatalogVisualImages([]), /1–16/);
  await assert.rejects(embedCatalogVisualImages(new Array(17).fill(Buffer.from('x'))), /1–16/);
  await assert.rejects(embedCatalogVisualImages([Buffer.alloc(0)]), /12 MB/);
});

test('real development catalog fronts: sequential wrapper versus single q8 parity', {
  skip: process.env.CATALOG_VISUAL_REAL_TEST !== 'true',
}, async () => {
  assert.equal(process.env.NODE_ENV, 'development');
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'helium');
  process.env.CATALOG_VISUAL_OFFLINE = 'true';
  const { pool } = await import('../db');
  const { CATALOG, ELIGIBLE } = await import('../services/catalogVisual');
  try {
    const rows = await pool.query(`SELECT c.front_image_url AS url ${CATALOG}
      WHERE ${ELIGIBLE} GROUP BY c.front_image_url ORDER BY min(c.id) LIMIT 16`);
    assert.equal(rows.rows.length, 16);
    const images: Buffer[] = [];
    for (const row of rows.rows) images.push(await downloadCatalogReference(row.url));
    const batch = await embedCatalogVisualImages(images);
    for (let i = 0; i < images.length; i++) {
      const single = await embedCatalogVisualImage(images[i]);
      const maxError = Math.max(...single.map((v, j) => Math.abs(v - batch[i][j])));
      const cosine = single.reduce((sum, v, j) => sum + v * batch[i][j], 0);
      console.log(JSON.stringify({ realImage: i, maxError, cosine }));
      assert.ok(maxError < 1e-5, `real image ${i}: ${maxError}, ${cosine}`);
    }
  } finally { await pool.end(); }
});

test('pinned q8 DINO sequential wrapper must agree with single CLS within 1e-5', async () => {
  process.env.CATALOG_VISUAL_OFFLINE = 'true';
  const images = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    sharp({ create: { width: 140 + i * 11, height: 230, channels: 3,
      background: { r: i * 29, g: 200 - i * 21, b: 31 + i * 25 } } }).png().toBuffer()));
  const batch = await embedCatalogVisualImages(images);
  for (let i = 0; i < images.length; i++) {
    const single = await embedCatalogVisualImage(images[i]);
    assert.equal(batch[i].length, 384);
    assert.ok(Math.abs(Math.hypot(...batch[i]) - 1) < 1e-6);
    const maxError = Math.max(...single.map((v, j) => Math.abs(v - batch[i][j])));
    const cosine = single.reduce((sum, v, j) => sum + v * batch[i][j], 0);
    console.log(JSON.stringify({ image: i, maxError, cosine }));
    // Keep tight parity: multi-image q8 tensor inference is not permitted.
    assert.ok(maxError < 1e-5, `image ${i}: max error ${maxError}, cosine ${cosine}`);
  }
});