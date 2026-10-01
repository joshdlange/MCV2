import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const cases = [
  { name: 'production', env: { NODE_ENV: 'production' }, error: /development only/ },
  { name: 'deployment', env: { REPLIT_DEPLOYMENT: '1' }, error: /never run inside a deployment/ },
  { name: 'flag off', env: { SCAN_VISUAL_RETRIEVAL: '' }, error: /requires explicit scan flag/ },
  { name: 'wrong flag spelling', env: { SCAN_VISUAL_RETRIEVAL: 'true' }, error: /requires explicit scan flag/ },
  { name: 'wrong target host', env: { DATABASE_URL: 'postgresql://localhost/heliumdb' }, error: /unapproved host/ },
  { name: 'wrong target database', env: { DATABASE_URL: 'postgresql://helium/otherdb' }, error: /unapproved database/ },
];
for (const fixture of cases) {
  test(`catalog refresh refuses ${fixture.name} before connecting`, () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/dev-refresh-catalog.ts', '--apply'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'development', REPLIT_DEPLOYMENT: '',
        SCAN_VISUAL_RETRIEVAL: 'on', DATABASE_URL: 'postgresql://helium/heliumdb', ...fixture.env },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, fixture.error);
    assert.doesNotMatch(result.stdout, /Backup\/checkpoint/);
  });
}