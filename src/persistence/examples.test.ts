import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { componentRegistry } from '../components/registry';
import { stepSimulation, resetHydraulics } from '../sim/engine';
import { resetSignals } from '../sim/signals';
import { portKey } from '../sim/ports';
import { EXAMPLES } from './examples';
import type { Component } from '../core/types';
import type { HydFrame } from '../sim/engine';

/** Builds an example straight into appState (no DOM wiring needed for the physics). */
function load(title: string): Component[] {
  const ex = EXAMPLES.find((e) => e.title.startsWith(title));
  if (!ex) throw new Error(`no example "${title}"`);
  appState.components = [];
  appState.connections = [];
  const file = ex.file();
  const ids = new Map<number, number>();
  const comps: Component[] = [];
  for (const c of file.comps) {
    const comp = componentRegistry
      .get(c.type)!
      .factory({ compLayer: document.createElement('div') }, c.x, c.y);
    comp.restore({ ...comp.snapshot(), ...c.data });
    appState.addComponent(comp);
    ids.set(c.id, comp.id);
    comps.push(comp);
  }
  let id = 1;
  for (const c of file.conns) {
    appState.addConnection({
      id: id++,
      from: { id: ids.get(c.from.id)!, port: c.from.port },
      to: { id: ids.get(c.to.id)!, port: c.to.port },
      guides: [],
      stubStartLen: null,
      stubEndLen: null,
      pathEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
      hitEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
      labelEl: document.createElementNS('http://www.w3.org/2000/svg', 'text'),
    });
  }
  return comps;
}

function byType(comps: Component[], type: string): Component {
  const c = comps.find((x) => x.type === type);
  if (!c) throw new Error(`no ${type}`);
  return c;
}

/** Throws a hand lever: jsdom has no layout, so a click at x < 0 counts as the left half. */
function lever(valve: Component, side: 'left' | 'right'): void {
  valve.el
    .querySelector('svg')!
    .dispatchEvent(new MouseEvent('mousedown', { clientX: side === 'left' ? -1 : 1 }));
}

function run(seconds: number): HydFrame {
  let frame: HydFrame | undefined;
  for (let t = 0; t < seconds; t += 1 / 60) frame = stepSimulation(1 / 60);
  return frame!;
}

const p = (frame: HydFrame, comp: Component, port: string): number =>
  frame.solution.pressure.get(portKey(comp.id, port)) ?? NaN;

const snap = (c: Component): { pos: number } => c.snapshot() as unknown as { pos: number };

describe('example circuits behave as described', () => {
  beforeEach(() => {
    resetSignals();
    resetHydraulics();
    appState.setMode(Modes.PLAY);
  });

  it('accumulator charges, the pressure switch cuts the pump out, the cylinder strokes fast', () => {
    const comps = load('Accumulator');
    const acc = byType(comps, 'hydAccumulator');
    const pump = byType(comps, 'hydPump');
    let frame = run(20);
    // Charged to the switch's 120 bar; the pump has been stopped.
    expect(p(frame, acc, 'P')).toBeGreaterThan(118);
    expect(pump.el.querySelector('circle[fill="#d8f5dc"]')).toBeNull();
    // Stroke: far faster than 4 L/min would allow (that would be ~0.034 m/s).
    lever(byType(comps, 'hydValve43'), 'left');
    frame = run(0.3);
    const cyl = byType(comps, 'hydCylinderDouble');
    const vIdx = frame.solution.elementValue.findIndex((v) => v > 0.05);
    expect(vIdx).toBeGreaterThanOrEqual(0);
    expect(snap(cyl).pos).toBeGreaterThan(0.05);
  });

  it('counterbalance: lifts, holds when centred, lowers only while driven', () => {
    const comps = load('Lifting and lowering');
    const valve = byType(comps, 'hydValve43');
    const cyl = byType(comps, 'hydCylinderDouble');
    lever(valve, 'left');
    run(2);
    const lifted = snap(cyl).pos;
    expect(lifted).toBeGreaterThan(0.3);
    lever(valve, 'left'); // back to centre
    const held = run(2);
    expect(Math.abs(snap(cyl).pos - lifted)).toBeLessThan(0.01);
    expect(p(held, cyl, 'A')).toBeGreaterThan(60); // the CBV holds the load's pressure
    lever(valve, 'right');
    const lowering = run(1);
    expect(snap(cyl).pos).toBeLessThan(lifted - 0.05);
    // Controlled: no line is sucked into cavitation.
    for (const v of lowering.solution.pressure.values()) expect(v).toBeGreaterThan(-0.5);
  });

  it('pressure-compensated pump: clamped at 100 bar with almost no flow, relief shut', () => {
    const comps = load('Clamping');
    lever(byType(comps, 'hydValve43'), 'left');
    const frame = run(3);
    const pump = byType(comps, 'hydPump');
    const relief = byType(comps, 'hydRelief');
    const pP = p(frame, pump, 'P');
    expect(pP).toBeGreaterThan(95);
    expect(pP).toBeLessThan(100.5);
    expect(frame.solution.portFlow.get(portKey(pump.id, 'P'))!).toBeLessThan(0.5);
    expect(Math.abs(frame.solution.portFlow.get(portKey(relief.id, 'P'))!)).toBeLessThan(0.01);
  });

  it('inertia: stopping the moving mass raises a rod-side peak far above pump pressure', () => {
    const comps = load('Inertia');
    const valve = byType(comps, 'hydValve43');
    const cyl = byType(comps, 'hydCylinderDouble');
    lever(valve, 'left');
    run(2);
    lever(valve, 'left'); // centre: everything blocked while the mass is still moving
    run(1);
    const info = cyl.el.querySelector('.hydInfo')!.textContent ?? '';
    const peakB = Number(/B (\d+) bar/.exec(info)?.[1]);
    expect(peakB).toBeGreaterThan(80);
    expect(peakB).toBeLessThan(250);
  });
});
