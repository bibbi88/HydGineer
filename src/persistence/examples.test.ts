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

  /** Sets an LS valve's lever slider (−100 … 100) as the viewer would. */
  function setLever(valve: Component, pct: number): void {
    const input = valve.el.querySelector<HTMLInputElement>('input.lsLever')!;
    input.value = String(pct);
    input.dispatchEvent(new Event('input'));
  }
  const flowOut = (f: HydFrame, c: Component, port: string): number =>
    f.solution.portFlow.get(portKey(c.id, port)) ?? NaN;

  it('load sensing: standby in neutral; working, pump = load + margin, flow set by the lever', () => {
    const comps = load('Load sensing: one');
    const pump = byType(comps, 'hydPumpLS');
    const valve = byType(comps, 'hydValveLS');
    const cyl = byType(comps, 'hydCylinderDouble');
    const idle = run(1);
    expect(p(idle, pump, 'P')).toBeGreaterThan(15);
    expect(p(idle, pump, 'P')).toBeLessThan(21);
    expect(flowOut(idle, pump, 'P')).toBeLessThan(1);

    setLever(valve, -50);
    const working = run(0.5);
    // The LS passage inside the open box (A → LS) carries the load pressure, lit like a path.
    expect(valve.el.querySelectorAll('.lsPassage.hydPathP').length).toBeGreaterThanOrEqual(2);
    const pLoad = p(working, cyl, 'A');
    expect(pLoad).toBeGreaterThan(15000 / (31.17 * 10)); // carrying the 15 kN
    const margin = p(working, pump, 'P') - pLoad;
    expect(margin).toBeGreaterThan(15);
    expect(margin).toBeLessThan(21);
    const q50 = flowOut(working, pump, 'P');

    // Same lever, a much lighter load: (nearly) the same flow.
    cyl.restore({ ...cyl.snapshot(), load: 2000 });
    const light = run(0.3);
    expect(Math.abs(flowOut(light, pump, 'P') - q50) / q50).toBeLessThan(0.05);
    // Lever further: more flow.
    setLever(valve, -100);
    const full = run(0.3);
    expect(flowOut(full, pump, 'P')).toBeGreaterThan(q50 * 1.6);
  });

  it('two LS sections: without compensators the light load takes most of the oil', () => {
    const comps = load('Load sensing: two sections and');
    const valves = comps.filter((c) => c.type === 'hydValveLS');
    const cyls = comps.filter((c) => c.type === 'hydCylinderDouble');
    for (const v of valves) {
      expect((v.snapshot() as { compensated: boolean }).compensated).toBe(false);
      setLever(v, -60);
    }
    const f = run(0.4);
    expect(-flowOut(f, cyls[0]!, 'A')).toBeGreaterThan(-flowOut(f, cyls[1]!, 'A') * 2);
  });

  it('two LS sections: built-in section compensators share by lever position', () => {
    const comps = load('Load sensing: two sections and');
    const valves = comps.filter((c) => c.type === 'hydValveLS');
    const cyls = comps.filter((c) => c.type === 'hydCylinderDouble');
    for (const v of valves) {
      v.restore({ ...v.snapshot(), compensated: true });
      setLever(v, -60);
    }
    const f = run(0.4);
    const qa = -flowOut(f, cyls[0]!, 'A');
    const qb = -flowOut(f, cyls[1]!, 'A');
    expect(qa).toBeGreaterThan(1);
    expect(Math.abs(qa - qb) / qa).toBeLessThan(0.1);
  });

  it('separate pressure compensators: equal speeds, unchanged when the other cylinder stalls', () => {
    const comps = load('Load sensing: two sections with separate');
    const valves = comps.filter((c) => c.type === 'hydValveLS');
    const cyls = comps.filter((c) => c.type === 'hydCylinderDouble');
    for (const v of valves) setLever(v, -60);
    let f = run(0.4);
    const qa = -flowOut(f, cyls[0]!, 'A');
    const qb = -flowOut(f, cyls[1]!, 'A');
    expect(qa).toBeGreaterThan(1);
    expect(Math.abs(qa - qb) / qa).toBeLessThan(0.1);
    // Slow the light one down, run the heavy one into its end stop: the pump goes to its
    // cut-off, but the light one keeps exactly its speed.
    setLever(valves[0]!, -20);
    f = run(0.3);
    const qSlow = -flowOut(f, cyls[0]!, 'A');
    setLever(valves[1]!, -100);
    f = run(3);
    expect(snap(cyls[1]!).pos).toBe(1);
    expect(snap(cyls[0]!).pos).toBeLessThan(1);
    expect(p(f, byType(comps, 'hydPumpLS'), 'P')).toBeGreaterThan(240);
    expect(Math.abs(-flowOut(f, cyls[0]!, 'A') - qSlow) / qSlow).toBeLessThan(0.05);
  });

  it('hydrostatic transmission: speed and direction from the swash plate, charge holds the low side', () => {
    const comps = load('Hydrostatic transmission');
    const pump = byType(comps, 'hydPumpLoop');
    const motor = byType(comps, 'hydMotor');
    const swash = (pct: number): void => {
      const input = pump.el.querySelector<HTMLInputElement>('input.swashLever')!;
      input.value = String(pct);
      input.dispatchEvent(new Event('input'));
    };
    /** Motor speed (rpm) as its readout shows it. */
    const rpm = (_f: HydFrame): number =>
      Number(/n (-?\d+) rpm/.exec(motor.el.querySelector('.hydInfo')!.textContent ?? '')?.[1]);

    // Neutral: motor stands, both loop lines sit at charge pressure.
    let f = run(1);
    expect(Math.abs(rpm(f))).toBeLessThan(5);
    for (const port of ['A', 'B']) {
      expect(p(f, pump, port)).toBeGreaterThan(17);
      expect(p(f, pump, port)).toBeLessThan(22);
    }

    // 60 % one way: ~630 rpm (25.2 L/min into 40 cm³/rev, less leakage), Δp = 94 bar for 60 Nm.
    swash(60);
    f = run(1);
    expect(rpm(f)).toBeGreaterThan(560);
    expect(rpm(f)).toBeLessThan(635);
    const dp = Math.abs(p(f, pump, 'A') - p(f, pump, 'B'));
    expect(dp).toBeGreaterThan(92);
    expect(dp).toBeLessThan(97);
    expect(Math.min(p(f, pump, 'A'), p(f, pump, 'B'))).toBeGreaterThan(17); // low side charged

    // Through zero to the other way: same speed, reversed; the high side swaps.
    swash(-60);
    f = run(1);
    expect(rpm(f)).toBeLessThan(-560);
    expect(p(f, pump, 'A')).toBeGreaterThan(p(f, pump, 'B') + 90);

    // Overload: 300 Nm needs 471 bar - the cross-port relief caps the high side and the motor stalls.
    motor.restore({ ...motor.snapshot(), torque: 300 });
    f = run(1);
    expect(Math.abs(rpm(f))).toBeLessThan(5);
    expect(p(f, pump, 'A')).toBeGreaterThan(250);
    expect(p(f, pump, 'A')).toBeLessThan(280);
  });

  it('variable motor: smaller displacement - faster, but more pressure for the same torque', () => {
    const comps = load('Hydrostatic transmission with variable motor');
    const pump = byType(comps, 'hydPumpLoop');
    const motor = byType(comps, 'hydMotorVar');
    const slide = (c: Component, pct: number): void => {
      const input = c.el.querySelector<HTMLInputElement>('input.swashLever')!;
      input.value = String(pct);
      input.dispatchEvent(new Event('input'));
    };
    const rpm = (): number =>
      Number(/n (-?\d+) rpm/.exec(motor.el.querySelector('.hydInfo')!.textContent ?? '')?.[1]);
    const dp = (f: HydFrame): number => p(f, pump, 'B') - p(f, pump, 'A');

    // Full swash, full motor displacement: as the fixed-motor transmission at 100 %.
    slide(pump, 100);
    let f = run(1);
    expect(rpm()).toBeGreaterThan(980);
    expect(rpm()).toBeLessThan(1060);
    expect(dp(f)).toBeGreaterThan(92);
    expect(dp(f)).toBeLessThan(97);

    // Half the displacement: about twice the speed, twice the Δp (20π·60/20 = 188 bar).
    slide(motor, 50);
    f = run(1);
    expect(rpm()).toBeGreaterThan(1950);
    expect(rpm()).toBeLessThan(2100);
    expect(dp(f)).toBeGreaterThan(185);
    expect(dp(f)).toBeLessThan(192);

    // 40 %: 236 bar is still below the 250 bar cross-port reliefs.
    slide(motor, 40);
    f = run(1);
    expect(rpm()).toBeGreaterThan(2400);
    expect(dp(f)).toBeGreaterThan(232);
    expect(dp(f)).toBeLessThan(240);

    // 30 % would need 314 bar: the cross-port relief opens and the motor stalls.
    slide(motor, 30);
    f = run(1);
    expect(Math.abs(rpm())).toBeLessThan(5);
    expect(dp(f)).toBeGreaterThan(245);
    expect(dp(f)).toBeLessThan(262);

    // The slider stops at the minimum-displacement setting.
    slide(motor, 0);
    expect(motor.el.querySelector('.hydInfo')!.textContent).toContain('(30 %)');
  });
});
