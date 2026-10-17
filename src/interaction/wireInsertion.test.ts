import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../app/AppState';
import {
  findNearestWireHit,
  isWireInsertableType,
  setWireInsertHighlight,
  trySpliceOntoWire,
} from './wireInsertion';
import { initWires, createConnection } from '../wires/connection';
import { createJunction } from '../components/junction';
import { CHECK_VALVE_TYPE } from '../components/checkValve';
import { QUICK_EXHAUST_VALVE_TYPE } from '../components/quickExhaustValve';
import { JUNCTION_TYPE } from '../components/junction';
import { createSource } from '../components/source';
import { PUSH_BUTTON_32_TYPE } from '../components/pushButton32';
import { AIR_VALVE_32_TYPE } from '../components/airValve32';
import { LIMIT_VALVE_32_TYPE } from '../components/limitValve32';
import { portGlobalPosition } from '../geometry/coords';
import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

const ctx: ComponentFactoryContext = { compLayer: compLayer() };
const workspaceEl = document.createElement('div');
// The identity: with scale 1 and tx/ty 0, "world" and "screen/client" coordinates coincide, so
// the fake getBoundingClientRect() below (see fakePortRect) can hand back world positions
// directly.
const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

/**
 * jsdom never lays anything out, so every element's real getBoundingClientRect() comes back all
 * zeros regardless of its actual CSS position/transform - which would make every port in this
 * test resolve to the same (0, 0) spot no matter which component or wire it belongs to, and this
 * feature is entirely about wire *geometry*, so that gap can't just be shrugged off here.
 *
 * This reconstructs a port's real rendered position purely from DOM state jsdom does track
 * (attributes and inline styles - never real layout): the owning .comp div's left/top (its
 * world position) and data-rot (its rotation, always a clean 90deg step), the port circle's own
 * cx/cy attributes, and its parent <g>'s translate(gx,gy) if it's drawn inside one (several
 * components, e.g. checkValve, draw their ports inside such a group rather than directly on the
 * svg canvas). It's the same reasoning geometry/coords.ts's own portGlobalPosition doc explains
 * for why that function measures the DOM live rather than computing this analytically in the
 * app itself - here it's only a test double standing in for a real browser's layout engine.
 */
function fakePortRect(el: Element): DOMRect {
  const zero = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  if (el.tagName !== 'circle') return { ...zero, toJSON: () => zero } as DOMRect;

  const compEl = el.closest('.comp') as HTMLElement | null;
  const svgEl = compEl?.querySelector('svg.compSvg') as SVGSVGElement | null;
  if (!compEl || !svgEl) return { ...zero, toJSON: () => zero } as DOMRect;

  const x = parseFloat(compEl.style.left) || 0;
  const y = parseFloat(compEl.style.top) || 0;
  const rot = ((Number(compEl.dataset.rot ?? '0') % 360) + 360) % 360;
  const svgW = Number(svgEl.getAttribute('width') ?? 0);
  const svgH = Number(svgEl.getAttribute('height') ?? 0);

  let gx = 0;
  let gy = 0;
  const parentTransform = el.parentElement?.getAttribute('transform') ?? '';
  const m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(parentTransform);
  if (m) {
    gx = Number(m[1]);
    gy = Number(m[2]);
  }

  const localX = Number(el.getAttribute('cx') ?? 0) + gx;
  const localY = Number(el.getAttribute('cy') ?? 0) + gy;
  const dx0 = localX - svgW / 2;
  const dy0 = localY - svgH / 2;
  let dx = dx0;
  let dy = dy0;
  if (rot === 90) {
    dx = -dy0;
    dy = dx0;
  } else if (rot === 180) {
    dx = -dx0;
    dy = -dy0;
  } else if (rot === 270) {
    dx = dy0;
    dy = -dx0;
  }

  const wx = x + dx;
  const wy = y + dy;
  const rect = { left: wx, top: wy, right: wx, bottom: wy, width: 0, height: 0, x: wx, y: wy };
  return { ...rect, toJSON: () => rect } as DOMRect;
}

