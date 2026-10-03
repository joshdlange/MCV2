import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import express from 'express';
import sharp from 'sharp';
import { serveStatic } from '../server/vite';
import { embedCatalogVisualImage } from '../server/services/catalogVisualModel';
import { loadDevScanFrozenIndex } from '../server/services/devScanVisual';
import { readDevScanBadImages } from '../server/services/devScanBadImages';

// No database connections, credentials, or application startup seeds.
const metadata = JSON.parse(await readFile('dist/server-build-meta.json', 'utf8'));
for (const dependency of metadata.outputs['dist/index.js'].imports) {
  if (!dependency.external || dependency.kind !== 'import-statement') continue;
  const resolved = import.meta.resolve(dependency.path);
  if (resolved.startsWith('file:')) await access(new URL(resolved));
}
const { index } = await loadDevScanFrozenIndex();
assert.equal(index.indexed, 90415);
readDevScanBadImages();
assert.ok((await readdir('client/src/assets/avatars')).some(f => f.endsWith('.webp')));
const image = await sharp({ create: { width: 224, height: 224, channels: 3, background: '#777' } }).png().toBuffer();
const vector = await embedCatalogVisualImage(image, 'scan', { offline: true });
assert.equal(vector.length, 384);
assert.ok(vector.every(Number.isFinite));
const app = express();
serveStatic(app, 'dist/public');
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
try {
  const address = server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<html/);
} finally { server.closeAllConnections(); server.close(); }
console.log('[publish package] Built homepage, offline DINO inference, 90415 vectors, avatars and reviewed-image data passed.');