import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../../app/AppState';
import { Modes } from '../../app/modes';
import { stepSimulation, resetHydraulics } from '../../sim/engine';
import { createHydPressureSource, createHydPump, createHydTank } from './supply';
import { createHydThrottle } from './valves';
import { defaultOrificeSpec, orificeK, type OrificeSpec } from './orificeSpec';
import { orificeKFromDiameter } from '../../sim/hydraulics';
import type { Component } from '../../core/types';

const layer = (): HTMLElement => document.createElement('div');

function wire(a: Component, ap: string, b: Component, bp: string): void {
  appState.addConnection({
    id: appState.connections.length + 1,
    from: { id: a.id, port: ap },
    to: { id: b.id, port: bp },
    guides: [],
    stubStartLen: null,
    stubEndLen: null,
    pathEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    hitEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    labelEl: document.createElementNS('http://www.w3.org/2000/svg', 'text'),
  });
}

const spec = (s: Partial<OrificeSpec>): OrificeSpec => ({ ...defaultOrificeSpec(), ...s });

/** Source → throttle → tank, run to steady state: the source's outlet pressure and the flow. */
function run(source: Component, throttle: Component): { p: number; q: number } {
  const tank = createHydTank(layer(), 0, -400);
  for (const c of [source, throttle, tank]) appState.addComponent(c);
  wire(source, 'P', throttle, 'IN');
  wire(throttle, 'OUT', tank, 'T');
  let frame;
  for (let i = 0; i < 120; i++) frame = stepSimulation(1 / 60);
  const p = frame!.solution.pressure.get(`${source.id}:P`) ?? NaN;
  const q = Number(/Q ([\d.]+)/.exec(source.el.querySelector('.hydInfo')?.textContent ?? '')?.[1]);
  return { p, q };
}

describe('orifice given in other terms', () => {
  it('converts each way to the same kind of coefficient', () => {
    expect(orificeK(spec({ sizing: 'diameter', diameter: 2 }))).toBeCloseTo(
      orificeKFromDiameter(2),
    );
    expect(orificeK(spec({ sizing: 'rating', qRef: 20, dpRef: 4 }))).toBeCloseTo(10);
    // A circle of ⌀2 has area π mm².
    expect(orificeK(spec({ sizing: 'area', area: Math.PI }))).toBeCloseTo(orificeKFromDiameter(2));
    // Kv 1: 16.7 L/min of water at 1 bar; oil (SG 0.87) a little more.
    expect(orificeK(spec({ sizing: 'kv', kv: 1 }))).toBeCloseTo(16.667 / Math.sqrt(0.87), 2);
    expect(orificeK(spec({ sizing: 'cv', cv: 1 }))).toBeCloseTo(
      orificeK(spec({ sizing: 'kv', kv: 0.865 })),
    );
  });

  it('a throttle rated "Q at Δp" passes that flow at that drop', () => {
    appState.components = [];
    appState.connections = [];
    resetHydraulics();
    appState.setMode(Modes.PLAY);
    const pump = createHydPump(layer(), 0, 0);
    pump.restore({ ...pump.snapshot(), displacement: 10, speed: 1200, etaV: 100 });
    const throttle = createHydThrottle(layer(), 0, -200);
    throttle.restore({ ...throttle.snapshot(), sizing: 'rating', qRef: 12, dpRef: 30 });
    const { p, q } = run(pump, throttle);
    expect(q).toBeCloseTo(12, 0);
    expect(p).toBeCloseTo(30, 0);
    expect(throttle.el.textContent).toContain('12 L/min @ 30 bar');
  });

  it('older files (a diameter only) open as before', () => {
    const throttle = createHydThrottle(layer(), 0, 0);
    throttle.restore({ diameter: 3 });
    expect(throttle.snapshot()).toMatchObject({ sizing: 'diameter', diameter: 3 });
  });
});

describe('pressure source', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    resetHydraulics();
    appState.setMode(Modes.PLAY);
  });

  it('gives its max flow while the circuit takes it below the max pressure', () => {
    const src = createHydPressureSource(layer(), 0, 0);
    src.restore({ ...src.snapshot(), qMax: 20, pMax: 150 });
    const throttle = createHydThrottle(layer(), 0, -200);
    throttle.restore({ ...throttle.snapshot(), sizing: 'rating', qRef: 20, dpRef: 50 });
    const { p, q } = run(src, throttle);
    expect(q).toBeCloseTo(20, 0);
    expect(p).toBeCloseTo(50, 0);
  });

  it('holds the max pressure when the circuit would take more', () => {
    const src = createHydPressureSource(layer(), 0, 0);
    src.restore({ ...src.snapshot(), qMax: 20, pMax: 100 });
    const throttle = createHydThrottle(layer(), 0, -200);
    // 20 L/min would need 400 bar here: the source stops at 100 bar, 10 L/min.
    throttle.restore({ ...throttle.snapshot(), sizing: 'rating', qRef: 1, dpRef: 1 });
    const { p, q } = run(src, throttle);
    expect(p).toBeGreaterThan(98);
    expect(p).toBeLessThan(101);
    expect(q).toBeCloseTo(10, 0);
  });
});

describe('pump sized by flow', () => {
  it('works out the displacement from the flow and the motor speed', () => {
    const pump = createHydPump(layer(), 0, 0);
    pump.restore({ ...pump.snapshot(), sizing: 'flow', flowSet: 30, speed: 1500 });
    expect(pump.snapshot()).toMatchObject({ displacement: 20, flowSet: 30 });
    // A new speed keeps the flow and changes the displacement.
    pump.restore({ ...pump.snapshot(), speed: 1000 });
    expect(pump.snapshot()).toMatchObject({ displacement: 30, flowSet: 30 });
    // Back to displacement: the pump stays as it was.
    pump.restore({ ...pump.snapshot(), sizing: 'displacement' });
    expect(pump.snapshot()).toMatchObject({ displacement: 30, flowSet: 30 });
  });
});
