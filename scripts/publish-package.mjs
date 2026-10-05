import { readdir, lstat, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Relative paths deliberately preserve the application's existing runtime contract.
export const keep = [
  'dist', 'node_modules', 'package.json', 'package-lock.json', '.replit',
  // Replit uses this metadata to assemble the runtime PATH/Nix toolchain.
  // It is infrastructure, not a disposable application/model cache.
  '.cache/replit',
  'runtime/scanner/index', 'docs/scan-bad-images.md',
  'client/src/assets/avatars', 'uploads', 'badge_images',
];
export function assertPublishCopy(env) {
  if (env.PUBLISH_BUILD !== '1') {
    throw new Error('Refusing to prune without PUBLISH_BUILD=1. This signal must be supplied only by the deployment build command.');
  }
}
const retained = name => keep.some(k => name === k || name.startsWith(`${k}/`));
const ancestor = name => keep.some(k => k.startsWith(`${name}/`));
export async function inspect(root) {
  const removed = [];
  let keptBytes = 0, removedBytes = 0;
  async function walk(relative = '', excluded = false) {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = await lstat(path.join(root, name));
      const drop = !retained(name) && !ancestor(name);
      if (drop && !excluded) removed.push(name);
      if (entry.isDirectory()) await walk(name, excluded || drop);
      else if (retained(name)) keptBytes += stat.size;
      else removedBytes += stat.size;
    }
  }
  await walk();
  return { keptBytes, removedBytes, removed };
}
export async function prune(root, env) {
  assertPublishCopy(env);
  // Validate before removing anything; missing build output is a hard failure.
  for (const required of [
    'dist/index.js', 'dist/public/index.html', 'dist/check-runtime-package.mjs',
    'runtime/scanner/index/current.f32', 'docs/scan-bad-images.md',
    'badge_images/thumbs', 'badge_images/large',
  ]) await access(path.join(root, required));
  const report = await inspect(root);
  for (const item of report.removed) await rm(path.join(root, item), { recursive: true, force: true });
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  if (process.argv.includes('--publish')) {
    assertPublishCopy(process.env); // Before npm or any filesystem mutation.
    // The failed publishing log proved DEV_DOMAIN is present in build containers.
    // Log only non-secret boolean context; neither marker is an authorization gate.
    console.log('[publish context]', JSON.stringify({
      explicitPublishBuild: process.env.PUBLISH_BUILD === '1',
      replitDevDomainPresent: Boolean(process.env.REPLIT_DEV_DOMAIN),
      replitDeploymentIsOne: process.env.REPLIT_DEPLOYMENT === '1',
    }));
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
    execFileSync('node_modules/.bin/esbuild', [
      'scripts/check-runtime-package.ts', '--platform=node', '--packages=external',
      '--bundle', '--format=esm', '--outfile=dist/check-runtime-package.mjs',
    ], { stdio: 'inherit' });
    execFileSync('npm', ['prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit' });
    await prune(root, process.env);
    execFileSync(process.execPath, ['dist/check-runtime-package.mjs'], { stdio: 'inherit' });
  }
  const report = await inspect(root);
  console.log(JSON.stringify({ ...report, keptGiB: report.keptBytes / 2 ** 30, excludedGiB: report.removedBytes / 2 ** 30 }, null, 2));
}