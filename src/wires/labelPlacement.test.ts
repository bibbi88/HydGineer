import { describe, expect, it } from 'vitest';
import { placeLabels, type Rect } from './labelPlacement';
import type { Connection } from '../core/types';
import type { Point } from '../geometry/routing';

const conn = (id: number): Connection => ({ id }) as unknown as Connection;

/** The label's box as placed, for a label `w` px wide and 10 px high. */
function box(at: { x: number; y: number; anchor: string }, w: number): Rect {
  const x0 = at.anchor === 'start' ? at.x : at.anchor === 'end' ? at.x - w : at.x - w / 2;
  return { x0, y0: at.y - 9, x1: x0 + w, y1: at.y + 1 };
}

function crosses(r: Rect, a: Point, b: Point): boolean {
  if (a.x === b.x)
    return a.x > r.x0 && a.x < r.x1 && Math.max(a.y, b.y) > r.y0 && Math.min(a.y, b.y) < r.y1;
  return a.y > r.y0 && a.y < r.y1 && Math.max(a.x, b.x) > r.x0 && Math.min(a.x, b.x) < r.x1;
}

describe('wire label placement', () => {
  it('puts a vertical wire’s label beside it, not across it', () => {
    const wire = [
      { x: 100, y: 0 },
      { x: 100, y: 200 },
    ];
    const at = placeLabels([{ conn: conn(1), points: wire, width: 80 }], [wire], []).get(1)!;
    expect(crosses(box(at, 80), wire[0]!, wire[1]!)).toBe(false);
    expect(Math.abs(at.y - 100)).toBeLessThan(10);
  });

  it('moves off another wire running alongside, and off a symbol', () => {
    const wire = [
      { x: 0, y: 100 },
      { x: 300, y: 100 },
    ];
    // Another wire just above the middle of this one, and a symbol just below it.
    const other = [
      { x: 100, y: 92 },
      { x: 200, y: 92 },
    ];
    const symbol: Rect = { x0: 100, y0: 104, x1: 200, y1: 140 };
    const at = placeLabels(
      [{ conn: conn(1), points: wire, width: 60 }],
      [wire, other],
      [symbol],
    ).get(1)!;
    const r = box(at, 60);
    expect(crosses(r, other[0]!, other[1]!)).toBe(false);
    expect(r.x1 <= symbol.x0 || r.x0 >= symbol.x1 || r.y1 <= symbol.y0).toBe(true);
  });

  it('keeps two labels on parallel wires from landing on each other', () => {
    const a = [
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const b = [
      { x: 120, y: 0 },
      { x: 120, y: 100 },
    ];
    const placed = placeLabels(
      [
        { conn: conn(1), points: a, width: 70 },
        { conn: conn(2), points: b, width: 70 },
      ],
      [a, b],
      [],
    );
    const ra = box(placed.get(1)!, 70);
    const rb = box(placed.get(2)!, 70);
    const overlap =
      Math.min(ra.x1, rb.x1) > Math.max(ra.x0, rb.x0) &&
      Math.min(ra.y1, rb.y1) > Math.max(ra.y0, rb.y0);
    expect(overlap).toBe(false);
    expect(crosses(ra, b[0]!, b[1]!) || crosses(rb, a[0]!, a[1]!)).toBe(false);
  });
});
