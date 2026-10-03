import { readdir, lstat, readlink, mkdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const roots = ['.local', 'runtime/scanner'];
const backupRoots = ['.local/phase-b', '.local/phase-c0', '.local/phase-c1', 'runtime/scanner'];
const files = [];
async function walk(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { await walk(file); continue; }
    if (entry.isSymbolicLink()) { files.push({ path: file, symlink: await readlink(file) }); continue; }
    if (!entry.isFile()) continue;
    const before = await lstat(file);
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(file)) hash.update(bytes);
    const after = await lstat(file);
    files.push({ path: file, bytes: after.size, sha256: hash.digest('hex'),
      stableDuringRead: before.size === after.size && before.mtimeMs === after.mtimeMs });
  }
}
for (const root of roots) await walk(root);
const manifest = { capturedAt: new Date().toISOString(), roots, backupRoots, files };
const target = process.argv[2];
if (!target) throw new Error('Supply a new baseline filename; never overwrite an existing baseline.');
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(manifest, null, 2), { flag: 'wx' });
for (const root of backupRoots) {
  const entries = files.filter(f => f.path.startsWith(`${root}/`));
  console.log(JSON.stringify({ root, files: entries.filter(f => f.sha256).length,
    bytes: entries.reduce((sum, f) => sum + (f.bytes || 0), 0),
    unstable: entries.filter(f => f.stableDuringRead === false).length }));
}
console.log(`Baseline: ${target}; ${files.length} entries. This is an inventory, NOT a cloud backup.`);