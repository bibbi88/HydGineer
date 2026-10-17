import { describe, expect, it } from 'vitest';
import { autoRouteAStar } from './autoRoute';
import type { PortAnchor } from './routing';
import type { Component, ComponentBounds } from '../core/types';

function fakeComponent(id: number, bounds: ComponentBounds): Component {
  return {
    id,
    type: 'fake',
    el: document.createElement('div'),
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
    svgW: bounds.w,
    svgH: bounds.h,
    gx: 0,
    gy: 0,
    ports: {},
    conductivityRule: () => [],
    snapshot: () => ({}),
    restore: () => {},
    reset: () => {},
    setPos: () => {},
    getBounds: () => bounds,
    setSelected: () => {},
  };
}

function assertOrthogonal(points: { x: number; y: number }[]): void {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as { x: number; y: number };
    const b = points[i + 1] as { x: number; y: number };
    expect(a.x === b.x || a.y === b.y).toBe(true);
  }
}

describe('autoRouteAStar', () => {
  it('routes a simple straight line with no obstacles', () => {
    const from: PortAnchor = { pos: { x: 0, y: 0 }, entryOrientation: 'H' };
    const to: PortAnchor = { pos: { x: 200, y: 0 }, entryOrientation: 'H' };
    const points = autoRouteAStar(from, to, [], new Set());
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 200, y: 0 });
    // a clear straight shot should stay on one y value throughout
    expect(points.every((p) => p.y === 0)).toBe(true);
  });

  it('routes around an obstacle placed directly between the two ports', () => {
    const from: PortAnchor = { pos: { x: 0, y: 100 }, entryOrientation: 'H' };
    const to: PortAnchor = { pos: { x: 300, y: 100 }, entryOrientation: 'H' };
    const obstacle = fakeComponent(99, { x: 100, y: 50, w: 100, h: 100 });

    const points = autoRouteAStar(from, to, [obstacle], new Set());

    // the path must not pass through the obstacle's bounding box
    const passesThroughObstacle = points.some(
      (p) => p.x >= 100 && p.x <= 200 && p.y >= 50 && p.y <= 150,
    );
    expect(passesThroughObstacle).toBe(false);
    expect(points[0]).toEqual({ x: 0, y: 100 });
    expect(points[points.length - 1]).toEqual({ x: 300, y: 100 });
    assertOrthogonal(points);
  });

  it('stays fully orthogonal even when the stub does not land exactly on a grid point', () => {
    // Off-grid, non-round coordinates - the stub will not exactly match any A* grid cell
    // center, which previously produced a diagonal segment connecting the two.
    const from: PortAnchor = { pos: { x: 7.3, y: 41.6 }, entryOrientation: 'H' };
    const to: PortAnchor = { pos: { x: 213.9, y: 158.2 }, entryOrientation: 'V' };
    const obstacle = fakeComponent(5, { x: 90, y: 90, w: 40, h: 40 });

    const points = autoRouteAStar(from, to, [obstacle], new Set());
    assertOrthogonal(points);
  });

  it('does not introduce an extra zigzag bend for a plain single-turn route (no obstacles)', () => {
    // Regression test: an earlier version of the stub/grid alignment fix bailed out for
    // exactly this common case (one real turn between two differently-oriented ports),
    // falling through to a bridging fallback that added a needless extra 2-segment step
    // right next to the destination port instead of a single clean corner.
    const from: PortAnchor = { pos: { x: 230, y: 344 }, entryOrientation: 'V' };
    const to: PortAnchor = { pos: { x: 720, y: 380 }, entryOrientation: 'H' };
    const points = autoRouteAStar(from, to, [], new Set());
    assertOrthogonal(points);
    // exactly one real bend: from -> stubOut -> corner -> stubIn -> to (5 points after
    // collapsing colinear runs), not the 7-point zigzag the bug produced.
    expect(points.length).toBe(5);
  });

  it('stays a single straight line when an unrelated component shifts the routing grid off true stub coordinates', () => {
    // Regression test: the A* search grid is 20px-celled and its origin depends on every
    // component currently in the scene (not just the two being connected) via GRID_MARGIN_PX,
    // so an unrelated component elsewhere routinely leaves the two same-row stub points a few
    // pixels short of landing on an exact grid line. Previously, when that rounding made the
    // whole path collapse to a single (already straight) row, the aligner bailed out and the
    // caller's bridging fallback then "corrected" the harmless rounding remainder with a real,
    // needless detour - even though the two ports were dead-aligned to begin with.
    const from: PortAnchor = { pos: { x: 0, y: 100 }, entryOrientation: 'H' };
    const to: PortAnchor = { pos: { x: 300, y: 100 }, entryOrientation: 'H' };
    const bystander = fakeComponent(7, { x: 500, y: 41, w: 40, h: 40 });

    const points = autoRouteAStar(from, to, [bystander], new Set());

    assertOrthogonal(points);
    expect(points.every((p) => p.y === 100)).toBe(true);
  });

  it('excludes the endpoints own components from obstacle marking', () => {
    const from: PortAnchor = { pos: { x: 10, y: 10 }, entryOrientation: 'H' };
    const to: PortAnchor = { pos: { x: 90, y: 10 }, entryOrientation: 'H' };
    const selfComp = fakeComponent(1, { x: 0, y: 0, w: 100, h: 20 });

    const points = autoRouteAStar(from, to, [selfComp], new Set([1]));
    expect(points.length).toBeGreaterThan(0);
    expect(points[0]).toEqual({ x: 10, y: 10 });
  });
});
