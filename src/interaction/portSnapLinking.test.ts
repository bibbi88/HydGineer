import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { initLinking, isLinking, wireUpPortLinking } from './linking';
import { makeDraggable } from './drag';
import { initWires } from '../wires/connection';
import { createHydTank as createSource } from '../components/hyd/supply';
import { createJunction } from '../components/junction';
import { createHydValve42 } from '../components/hyd/valves';
import { hitBoundsOf } from '../components/shared/svgHelpers';
import type { Component } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';

const viewport: ViewportAdapter = {
  clientToWorld: (x, y) => ({ x, y }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

/** jsdom has no layout: each port circle is placed where the test says it is. */
const portAt = new Map<Element, { x: number; y: number }>();
function place(comp: Component, port: string, x: number, y: number): void {
  const el = comp.ports[port]?.el;
  if (el) portAt.set(el, { x, y });
}

function mouse(type: string, target: EventTarget, x: number, y: number): void {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }),
  );
}

describe('connecting ports', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;
  let source: Component;
  let junction: Component;

  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    appState.setMode(Modes.STOP);
    portAt.clear();
    rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const p = portAt.get(this) ?? { x: -1000, y: -1000 };
      return {
        left: p.x,
        top: p.y,
        right: p.x,
        bottom: p.y,
        width: 0,
        height: 0,
        x: p.x,
        y: p.y,
        toJSON: () => ({}),
      };
    });
    // Not in jsdom; nothing is under the pointer but what the ports' positions say.
    document.elementFromPoint = () => null;
    const workspace = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    initWires(svg, viewport, workspace);
    initLinking(svg, viewport, workspace);
    source = createSource(document.createElement('div'), 100, 100);
    junction = createJunction(document.createElement('div'), 300, 100, 'V');
    for (const c of [source, junction]) {
      appState.addComponent(c);
      wireUpPortLinking(c);
      makeDraggable(c, viewport);
    }
    place(source, 'T', 100, 100);
    place(junction, 'P', 300, 100);
  });
  afterEach(() => rectSpy.mockRestore());

  it('connects when let go near a port, without having to hit its circle', () => {
    mouse('mousedown', source.ports.T!.el, 100, 100);
    expect(isLinking()).toBe(true);
    mouse('mouseup', window, 315, 112); // ~19 px off the junction's port
    expect(appState.connections).toHaveLength(1);
    expect(appState.connections[0]?.to).toEqual({ id: junction.id, port: 'P' });
  });

  it('does not connect when let go well away from any port', () => {
    mouse('mousedown', source.ports.T!.el, 100, 100);
    mouse('mouseup', window, 340, 100);
    expect(appState.connections).toHaveLength(0);
    expect(isLinking()).toBe(false);
  });

  it('starts a wire from a press just beside a port, not only right on it', () => {
    mouse('mousedown', source.el, 108, 106); // 10 px off the port, on the component
    expect(isLinking()).toBe(true);
    mouse('mouseup', window, 300, 100);
    expect(appState.connections).toHaveLength(1);
  });
});

describe('selection outline of a switching valve', () => {
  afterEach(() => appState.setMode(Modes.STOP));

  it('moves with the valve frame, and so does where it can be grabbed', async () => {
    appState.components = [];
    appState.setMode(Modes.STOP);
    const valve = createHydValve42(document.createElement('div'), 200, 200);
    valve.restore({ ...valve.snapshot(), actuation: 'lever' });
    appState.addComponent(valve);
    const outline = valve.el.querySelector<HTMLElement>('.boundsBox')!;
    const restLeft = parseFloat(outline.style.left);
    const restHit = hitBoundsOf(valve.el)!;
    const layout = valve.getBounds();
    const svg = valve.el.querySelector('svg')!;

    // Thrown by its lever (only while simulating), the boxes slide one box (40 px) right.
    appState.setMode(Modes.PLAY);
    svg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await Promise.resolve(); // the outline follows on the frame's own change notice
    expect(parseFloat(outline.style.left) - restLeft).toBeCloseTo(40);
    expect(hitBoundsOf(valve.el)!.x - restHit.x).toBeCloseTo(40);
    // Routing and alignment still go by the valve's own place.
    expect(valve.getBounds()).toEqual(layout);

    svg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await Promise.resolve();
    expect(parseFloat(outline.style.left)).toBeCloseTo(restLeft);
  });
});
