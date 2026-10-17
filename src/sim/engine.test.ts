import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { stepSimulation, resetHydraulics } from './engine';
import { portKey } from './ports';
import { resetSignals, setSignal } from './signals';
import { createHydPump, createHydRelief, createHydTank } from '../components/hyd/supply';
import { createHydValve43 } from '../components/hyd/valves';
import { createHydCylinderDouble } from '../components/hyd/actuators';
import { circleAreaCm2 } from './hydraulics';
import type { Component, Connection } from '../core/types';

function layer(): HTMLElement {
  return document.createElement('div');
}

let nextWire = 1;
function wire(a: Component, ap: string, b: Component, bp: string): Connection {
  const conn: Connection = {
    id: nextWire++,
    from: { id: a.id, port: ap },
    to: { id: b.id, port: bp },
    guides: [],
    stubStartLen: null,
    stubEndLen: null,
    pathEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    hitEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    labelEl: document.createElementNS('http://www.w3.org/2000/svg', 'text'),
  };
  appState.addConnection(conn);
  return conn;
}

function add<T extends Component>(c: T): T {
  appState.addComponent(c);
  return c;
}

/** Pump 10 cm³ × 1450 rpm, relief at 100 bar, 4/3 closed-centre valve, cylinder 50/30. */
function buildCircuit() {
  const pump = add(createHydPump(layer(), 0, 300));
  const relief = add(createHydRelief(layer(), 100, 300));
  const tank = add(createHydTank(layer(), 300, 400));
  const valve = add(createHydValve43(layer(), 300, 200));
  const cyl = add(createHydCylinderDouble(layer(), 300, 0));
  cyl.restore({ ...cyl.snapshot(), bore: 50, rodD: 30, stroke: 200, load: 10000, friction: 0 });
  const supply = wire(pump, 'P', valve, 'P');
  wire(pump, 'P', relief, 'P');
  wire(relief, 'T', tank, 'T');
  wire(valve, 'T', tank, 'T');
  wire(valve, 'A', cyl, 'A');
  wire(valve, 'B', cyl, 'B');
  return { pump, relief, valve, cyl, supply };
}

describe('hydraulic engine on real components', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    resetSignals();
    resetHydraulics();
  });

  it('closed centre: the whole pump flow goes over the relief valve at its setting', () => {
    const { pump, relief, supply } = buildCircuit();
    // Pressure builds up over the first few frames (the oil is slightly compressible).
    for (let i = 0; i < 20; i++) stepSimulation(0.02);
    const frame = stepSimulation(0.02);
    const p = frame.solution.pressure.get(portKey(pump.id, 'P'))!;
    expect(p).toBeGreaterThan(100);
    expect(p).toBeLessThan(102);
    const qPump = frame.solution.portFlow.get(portKey(pump.id, 'P'))!;
    // 14.5 L/min theoretical, 5 % leakage at 250 bar → ~0.29 L/min lost at ~101 bar.
    expect(qPump).toBeCloseTo(14.5 - (14.5 * 0.05 * p) / 250, 3);
    expect(-frame.solution.portFlow.get(portKey(relief.id, 'P'))!).toBeCloseTo(qPump, 3);
    // Wire carrying pump → valve is dead-ended at the closed valve.
    expect(Math.abs(frame.wireFlow.get(supply.id)!)).toBeLessThan(1e-3);
  });

  it('valve shifted: cylinder extends at Q/A with pressure set by the load, then stalls', () => {
    const { pump, relief, cyl } = buildCircuit();
    setSignal('Y1', true);
    for (let i = 0; i < 10; i++) stepSimulation(0.002);
    const frame = stepSimulation(0.002);
    const sol = frame.solution;
    const qPump = sol.portFlow.get(portKey(pump.id, 'P'))!;
    const areaA = circleAreaCm2(50);
    const v = qPump / (areaA * 6);
    const snapV = sol.elementValue.find((x, i) => i >= 0 && Math.abs(x - v) < 1e-6);
    expect(snapV).toBeDefined();
    // Relief stays shut: the load needs well under 100 bar.
    expect(Math.abs(sol.portFlow.get(portKey(relief.id, 'P'))!)).toBeLessThan(1e-3);
    const pA = sol.pressure.get(portKey(cyl.id, 'A'))!;
    const pB = sol.pressure.get(portKey(cyl.id, 'B'))!;
    const areaB = areaA - circleAreaCm2(30);
    // Equal to the load, but for a tiny viscous damping term (< 1 N here).
    expect(Math.abs((pA * areaA - pB * areaB) * 10 - 10000)).toBeLessThan(1);
    expect(pA).toBeGreaterThan(10000 / (areaA * 10));

    // Run until the end of the stroke: 200 mm at ~0.12 m/s takes ~1.7 s.
    for (let i = 0; i < 120; i++) stepSimulation(0.02);
    for (let i = 0; i < 20; i++) stepSimulation(0.02);
    const end = stepSimulation(0.02);
    expect((cyl.snapshot() as { pos: number }).pos).toBe(1);
    const pEnd = end.solution.pressure.get(portKey(pump.id, 'P'))!;
    expect(pEnd).toBeGreaterThan(100);
    expect(-end.solution.portFlow.get(portKey(relief.id, 'P'))!).toBeGreaterThan(14);
  });

  it('a closed-centre valve traps the cylinder: no cavitation, the load is held', () => {
    const { cyl } = buildCircuit();
    setSignal('Y1', true);
    for (let i = 0; i < 30; i++) stepSimulation(0.02);
    setSignal('Y1', false);
    let frame = stepSimulation(0.02);
    for (let i = 0; i < 30; i++) frame = stepSimulation(0.02);
    const pA = frame.solution.pressure.get(portKey(cyl.id, 'A'))!;
    const pB = frame.solution.pressure.get(portKey(cyl.id, 'B'))!;
    expect(pB).toBeGreaterThan(-1);
    const areaA = circleAreaCm2(50);
    const areaB = areaA - circleAreaCm2(30);
    expect(Math.abs((pA * areaA - pB * areaB) * 10 - 10000)).toBeLessThan(5);
  });
});
