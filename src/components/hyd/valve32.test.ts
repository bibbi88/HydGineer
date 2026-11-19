import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../../app/AppState';
import { Modes } from '../../app/modes';
import { stepSimulation, resetHydraulics } from '../../sim/engine';
import { resetSignals, setSignal } from '../../sim/signals';
import { createHydPressureSource, createHydTank } from './supply';
import { createHydCylinderSingle } from './actuators';
import { createHydValve32 } from './valves';
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

/** Source → P, A → single-acting cylinder, T → tank. */
function circuit(valveSettings: Record<string, unknown>) {
  const src = createHydPressureSource(layer(), 0, 0);
  src.restore({ ...src.snapshot(), qMax: 20, pMax: 100 });
  const valve = createHydValve32(layer(), 0, -200);
  valve.restore({ ...valve.snapshot(), ...valveSettings });
  const cyl = createHydCylinderSingle(layer(), 0, -400);
  cyl.restore({ ...cyl.snapshot(), bore: 40, stroke: 100 });
  const tank = createHydTank(layer(), 200, 0);
  for (const c of [src, valve, cyl, tank]) appState.addComponent(c);
  wire(src, 'P', valve, 'P');
  wire(valve, 'A', cyl, 'A');
  wire(valve, 'T', tank, 'T');
  const pos = (): number => Number(cyl.snapshot().pos);
  const run = (s: number): void => {
    for (let i = 0; i < s * 60; i++) stepSimulation(1 / 60);
  };
  return { valve, cyl, pos, run };
}

describe('3/2 valve', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    resetHydraulics();
    resetSignals();
    appState.setMode(Modes.PLAY);
  });

  it('solenoid, normally closed: extends while energised, the spring retracts it after', () => {
    const { pos, run } = circuit({ actuation: 'solenoid', key: 'Y7', normally: 'closed' });
    run(1);
    expect(pos()).toBe(0);
    setSignal('Y7', true);
    run(2);
    expect(pos()).toBe(1);
    setSignal('Y7', false);
    run(3);
    expect(pos()).toBe(0);
  });

  it('normally open: extends at rest', () => {
    const { pos, run } = circuit({ actuation: 'solenoid', key: 'Y7', normally: 'open' });
    run(2);
    expect(pos()).toBe(1);
  });

  it('manual: a click switches it and the detent holds it', () => {
    const { valve, pos, run } = circuit({ actuation: 'lever' });
    valve.el.querySelector('svg')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    run(2);
    expect(pos()).toBe(1);
    valve.el.querySelector('svg')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    run(3);
    expect(pos()).toBe(0);
  });

  it('roller: pressed by the cylinder own end sensor, it stops the stroke there', () => {
    const { cyl, pos, run } = circuit({ actuation: 'roller', normally: 'open' });
    const letter = String(cyl.snapshot().letter);
    const valve = appState.components.find((c) => c.type === 'hydValve32')!;
    valve.restore({ ...valve.snapshot(), sensorKey: `${letter}1` });
    let reached = 0;
    let fellBack = false;
    for (let i = 0; i < 240; i++) {
      run(1 / 60);
      if (pos() >= 0.98) reached++;
      else if (reached > 0) fellBack = true;
    }
    // It reaches the sensor, the roller vents the cylinder, and it drops back off it.
    expect(reached).toBeGreaterThan(0);
    expect(fellBack).toBe(true);
  });

  it('shows its actuation on the symbol', () => {
    const { valve } = circuit({ actuation: 'roller', sensorKey: 'B1' });
    expect(valve.el.querySelectorAll('.hydSpool circle')).toHaveLength(2);
    expect(valve.el.querySelector<SVGElement>('.hydRollerCam')?.style.display).toBe('none');
    expect(valve.el.textContent).toContain('B1');
  });
});
