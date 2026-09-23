import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNewReleaseSetIds } from './newReleaseSets';

test('marks only the three newest sets without changing catalog order', () => {
  const sets = [
    { id: 1, createdAt: '2025-01-01' },
    { id: 4, createdAt: '2026-09-23' },
    { id: 2, createdAt: '2026-08-03' },
    { id: 3, createdAt: '2026-08-10' },
  ];
  assert.deepEqual([...getNewReleaseSetIds(sets)], [4, 3, 2]);
  assert.deepEqual(sets.map(s => s.id), [1, 4, 2, 3]);
});

test('handles empty catalogs, missing dates, Date objects, and ties', () => {
  assert.equal(getNewReleaseSetIds([]).size, 0);
  assert.deepEqual([...getNewReleaseSetIds([
    { id: 1, createdAt: null },
    { id: 2, createdAt: 'invalid' },
    { id: 3, createdAt: new Date('2026-01-01') },
    { id: 4, createdAt: '2026-01-01' },
  ])], [4, 3, 2]);
});