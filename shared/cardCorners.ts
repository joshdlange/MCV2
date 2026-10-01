export type CornerPoint = [number, number];

/**
 * Orders 4 card corners as TL, TR, BR, BL of the printed card.
 * The first point is the printed top-left (it fixes orientation, so sideways
 * cards stay upright); the other three may be in any order and are sorted
 * clockwise (in image coordinates, y down) around the centroid from it.
 * Works on normalized coordinates: scaling an axis preserves the cyclic order.
 */
export function orderCardCorners(points: CornerPoint[]): CornerPoint[] {
  if (points.length !== 4) throw new Error('Expected 4 corners');
  const cx = points.reduce((s, p) => s + p[0], 0) / 4, cy = points.reduce((s, p) => s + p[1], 0) / 4;
  const angle = (p: CornerPoint) => Math.atan2(p[1] - cy, p[0] - cx);
  const start = angle(points[0]);
  const turn = (p: CornerPoint) => ((angle(p) - start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return [points[0], ...points.slice(1).sort((a, b) => turn(a) - turn(b))];
}

/** True when the ordered quadrilateral is convex and clockwise (image coordinates). */
export function isClockwiseConvex(p: CornerPoint[]): boolean {
  return p.length === 4 && p.every((a, i) => {
    const b = p[(i + 1) % 4], c = p[(i + 2) % 4];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > 0;
  });
}
