import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { orderCardCorners, isClockwiseConvex, type CornerPoint } from './cardCorners';
import { devDataPath } from '../server/devData';

const TL: CornerPoint = [0.1, 0.1], TR: CornerPoint = [0.8, 0.12], BR: CornerPoint = [0.82, 0.9], BL: CornerPoint = [0.08, 0.88];

test('any click order after the printed top-left yields TL, TR, BR, BL', () => {
  for (const rest of [[TR, BR, BL], [TR, BL, BR], [BL, BR, TR], [BR, TR, BL], [BR, BL, TR], [BL, TR, BR]]) {
    const ordered = orderCardCorners([TL, ...rest as CornerPoint[]]);
    assert.deepEqual(ordered, [TL, TR, BR, BL]);
    assert.ok(isClockwiseConvex(ordered));
  }
});

test('sideways card keeps the printed top-left first', () => {
  // Card rotated 90 degrees clockwise in the photo: printed top-left is at image top-right.
  const ordered = orderCardCorners([TR, BL, BR, TL]);
  assert.deepEqual(ordered, [TR, BR, BL, TL]);
  assert.ok(isClockwiseConvex(ordered));
});

test('reading-order clicks are not convex until ordered', () => {
  assert.equal(isClockwiseConvex([TL, TR, BL, BR]), false);
  assert.ok(isClockwiseConvex(orderCardCorners([TL, TR, BL, BR])));
});

test('Phase B: ordering the as-clicked corners reproduces corners-ordered.json', { skip: !existsSync(devDataPath('phase-b', 'corners-ordered.json')) }, () => {
  const clicked = JSON.parse(readFileSync(devDataPath('phase-b', 'corners.json'), 'utf8'));
  const ordered = JSON.parse(readFileSync(devDataPath('phase-b', 'corners-ordered.json'), 'utf8'));
  for (const id of Object.keys(clicked)) assert.deepEqual(orderCardCorners(clicked[id].corners), ordered[id].corners, id);
});
