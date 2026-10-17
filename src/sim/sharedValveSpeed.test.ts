import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { initWires, createConnection } from '../wires/connection';
import { stepSimulation } from './engine';
import { createSource } from '../components/source';
import { createValve52Mono } from '../components/valve52Mono';
import { createCylinderDouble } from '../components/cylinderDouble';
import { createOneWayFlowControlValve } from '../components/oneWayFlowControlValve';
import type { Component } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';

const layer = (): HTMLElement => document.createElement('div');
const viewport: ViewportAdapter = {
  clientToWorld: (x, y) => ({ x, y }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

function add<T extends Component>(c: T): T {
  appState.addComponent(c);
  return c;
}
function wire(a: Component, ap: string, b: Component, bp: string): void {
  createConnection({ id: a.id, port: ap }, { id: b.id, port: bp });
}
function pos(c: Component): number {
  return (c.snapshot() as { pos: number }).pos;
}

/**
 * One 5/2 valve driving two double-acting cylinders in parallel, with a one-way flow control
 * valve in front of cylinder 2's `side` port only, fitted `meterIn` (throttling air into the
 * cylinder) or meter-out (throttling air coming back out). Runs one `stroke` and returns how
 * far each cylinder moved in the same time.
 */
function run(side: 'A' | 'B', meterIn: boolean, stroke: 'extend' | 'retract') {
  const source = add(createSource(layer(), 0, 0));
  const valve = add(createValve52Mono(layer(), 0, 0));
  const cyl1 = add(createCylinderDouble(layer(), 0, 0));
  const cyl2 = add(createCylinderDouble(layer(), 0, 0));
  const flow = add(createOneWayFlowControlValve(layer(), 0, 0));

  const start = stroke === 'extend' ? 0 : 1;
  cyl1.restore({ ...cyl1.snapshot(), pos: start });
  cyl2.restore({ ...cyl2.snapshot(), pos: start });

  // Valve at rest: 1 -> 2 (B side), 4 -> 5 (A side vents). Piloted: 1 -> 4, 2 -> 3.
  wire(source, 'OUT', valve, '1');
  if (stroke === 'extend') wire(source, 'OUT', valve, '14');
  const valvePort = (cylPort: 'A' | 'B'): string => (cylPort === 'A' ? '4' : '2');
  const other = side === 'A' ? 'B' : 'A';

  wire(valve, valvePort(side), cyl1, side);
  // Free flow IN -> OUT: meter-out lets air in freely and throttles it on the way back out.
  wire(valve, valvePort(side), flow, meterIn ? 'OUT' : 'IN');
  wire(flow, meterIn ? 'IN' : 'OUT', cyl2, side);
  wire(valve, valvePort(other), cyl1, other);
  wire(valve, valvePort(other), cyl2, other);

  for (let i = 0; i < 5; i++) stepSimulation(0.05);
  return { cyl1: Math.abs(pos(cyl1) - start), cyl2: Math.abs(pos(cyl2) - start) };
}

describe('two cylinders on one valve, only one of them speed-controlled', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    initWires(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), viewport, layer());
  });

  // [port the flow control valve sits on, meter-in?, stroke, is cylinder 2 throttled?]
  const cases: Array<['A' | 'B', boolean, 'extend' | 'retract', boolean]> = [
    ['A', false, 'retract', true], // A exhausting through a meter-out valve
    ['A', false, 'extend', false],
    ['B', false, 'extend', true],
    ['B', false, 'retract', false],
    ['A', true, 'extend', true], // A filling through a meter-in valve
    ['A', true, 'retract', false],
    ['B', true, 'retract', true],
    ['B', true, 'extend', false],
  ];

  for (const [side, meterIn, stroke, throttled] of cases) {
    it(`${meterIn ? 'meter-in' : 'meter-out'} on ${side}, ${stroke}: cylinder 1 is never slowed`, () => {
      const moved = run(side, meterIn, stroke);
      expect(moved.cyl1).toBeGreaterThan(0);
      if (throttled) expect(moved.cyl2).toBeCloseTo(moved.cyl1 / 2);
      else expect(moved.cyl2).toBeCloseTo(moved.cyl1);
    });
  }

  it('cylinder 1 moves the same with or without the flow control valve on cylinder 2', () => {
    const withThrottle = run('A', true, 'retract');
    appState.components = [];
    appState.connections = [];
    const reference = run('A', false, 'extend');
    expect(withThrottle.cyl1).toBeCloseTo(reference.cyl1);
  });
});
