import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertPublishCopy, inspect, prune } from './publish-package.mjs';

test('publishing cleanup refuses the development environment', () => {
  assert.throws(() => assertPublishCopy({ REPLIT_DEV_DOMAIN: 'workspace.replit.dev' }), /Refusing/);
  for (const flag of [undefined, '', '0', 'true', 'on']) {
    assert.throws(() => assertPublishCopy({ PUBLISH_BUILD: flag, REPLIT_DEPLOYMENT: '1' }), /Refusing/);
  }
  assert.throws(() => assertPublishCopy({}), /Refusing/);
});
test('explicit publishing signal works even when the build exposes the dev domain', () => {
  for (const deployment of [undefined, '1']) {
    assert.doesNotThrow(() => assertPublishCopy({
      PUBLISH_BUILD: '1', REPLIT_DEV_DOMAIN: 'build.replit.dev', REPLIT_DEPLOYMENT: deployment,
    }));
  }
});
test('allowlist removes only an isolated fixture; runtime files survive', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'publish-policy-'));
  const required = [
    'dist/index.js', 'dist/public/index.html', 'dist/check-runtime-package.mjs',
    'dist/models/dino/model.onnx', 'runtime/scanner/index/current.f32',
    'docs/scan-bad-images.md', 'client/src/assets/avatars/avatar.webp',
    'uploads/badges/badge.webp', 'node_modules/library/index.js', 'package.json',
    '.cache/replit/nix/env.json', '.cache/replit/toolchain.json',
  ];
  const excluded = ['.local/test-photo.jpg', '.pythonlibs/python', '.cache/model', '.git/objects/data',
    'attached_assets/photo.jpg', 'runtime/scanner/model/model.onnx', 'client/src/App.tsx', 'server/index.ts'];
  try {
    for (const file of [...required, ...excluded]) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), 'test');
    }
    const report = await inspect(root);
    assert.equal(report.keptBytes, required.length * 4);
    assert.equal(report.removedBytes, excluded.length * 4);
    await assert.rejects(prune(root, { REPLIT_DEV_DOMAIN: 'dev' }), /Refusing/);
    await access(path.join(root, excluded[0]));
    await prune(root, { PUBLISH_BUILD: '1', REPLIT_DEV_DOMAIN: 'build.replit.dev' });
    for (const file of required) await access(path.join(root, file));
    for (const file of excluded) await assert.rejects(access(path.join(root, file)));
  } finally { await rm(root, { recursive: true, force: true }); }
});