import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVisualVector, visualCosine, visualTopK, VisualInferenceScheduler } from '../services/catalogVisualModel';
import { downloadCatalogReference, isCatalogReferenceUrl } from '../services/catalogVisualFetch';

test('cosine compares normalized artwork vectors without text input', () => {
  const a = normalizeVisualVector(Array.from({ length: 384 }, (_, i) => i === 0 ? 2 : 0));
  const b = normalizeVisualVector(Array.from({ length: 384 }, (_, i) => i === 1 ? 2 : 0));
  assert.equal(visualCosine(a, a), 1);
  assert.equal(visualCosine(a, b), 0);
  assert.throws(() => normalizeVisualVector([1, 2]), /dimensions/);
  assert.throws(() => normalizeVisualVector(new Array(384).fill(NaN)), /values/);
});

test('catalog reference policy excludes Drive, credentials, local schemes and ports', () => {
  for (const url of ['https://drive.google.com/file/d/abc', 'https://docs.google.com/a',
    'https://lh3.googleusercontent.com/x', 'file:///etc/passwd', 'https://user:pass@example.com/a',
    'http://localhost/x', 'https://example.com:5000/x']) assert.equal(isCatalogReferenceUrl(url), false, url);
  assert.equal(isCatalogReferenceUrl('https://res.cloudinary.com/example/image/upload/v1/card.jpg'), true);
});

test('catalog downloader rejects private targets before opening a connection', async () => {
  for (const url of ['http://127.0.0.1/a', 'http://10.1.2.3/a', 'http://169.254.169.254/a']) {
    await assert.rejects(downloadCatalogReference(url), /private|reserved/);
  }
});

test('scan inference jumps ahead of waiting backfill and queue is bounded', async () => {
  const scheduler = new VisualInferenceScheduler();
  const order: string[] = [];
  let release!: () => void;
  const blocked = scheduler.run(() => new Promise<void>(resolve => { release = resolve; }), 'background');
  await Promise.resolve();
  const background = scheduler.run(async () => { order.push('background'); }, 'background');
  await assert.rejects(scheduler.run(async () => {}, 'background'), /busy/);
  const scans = Array.from({ length: 4 }, (_, i) => scheduler.run(async () => { order.push(`scan${i}`); }));
  await assert.rejects(scheduler.run(async () => {}), /busy/);
  release();
  await Promise.all([blocked, background, ...scans]);
  assert.deepEqual(order, ['scan0', 'scan1', 'scan2', 'scan3', 'background']);
});

test('streaming top K agrees with exhaustive cosine ranking and stays bounded', () => {
  const refs = Array.from({ length: 1000 }, (_, i) => ({
    url: `${i}`, vector: [Math.sin(i * 1.12), Math.cos(i * 1.12)],
  }));
  const expected = refs.map(ref => ({ url: ref.url, similarity: visualCosine([1, 0], ref.vector) }))
    .sort((a, b) => b.similarity - a.similarity).slice(0, 20);
  assert.deepEqual(visualTopK(refs, [1, 0], 20), expected);
  assert.equal(visualTopK(refs, [1, 0], 9999).length, 200);
});