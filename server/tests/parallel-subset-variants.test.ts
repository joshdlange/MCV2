import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOPPS_MINT_2026_SUBSETS,
  TOPPS_MINT_PARALLEL_NAMES,
} from '../seeds/seedToppsMintMarvel2026';
import {
  TOPPS_CHROME_2026_SUBSETS,
  TOPPS_CHROME_DOOM_PARALLEL_NAMES,
} from '../seeds/seedToppsChromeMarvel2026';
import { appendParallelVariants } from '../seeds/parallelSubsetVariants';

function assertVariantsMirrorSource<
  Card extends { num: string; name: string },
  Subset extends { name: string; isInsert: boolean; cards: Card[] },
>(
  subsets: Subset[],
  sourceName: string,
  variantNames: readonly string[],
): void {
  const source = subsets.find((subset) => subset.name === sourceName);
  assert.ok(source, `missing source subset ${sourceName}`);

  for (const name of variantNames) {
    const variant = subsets.find((subset) => subset.name === name);
    assert.ok(variant, `missing variant subset ${name}`);
    assert.equal(variant.isInsert, source.isInsert);
    assert.deepEqual(variant.cards, source.cards);
    assert.notEqual(variant.cards, source.cards);
    assert.notEqual(variant.cards[0], source.cards[0]);
  }

  assert.equal(new Set(subsets.map((subset) => subset.name)).size, subsets.length);
}

test('2026 Topps Mint requested foils mirror all 125 Base cards', () => {
  assert.equal(TOPPS_MINT_2026_SUBSETS.length, 20);
  assert.equal(
    TOPPS_MINT_2026_SUBSETS.reduce((total, subset) => total + subset.cards.length, 0),
    1_730,
  );
  assertVariantsMirrorSource(
    TOPPS_MINT_2026_SUBSETS,
    'Base',
    TOPPS_MINT_PARALLEL_NAMES,
  );
});

test('One World Under Doom variants mirror all 20 insert cards', () => {
  assert.equal(TOPPS_CHROME_2026_SUBSETS.length, 77);
  assert.equal(
    TOPPS_CHROME_2026_SUBSETS.reduce((total, subset) => total + subset.cards.length, 0),
    9_444,
  );
  assertVariantsMirrorSource(
    TOPPS_CHROME_2026_SUBSETS,
    'One World Under Doom',
    TOPPS_CHROME_DOOM_PARALLEL_NAMES,
  );
});

test('parallel variant builder rejects ambiguous or malformed source checklists', () => {
  const source = [{
    name: 'Base',
    isInsert: false,
    cards: [
      { num: '1', name: 'Alpha' },
      { num: '1', name: 'Beta' },
    ],
  }];

  assert.throws(
    () => appendParallelVariants(source, 'Base', ['Gold']),
    /duplicate card number "1"/,
  );
  assert.throws(
    () => appendParallelVariants([], 'Base', ['Gold']),
    /must exist exactly once/,
  );
});