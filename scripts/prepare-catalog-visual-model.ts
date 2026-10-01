import { mkdir, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  MODEL_ID, MODEL_REVISION, bundledVisualModelPath, embedCatalogVisualImage,
} from '../server/services/catalogVisualModel';

// Build artifact, NOT a database migration. Pinned official model files only.
// Optional: skipped unless visual retrieval or indexing is enabled, and a
// download/inference failure never fails the build. Without the bundled model,
// production runs offline and visual search reports "unavailable".
async function prepare() {
  const target = bundledVisualModelPath();
  await mkdir(path.join(target, 'onnx'), { recursive: true });
  for (const file of ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']) {
    const response = await fetch(`https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file}`, {
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok || !response.body) throw new Error(`Pinned visual model download failed: ${file} HTTP ${response.status}`);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) throw new Error('Pinned model file exceeds build size cap');
      chunks.push(chunk);
    }
    const destination = path.join(target, file);
    const temporary = `${destination}.tmp`;
    try {
      await writeFile(temporary, Buffer.concat(chunks));
      await rename(temporary, destination);
    } finally { await rm(temporary, { force: true }); }
    console.log(`[catalog-visual build] Prepared ${file} (${bytes} bytes)`);
  }
  process.env.CATALOG_VISUAL_OFFLINE = 'true';
  const image = await sharp({ create: { width: 224, height: 224, channels: 3, background: '#777777' } }).png().toBuffer();
  const vector = await embedCatalogVisualImage(image);
  if (vector.length !== 384 || vector.some(value => !Number.isFinite(value))) {
    throw new Error('Bundled offline DINO CPU inference failed');
  }
  console.log(`[catalog-visual build] Offline CPU artifact verified: ${MODEL_ID}@${MODEL_REVISION}, dimension ${vector.length}; remote models disabled.`);
}

if (process.env.SCAN_VISUAL_RETRIEVAL !== 'on' && process.env.CATALOG_VISUAL_INDEX_ENABLED !== 'true') {
  console.log('[catalog-visual build] Skipped: SCAN_VISUAL_RETRIEVAL is off and indexing is disabled.');
} else {
  try {
    await prepare();
  } catch (error) {
    console.warn('[catalog-visual build] WARNING: model not bundled; visual search will report unavailable.', error);
  }
}
