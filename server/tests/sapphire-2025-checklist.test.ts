import test from 'node:test';
import assert from 'node:assert/strict';
import checklist from '../seeds/data/toppsChromeSapphire2025.json';
import { SAPPHIRE_2025_VARIANTS } from '../seeds/completeSapphire2025';

test('2025 Sapphire supplied checklist has every number 1–200, including Black Panther', () => {
  assert.equal(checklist.length, 200);
  assert.deepEqual(checklist.map(c => c.num), Array.from({ length: 200 }, (_, i) => String(i + 1)));
  assert.equal(checklist[135].name, 'Black Panther');
  assert.equal(checklist[199].name, 'Wagnerine');
});

test('base and all eight requested Sapphire parallels are covered', () => {
  assert.deepEqual(SAPPHIRE_2025_VARIANTS, [
    ['base', null], ['green-sapphire', 99], ['aqua-sapphire', 75],
    ['gold-sapphire', 50], ['orange-sapphire', 25], ['purple-sapphire', 15],
    ['black-sapphire', 10], ['red-sapphire', 5], ['padparadscha-sapphire', 1],
  ]);
});
