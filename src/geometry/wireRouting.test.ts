import { describe, expect, it } from 'vitest';
import { autoRouteAStar } from './autoRoute';
import { alignJunctionAnchor, worldPortAnchor } from './connectionGeometry';
import { completeGuides, guideCorners, type Point, type PortAnchor } from './routing';
import type { Component } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';
import { createThrottleValve } from '../components/throttleValve';
import { createValve52Mono } from '../components/valve52Mono';
import { createJunction } from '../components/junction';
import { setComponentMirrored, setComponentRotation } from '../interaction/componentContextMenu';

const layer = (): HTMLElement => document.createElement('div');
const viewport: ViewportAdapter = {
  clientToWorld: (x, y) => ({ x, y }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};
const workspaceEl = document.createElement('div');

/** jsdom does no layout, so place a port at a chosen world position by hand. */
function placePort(comp: Component, key: string, at: Point): void {
  const el = comp.ports[key]?.el;
  if (!el) throw new Error(`no port ${key}`);
  el.getBoundingClientRect = () =>
    ({ left: at.x, top: at.y, width: 0, height: 0, right: at.x, bottom: at.y }) as DOMRect;
}

describe('component bounds follow rotation', () => {
  it('a quarter turn swaps width and height about the same center', () => {
    const valve = createThrottleValve(layer(), 500, 300);
    const b0 = valve.getBounds();
    setComponentRotation(valve, 90);
    const b90 = valve.getBounds();
    expect(b90.w).toBeCloseTo(b0.h);
    expect(b90.h).toBeCloseTo(b0.w);
    expect(b90.x + b90.w / 2).toBeCloseTo(b0.x + b0.w / 2);
    expect(b90.y + b90.h / 2).toBeCloseTo(b0.y + b0.h / 2);
  });
});

describe('worldPortAnchor', () => {
  it('sends a wire out of the component, away from its center - not toward the other end', () => {
    const valve = createValve52Mono(layer(), 0, 0);
    const c = valve.getBounds();
    const top = { x: c.x + c.w / 2, y: c.y - 10 };
    placePort(valve, '4', top);
    const anchor = worldPortAnchor(viewport, workspaceEl, valve, '4') as PortAnchor;
    expect(anchor.entryOrientation).toBe('V');
    expect(anchor.pilotDir).toBe(-1); // up, even if whatever it connects to is below
  });

  it('turns the exit axis with the component', () => {
    const valve = createValve52Mono(layer(), 0, 0);
    setComponentRotation(valve, 90);
    const c = valve.getBounds();
    // After a quarter turn the valve's top ports sit on its right-hand side.
    placePort(valve, '4', { x: c.x + c.w + 10, y: c.y + c.h / 2 });
    const anchor = worldPortAnchor(viewport, workspaceEl, valve, '4') as PortAnchor;
    expect(anchor.entryOrientation).toBe('H');
    expect(anchor.pilotDir).toBe(1);
  });

  it('turns a pilot port’s fixed exit side with rotation and mirroring', () => {
    const valve = createValve52Mono(layer(), 0, 0);
    placePort(valve, '14', { x: -200, y: 0 });
    // Unrotated, pilot 14 exits to the left.
    expect(worldPortAnchor(viewport, workspaceEl, valve, '14')?.pilotDir).toBe(-1);

    setComponentRotation(valve, 180);
    expect(worldPortAnchor(viewport, workspaceEl, valve, '14')?.pilotDir).toBe(1);

    setComponentRotation(valve, 0);
    setComponentMirrored(valve, true);
    expect(worldPortAnchor(viewport, workspaceEl, valve, '14')?.pilotDir).toBe(1);
  });

  it('leaves a junction dot free to head toward whatever it connects to', () => {
    const junction = createJunction(layer(), 300, 300, 'V');
    placePort(junction, 'P', { x: 300, y: 300 });
    expect(worldPortAnchor(viewport, workspaceEl, junction, 'P')?.pilotDir).toBeUndefined();
  });
});

describe('autoRouteAStar and other wires', () => {
  const from: PortAnchor = { pos: { x: 0, y: 0 }, entryOrientation: 'H' };
  const to: PortAnchor = { pos: { x: 400, y: 0 }, entryOrientation: 'H' };

  it('still crosses another wire in a straight line rather than detouring', () => {
    const crossing: Point[] = [
      { x: 200, y: -200 },
      { x: 200, y: 200 },
    ];
    const points = autoRouteAStar(from, to, [], new Set(), null, null, [crossing]);
    expect(points.every((p) => p.y === 0)).toBe(true);
  });

  it('does not run on top of another wire along the same line', () => {
    const alongside: Point[] = [
      { x: 60, y: 0 },
      { x: 340, y: 0 },
    ];
    const points = autoRouteAStar(from, to, [], new Set(), null, null, [alongside]);
    // It steps off the occupied line onto a parallel one for the shared stretch...
    const offLine = points.filter((p) => p.y !== 0);
    expect(offLine.length).toBeGreaterThan(0);
    expect(Math.min(...offLine.map((p) => p.x))).toBeLessThanOrEqual(60);
    expect(Math.max(...offLine.map((p) => p.x))).toBeGreaterThanOrEqual(340);
    // ...whereas with the line free it would have gone straight along it.
    const free = autoRouteAStar(from, to, [], new Set());
    expect(free.every((p) => p.y === 0)).toBe(true);
  });
});

describe('completeGuides', () => {
  const from: PortAnchor = { pos: { x: 300, y: 580 }, entryOrientation: 'V', pilotDir: -1 };
  const to: PortAnchor = { pos: { x: 720, y: 330 }, entryOrientation: 'V', pilotDir: 1 };

  it('adds the bend the renderer draws when the last guide no longer lines up with the port', () => {
    // One bend at y = 450: its corner (300, 450) and the end stub (720, 344) aren't aligned, so
    // the wire is drawn 300,450 -> 720,450 -> 720,344. That middle bend must be in the list.
    const guides = completeGuides(from, to, [{ type: 'H', pos: 450 }]);
    expect(guides).toEqual([
      { type: 'H', pos: 450 },
      { type: 'V', pos: 720 },
    ]);
    const corners = guideCorners(from, to, guides);
    expect(corners[corners.length - 1]).toEqual({ x: 720, y: 450 });
  });

  it('leaves an already-complete guide list alone', () => {
    const guides = [
      { type: 'H' as const, pos: 450 },
      { type: 'V' as const, pos: 720 },
    ];
    expect(completeGuides(from, to, guides)).toBe(guides);
  });
});

describe('junction', () => {
  it('remembers its branch direction across save and load', () => {
    const saved = createJunction(layer(), 0, 0, 'V').snapshot();
    const loaded = createJunction(layer(), 0, 0);
    loaded.restore(saved);
    expect(loaded.ports.P?.entryOrientation).toBe('V');
  });
});

describe('alignJunctionAnchor', () => {
  const junction: PortAnchor = { pos: { x: 200, y: 100 }, entryOrientation: 'V' };

  it('lets a wire from dead level with the dot come straight in sideways', () => {
    const supply: PortAnchor = { pos: { x: 50, y: 100 }, entryOrientation: 'H', pilotDir: 1 };
    expect(alignJunctionAnchor(junction, supply).entryOrientation).toBe('H');
  });

  it('keeps the dot’s own axis when the other end is off to one side', () => {
    const offset: PortAnchor = { pos: { x: 50, y: 130 }, entryOrientation: 'H', pilotDir: 1 };
    expect(alignJunctionAnchor(junction, offset)).toBe(junction);
  });
});
