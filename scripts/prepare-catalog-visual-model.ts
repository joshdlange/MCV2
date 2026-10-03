import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { bundledVisualModelPath, embedCatalogVisualImage } from '../server/services/catalogVisualModel';
import { loadDevScanFrozenIndex } from '../server/services/devScanVisual';

// All runtime assets are packaged, not downloaded on production startup.
// A corrupt or incomplete package must fail the build, not ship a broken scanner.
const root = path.resolve('runtime/scanner');
const manifest: Record<string, string> = JSON.parse(await readFile(path.join(root, 'sha256.json'), 'utf8'));
for (const [file, expected] of Object.entries(manifest)) {
  const bytes = await readFile(path.join(root, file));
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error(`Scanner package checksum mismatch: ${file}`);
  }
}
const target = bundledVisualModelPath();
await mkdir(path.join(target, 'onnx'), { recursive: true });
for (const file of ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']) {
  await copyFile(path.join(root, 'model', file), path.join(target, file));
}
const { index } = await loadDevScanFrozenIndex();
const image = await sharp({ create: { width: 224, height: 224, channels: 3, background: '#777777' } }).png().toBuffer();
const vector = await embedCatalogVisualImage(image, 'scan', { offline: true });
if (vector.length !== 384 || vector.some(value => !Number.isFinite(value))) {
  throw new Error('Packaged offline scanner model failed inference validation');
}
console.log(`[scanner build] Checksums verified; ${index.rows.length} reused vectors; offline CPU inference passed.`);