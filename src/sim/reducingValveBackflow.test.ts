import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { initWires, createConnection } from '../wires/connection';
import { stepSimulation } from './engine';
import { createSource } from '../components/source';
import { createValve52Mono } from '../components/valve52Mono';
import { createCylinderDouble } from '../components/cylinderDouble';
import { createPressureReducingValve } from '../components/pressureReducingValve';
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

/** A 5/2 valve driving a double-acting cylinder, with a pressure reducing valve fitted either
 * in cylinder port A's own line (`inLine`: valve 4 -> reducing IN, reducing OUT -> cylinder A)
 * or in the supply ahead of the 5/2 valve. Runs a few frames of `stroke` from the opposite end
 * and returns how far the piston moved. */
function run(placement: 'inLine' | 'supply', stroke: 'extend' | 'retract'): number {
  const source = add(createSource(layer(), 0, 0));
  const valve = add(createValve52Mono(layer(), 0, 0));
  const cyl = add(createCylinderDouble(layer(), 0, 0));
  const reducer = add(createPressureReducingValve(layer(), 0, 0));
  const start = stroke === 'extend' ? 0 : 1;
  cyl.restore({ ...cyl.snapshot(), pos: start });

  if (placement === 'supply') {
    wire(source, 'OUT', reducer, 'IN');
    wire(reducer, 'OUT', valve, '1');
    wire(valve, '4', cyl, 'A');
  } else {
    wire(source, 'OUT', valve, '1');
    wire(valve, '4', reducer, 'IN');
    wire(reducer, 'OUT', cyl, 'A');
  }
  wire(valve, '2', cyl, 'B');
  // Piloted: 1 -> 4 (A driven, extend). At rest: 1 -> 2, 4 -> 5 (B driven, A vents).
  if (stroke === 'extend') wire(source, 'OUT', valve, '14');

  for (let i = 0; i < 5; i++) stepSimulation(0.05);
  return Math.abs(pos(cyl) - start);
}

describe('pressure reducing valve does not let air back through', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    initWires(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), viewport, layer());
  });

  it('feeds the cylinder forward through the reducing valve', () => {
    expect(run('inLine', 'extend')).toBeGreaterThan(0);
  });

  it('holds the cylinder when its chamber would have to exhaust back through the reducing valve', () => {
    expect(run('inLine', 'retract')).toBe(0);
  });

  it('fitted in the supply ahead of the 5/2 valve, both strokes still work', () => {
    expect(run('supply', 'extend')).toBeGreaterThan(0);
    appState.components = [];
    appState.connections = [];
    expect(run('supply', 'retract')).toBeGreaterThan(0);
  });
});
