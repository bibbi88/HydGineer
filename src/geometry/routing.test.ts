import { describe, expect, it } from 'vitest';
import {
  routeAuto,
  routeWithGuides,
  seedGuidesFromPoints,
  guideCorners,
  stubPoint,
  type PortAnchor,
} from './routing';
import { WIRE_STUB } from '../sim/constants';

function assertOrthogonal(points: { x: number; y: number }[]): void {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as { x: number; y: number };
    const b = points[i + 1] as { x: number; y: number };
    expect(a.x === b.x || a.y === b.y).toBe(true);
  }
}

describe('routeWithGuides', () => {
  it('stays orthogonal even when the last guide does not align with the destination stub', () => {
    const from: PortAnchor = { pos: { x: 0, y: 0 }, entryOrientation: 'H' };
    const to: PortAnchor = { pos: { x: 300, y: 300 }, entryOrientation: 'V' };
    // A single guide that doesn't share an axis with stubIn - simulating a guide dragged to an
    // arbitrary position, which previously produced a diagonal final segment.
    const points = routeWithGuides(from, to, [{ type: 'H', pos: 77 }]);
    assertOrthogonal(points);
  });

  it('round-trips guides through seedGuidesFromPoints for a multi-bend path', () => {
    const from: PortAnchor = { pos: { x: 0, y: 0 }, entryOrientation: 'H' };
    const to: PortAnchor = { pos: { x: 150, y: 300 }, entryOrientation: 'V' };
    const guides = [
      { type: 'H' as const, pos: 50 },
      { type: 'V' as const, pos: 150 },
    ];
    const points = routeWithGuides(from, to, guides);
    const stubOut = stubPoint(from, to.pos, WIRE_STUB);
    const stubIn = stubPoint(to, from.pos, WIRE_STUB);
    const seeded = seedGuidesFromPoints(points, stubOut, stubIn);
    expect(seeded).toEqual(guides);
  });

  it('seeds guides from a plain auto-routed path that reproduce the identical shape', () => {
    const from: PortAnchor = { pos: { x: 0, y: 0 }, entryOrientation: 'H' };
    const to: PortAnchor = { pos: { x: 100, y: 200 }, entryOrientation: 'V' };
    const autoPoints = routeAuto(from, to);
    const stubOut = stubPoint(from, to.pos, WIRE_STUB);
    const stubIn = stubPoint(to, from.pos, WIRE_STUB);
    const guides = seedGuidesFromPoints(autoPoints, stubOut, stubIn);
    expect(guides.length).toBeGreaterThan(0);
    expect(routeWithGuides(from, to, guides)).toEqual(autoPoints);
  });

  it('guideCorners places guides[i] at index i + 1', () => {
    const from: PortAnchor = { pos: { x: 0, y: 0 }, entryOrientation: 'H' };
    const to: PortAnchor = { pos: { x: 300, y: 200 }, entryOrientation: 'V' };
    const guides = [
      { type: 'H' as const, pos: 50 },
      { type: 'V' as const, pos: 150 },
    ];
    const corners = guideCorners(from, to, guides);
    expect(corners[1]).toEqual({ x: corners[0]?.x, y: 50 });
    expect(corners[2]).toEqual({ x: 150, y: 50 });
  });
});