describe('trySpliceOntoWire', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    initWires(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement,
      viewport,
      workspaceEl,
    );
    rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return fakePortRect(this);
    });
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it('only accepts the three plain pass-through valve types', () => {
    expect(isWireInsertableType(CHECK_VALVE_TYPE)).toBe(true);
    expect(isWireInsertableType(JUNCTION_TYPE)).toBe(false);
  });

  it('does nothing and returns null when nothing is close enough to the drop point', () => {
    const a = createJunction(compLayer(), 300, 100, 'V');
    const b = createJunction(compLayer(), 300, 500, 'V');
    appState.addComponent(a);
    appState.addComponent(b);
    createConnection({ id: a.id, port: 'P' }, { id: b.id, port: 'P' });

    const result = trySpliceOntoWire(
      CHECK_VALVE_TYPE,
      ctx,
      viewport,
      workspaceEl,
      { x: 900, y: 900 }, // far from the wire between (300,100) and (300,500)
    );

    expect(result).toBeNull();
    expect(appState.connections).toHaveLength(1);
    expect(appState.components).toHaveLength(2);
  });

  it('splices a check valve into a straight vertical wire, replacing it with two connections either side', () => {
    const a = createJunction(compLayer(), 300, 100, 'V');
    const b = createJunction(compLayer(), 300, 500, 'V');
    appState.addComponent(a);
    appState.addComponent(b);
    const original = createConnection({ id: a.id, port: 'P' }, { id: b.id, port: 'P' });

    const comp = trySpliceOntoWire(CHECK_VALVE_TYPE, ctx, viewport, workspaceEl, {
      x: 300,
      y: 280,
    });

    expect(comp).not.toBeNull();
    expect(comp?.type).toBe(CHECK_VALVE_TYPE);
    // Snapped onto the wire's own line (x stays exactly 300, the whole wire's x) at the drop's y.
    expect(comp?.x).toBe(300);
    expect(comp?.y).toBe(280);
    // Vertical wire - the check valve's own default (unrotated) orientation, so no rotation
    // needed to land its ports on the line.
    expect(comp?.el.dataset.rot ?? '0').toBe('0');

    // The original connection is gone, replaced by exactly two new ones through the new valve.
    expect(appState.connections.some((c) => c.id === original.id)).toBe(false);
    expect(appState.connections).toHaveLength(2);
    expect(appState.components).toHaveLength(3);

    const fromA = appState.connections.find((c) => c.from.id === a.id && c.from.port === 'P');
    const toB = appState.connections.find((c) => c.to.id === b.id && c.to.port === 'P');
    expect(fromA).toBeDefined();
    expect(toB).toBeDefined();
    expect(fromA?.to.id).toBe(comp?.id);
    expect(toB?.from.id).toBe(comp?.id);
    // a (junction A, above) is the wire's "from" side - the check valve's OUT port sits above
    // its center by default (unrotated), so that's the one that ends up nearer to it.
    expect(fromA?.to.port).toBe('OUT');
    expect(toB?.from.port).toBe('IN');
  });

  it('rotates 90deg to match a horizontal wire, still landing exactly on its line', () => {
    const a = createJunction(compLayer(), 100, 300, 'H');
    const b = createJunction(compLayer(), 500, 300, 'H');
    appState.addComponent(a);
    appState.addComponent(b);
    createConnection({ id: a.id, port: 'P' }, { id: b.id, port: 'P' });

    const comp = trySpliceOntoWire(CHECK_VALVE_TYPE, ctx, viewport, workspaceEl, {
      x: 280,
      y: 300,
    });

    expect(comp).not.toBeNull();
    expect(comp?.el.dataset.rot).toBe('90');
    expect(comp?.x).toBe(280);
    expect(comp?.y).toBe(300);
  });

  it('splices a quick exhaust valve in: port 1 on the wire line, port 2 to the far end, port 3 free', () => {
    const a = createJunction(compLayer(), 300, 100, 'V');
    const b = createJunction(compLayer(), 300, 500, 'V');
    appState.addComponent(a);
    appState.addComponent(b);
    createConnection({ id: a.id, port: 'P' }, { id: b.id, port: 'P' });

    const comp = trySpliceOntoWire(QUICK_EXHAUST_VALVE_TYPE, ctx, viewport, workspaceEl, {
      x: 300,
      y: 280,
    });

    expect(comp?.type).toBe(QUICK_EXHAUST_VALVE_TYPE);
    expect(appState.connections).toHaveLength(2);
    const p1 = appState.connections.find((c) => c.from.port === '1' || c.to.port === '1');
    const p2 = appState.connections.find((c) => c.from.port === '2' || c.to.port === '2');
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(appState.connections.some((c) => c.from.port === '3' || c.to.port === '3')).toBe(false);
    // No cylinder at either end -> outlet (2) goes to the wire's "to" end (b), inlet (1) to a.
    expect(p1?.from.id).toBe(a.id);
    expect(p2?.to.id).toBe(b.id);
  });

  it('splices a 3/2 valve in with port 1 toward the supply, port 2 toward the consumer, port 3 free', () => {
    // Plain wire, no source or cylinder at either end: the wire's "from" end (a, above) is
    // taken as the supply side.
    const a = createJunction(compLayer(), 300, 100, 'V');
    const b = createJunction(compLayer(), 300, 500, 'V');
    appState.addComponent(a);
    appState.addComponent(b);
    createConnection({ id: a.id, port: 'P' }, { id: b.id, port: 'P' });

    const comp = trySpliceOntoWire(PUSH_BUTTON_32_TYPE, ctx, viewport, workspaceEl, {
      x: 300,
      y: 280,
    });
    if (!comp) throw new Error('expected a splice');

    expect(appState.connections).toHaveLength(2);
    expect(appState.connections.find((c) => c.to.id === comp.id)?.to.port).toBe('1');
    expect(appState.connections.find((c) => c.from.id === comp.id)?.from.port).toBe('2');
    expect(appState.connections.some((c) => c.from.port === '3' || c.to.port === '3')).toBe(false);
    // Port 1 sits exactly on the wire at the drop point, port 2 further along the same line,
    // toward b - which takes flipping the valve over (unrotated, port 1 is at the bottom).
    expect(comp.el.dataset.rot).toBe('180');
    expect(portGlobalPosition(viewport, workspaceEl, comp, '1')).toEqual({ x: 300, y: 280 });
    const p2 = portGlobalPosition(viewport, workspaceEl, comp, '2');
    expect(p2.x).toBe(300);
    expect(p2.y).toBeGreaterThan(280);
  });

  it('puts a 3/2 valve\'s port 1 toward a pressure source even when it is the wire\'s "to" end', () => {
    const a = createJunction(compLayer(), 300, 100, 'V');
    const source = createSource(compLayer(), 300, 500);
    appState.addComponent(a);
    appState.addComponent(source);
    createConnection({ id: a.id, port: 'P' }, { id: source.id, port: 'OUT' });

    const comp = trySpliceOntoWire(AIR_VALVE_32_TYPE, ctx, viewport, workspaceEl, {
      x: 300,
      y: 280,
    });
    if (!comp) throw new Error('expected a splice');

    const toSource = appState.connections.find((c) => c.to.id === source.id);
    expect(toSource?.from).toEqual({ id: comp.id, port: '1' });
    expect(appState.connections.find((c) => c.from.id === a.id)?.to).toEqual({
      id: comp.id,
      port: '2',
    });
    // Unrotated already has port 1 at the bottom, facing the source below.
    expect(comp.el.dataset.rot ?? '0').toBe('0');
    expect(portGlobalPosition(viewport, workspaceEl, comp, '1')).toEqual({ x: 300, y: 280 });
  });

  it('turns a 3/2 valve sideways for a horizontal wire, port 1 still on the line', () => {
    const a = createJunction(compLayer(), 100, 300, 'H');
    const b = createJunction(compLayer(), 500, 300, 'H');
    appState.addComponent(a);
    appState.addComponent(b);
    createConnection({ id: a.id, port: 'P' }, { id: b.id, port: 'P' });

    const comp = trySpliceOntoWire(LIMIT_VALVE_32_TYPE, ctx, viewport, workspaceEl, {
      x: 280,
      y: 300,
    });
    if (!comp) throw new Error('expected a splice');

    expect(['90', '270']).toContain(comp.el.dataset.rot);
    expect(portGlobalPosition(viewport, workspaceEl, comp, '1')).toEqual({ x: 280, y: 300 });
    const p2 = portGlobalPosition(viewport, workspaceEl, comp, '2');
    expect(p2.y).toBe(300);
    expect(p2.x).toBeGreaterThan(280); // toward b, away from the supply end a
  });

  it('leaves the wire alone for a component type that is not wire-insertable', () => {
    const a = createJunction(compLayer(), 300, 100, 'V');
    const b = createJunction(compLayer(), 300, 500, 'V');
    appState.addComponent(a);
    appState.addComponent(b);
    createConnection({ id: a.id, port: 'P' }, { id: b.id, port: 'P' });

    const result = trySpliceOntoWire(JUNCTION_TYPE, ctx, viewport, workspaceEl, { x: 300, y: 280 });

    expect(result).toBeNull();
    expect(appState.connections).toHaveLength(1);
    expect(appState.components).toHaveLength(2);
  });

  it('setWireInsertHighlight marks and clears the previewed wire, and moves cleanly between wires', () => {
    const a = createJunction(compLayer(), 300, 100, 'V');
    const b = createJunction(compLayer(), 300, 500, 'V');
    const c = createJunction(compLayer(), 700, 100, 'V');
    const d = createJunction(compLayer(), 700, 500, 'V');
    appState.addComponent(a);
    appState.addComponent(b);
    appState.addComponent(c);
    appState.addComponent(d);
    const connAB = createConnection({ id: a.id, port: 'P' }, { id: b.id, port: 'P' });
    const connCD = createConnection({ id: c.id, port: 'P' }, { id: d.id, port: 'P' });

    const hit = findNearestWireHit(viewport, workspaceEl, { x: 300, y: 280 });
    expect(hit?.conn.id).toBe(connAB.id);

    setWireInsertHighlight(hit?.conn ?? null);
    expect(connAB.pathEl.classList.contains('wireInsertTarget')).toBe(true);
    expect(connAB.hitEl.classList.contains('wireInsertTarget')).toBe(true);
    expect(connCD.pathEl.classList.contains('wireInsertTarget')).toBe(false);

    // Dragging over to the other wire moves the highlight instead of leaving both marked.
    setWireInsertHighlight(connCD);
    expect(connAB.pathEl.classList.contains('wireInsertTarget')).toBe(false);
    expect(connCD.pathEl.classList.contains('wireInsertTarget')).toBe(true);

    setWireInsertHighlight(null);
    expect(connCD.pathEl.classList.contains('wireInsertTarget')).toBe(false);
  });
});
