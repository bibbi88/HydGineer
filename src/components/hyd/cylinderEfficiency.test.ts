import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../../app/AppState';
import { Modes } from '../../app/modes';
import { stepSimulation, resetHydraulics } from '../../sim/engine';
import { createHydPressureSource, createHydTank } from './supply';
import { createHydCylinderDouble } from './actuators';
import { circleAreaCm2 } from '../../sim/hydraulics';
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

/** Source → A, B → tank; the pressure at A after a short run, and the rod position. */
function extend(cylSettings: Record<string, unknown>, pMax = 200): { pA: number; x: number } {
  const src = createHydPressureSource(layer(), 0, 0);
  src.restore({ ...src.snapshot(), qMax: 5, pMax });
  const cyl = createHydCylinderDouble(layer(), 0, -300);
  cyl.restore({ ...cyl.snapshot(), bore: 50, rodD: 30, stroke: 500, ...cylSettings });
  const tank = createHydTank(layer(), 200, 0);
  for (const c of [src, cyl, tank]) appState.addComponent(c);
  wire(src, 'P', cyl, 'A');
  wire(cyl, 'B', tank, 'T');
  let frame;
  for (let i = 0; i < 30; i++) frame = stepSimulation(1 / 60);
  return {
    pA: frame!.solution.pressure.get(`${cyl.id}:A`) ?? NaN,
    x: Number(cyl.snapshot().pos),
  };
}

describe('cylinder hydromechanical efficiency', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    resetHydraulics();
    appState.setMode(Modes.PLAY);
  });

  it('needs p = F / (A·ηhm) to push a load', () => {
    const { pA, x } = extend({ load: 10000, frictionMode: 'efficiency', etaHm: 80 });
    expect(x).toBeGreaterThan(0);
    expect(pA).toBeCloseTo(10000 / (circleAreaCm2(50) * 10 * 0.8), 0);
  });

  it('stalls once p·A·ηhm is below the load', () => {
    // 100 bar on ⌀50: 19.6 kN of pressure force, 17.7 kN at ηhm 90 % - short of 18 kN.
    const { x } = extend({ load: 18000, frictionMode: 'efficiency', etaHm: 90 }, 100);
    expect(x).toBe(0);
  });

  it('a friction force works as before, and files without the setting open as a force', () => {
    const { pA } = extend({ load: 10000, friction: 0 });
    expect(pA).toBeCloseTo(10000 / (circleAreaCm2(50) * 10), 0);
    const cyl = createHydCylinderDouble(layer(), 0, 0);
    cyl.restore({ friction: 250 });
    expect(cyl.snapshot()).toMatchObject({ frictionMode: 'force', friction: 250 });
  });
});
