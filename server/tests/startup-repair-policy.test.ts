import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowSuperfractorDuplicateRepair } from '../startupRepairPolicy';

test('destructive repair is disabled by default in every environment', () => {
  for (const NODE_ENV of ['development', 'production', 'test']) {
    for (const value of [undefined, '', 'false', 'on', '1', 'TRUE']) {
      assert.equal(allowSuperfractorDuplicateRepair({
        NODE_ENV, RUN_SUPERFRACTOR_DUPLICATE_REPAIR: value,
      }), false);
    }
  }
});

test('only explicit true enables maintenance repair', () => {
  assert.equal(allowSuperfractorDuplicateRepair({
    NODE_ENV: 'production', RUN_SUPERFRACTOR_DUPLICATE_REPAIR: 'true',
  }), true);
});

test('direct seed invocation is guarded before its first database query', () => {
  const source = readFileSync('server/seeds/fixSuperfractor2026JunkSets.ts', 'utf8');
  const body = source.slice(source.indexOf('export async function'));
  assert.ok(body.indexOf('if (!allowSuperfractorDuplicateRepair()) return;') >= 0);
  assert.ok(body.indexOf('if (!allowSuperfractorDuplicateRepair()) return;') < body.indexOf('await db.execute'));
});