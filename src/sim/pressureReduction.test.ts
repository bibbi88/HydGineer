import { describe, expect, it } from 'vitest';
import type { Component, Connection } from '../core/types';
import { computeFrameGraph, portKey, pressureAt } from './pressure';
import { SOURCE_PRESSURE } from './constants';
import { createSource } from '../components/source';
import { createCylinderDouble } from '../components/cylinderDouble';
import { createPressureReducingValve } from '../components/pressureReducingValve';

let version = 0;
function nextVersion(): number {
  return ++version;
}

function compLayer(): HTMLElement {
  return document.createElement('div');
}

function wire(fromId: number, fromPort: string, toId: number, toPort: string): Connection {
  return {
    id: 0,
    from: { id: fromId, port: fromPort },
    to: { id: toId, port: toPort },
    guides: [],
    pathEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    hitEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    labelEl: document.createElementNS('http://www.w3.org/2000/svg', 'text'),
  } as unknown as Connection;
}

function setPressure(valve: Component, bar: number): void {
  valve.restore({ ...valve.snapshot(), outletPressure: bar });
}

describe('pressure reducing valve actually reduces pressure', () => {
  it('caps everything downstream at the set pressure, leaving the supply side alone', () => {
    const source = createSource(compLayer(), 0, 0);
    const reg = createPressureReducingValve(compLayer(), 0, 200);
    setPressure(reg, 2.5);

    const graph = computeFrameGraph(
      [source, reg],
      [wire(source.id, 'OUT', reg.id, 'IN')],
      nextVersion(),
    );

    expect(pressureAt(graph, portKey(reg.id, 'IN'))).toBeCloseTo(SOURCE_PRESSURE);
    expect(pressureAt(graph, portKey(reg.id, 'OUT'))).toBeCloseTo(2.5);
  });

  it('carries the reduced pressure on through the rest of the circuit', () => {
    const source = createSource(compLayer(), 0, 0);
    const reg = createPressureReducingValve(compLayer(), 0, 200);
    const cyl = createCylinderDouble(compLayer(), 0, 400);
    setPressure(reg, 1.5);

    const graph = computeFrameGraph(
      [source, reg, cyl],
      [wire(source.id, 'OUT', reg.id, 'IN'), wire(reg.id, 'OUT', cyl.id, 'A')],
      nextVersion(),
    );

    expect(graph.pressurized.has(portKey(cyl.id, 'A'))).toBe(true);
    expect(pressureAt(graph, portKey(cyl.id, 'A'))).toBeCloseTo(1.5);
  });

  it('a cylinder develops proportionally less force behind a regulator', () => {
    const source = createSource(compLayer(), 0, 0);
    const reg = createPressureReducingValve(compLayer(), 0, 200);
    const cyl = createCylinderDouble(compLayer(), 0, 400);
    cyl.restore({ ...cyl.snapshot(), showForce: true });

    function forceWith(bar: number): number {
      setPressure(reg, bar);
      const graph = computeFrameGraph(
        [source, reg, cyl],
        [wire(source.id, 'OUT', reg.id, 'IN'), wire(reg.id, 'OUT', cyl.id, 'A')],
        nextVersion(),
      );
      cyl.step?.(0.1, {
        dt: 0.1,
        isPressurized: (p) => graph.pressurized.has(portKey(cyl.id, p)),
        flowMultiplierToNearestSource: () => 1,
        flowMultiplierToOpenExhaust: () => 1,
        pressureAt: (p) => pressureAt(graph, portKey(cyl.id, p)),
        emitSignal: () => {},
        readSignal: () => false,
      });
      return Number((cyl.el.textContent ?? '').replace(/[^\d.-]/g, ''));
    }

    const full = forceWith(SOURCE_PRESSURE);
    const half = forceWith(SOURCE_PRESSURE / 2);

    expect(full).toBeGreaterThan(0);
    // Force is linear in pressure, so halving the set pressure halves the force. The label is
    // rounded to whole newtons, so allow a newton either way rather than an exact half.
    expect(Math.abs(half - full / 2)).toBeLessThanOrEqual(1);
  });

  it('only reduces - a set pressure at or above supply leaves the line at supply', () => {
    const source = createSource(compLayer(), 0, 0);
    const reg = createPressureReducingValve(compLayer(), 0, 200);
    setPressure(reg, SOURCE_PRESSURE);

    const graph = computeFrameGraph(
      [source, reg],
      [wire(source.id, 'OUT', reg.id, 'IN')],
      nextVersion(),
    );
    expect(pressureAt(graph, portKey(reg.id, 'OUT'))).toBeCloseTo(SOURCE_PRESSURE);
  });

  it('does not let air back through from OUT to IN', () => {
    // Fed from its OUT side instead: the valve is closed that way, so nothing reaches IN.
    const source = createSource(compLayer(), 0, 0);
    const reg = createPressureReducingValve(compLayer(), 0, 200);
    setPressure(reg, 1);

    const graph = computeFrameGraph(
      [source, reg],
      [wire(source.id, 'OUT', reg.id, 'OUT')],
      nextVersion(),
    );
    expect(graph.pressurized.has(portKey(reg.id, 'IN'))).toBe(false);
    expect(pressureAt(graph, portKey(reg.id, 'IN'))).toBe(0);
  });

  it('an unregulated path in parallel wins, rather than the regulator limiting a line it is not in series with', () => {
    const source = createSource(compLayer(), 0, 0);
    const reg = createPressureReducingValve(compLayer(), 0, 200);
    const cyl = createCylinderDouble(compLayer(), 0, 400);
    setPressure(reg, 1);

    const graph = computeFrameGraph(
      [source, reg, cyl],
      [
        wire(source.id, 'OUT', reg.id, 'IN'),
        wire(reg.id, 'OUT', cyl.id, 'A'),
        // ...and the same port also fed straight from the supply.
        wire(source.id, 'OUT', cyl.id, 'A'),
      ],
      nextVersion(),
    );

    expect(pressureAt(graph, portKey(cyl.id, 'A'))).toBeCloseTo(SOURCE_PRESSURE);
  });

  it('two regulators in series leave the lower of the two settings', () => {
    const source = createSource(compLayer(), 0, 0);
    const first = createPressureReducingValve(compLayer(), 0, 200);
    const second = createPressureReducingValve(compLayer(), 0, 400);
    setPressure(first, 4);
    setPressure(second, 2);

    const graph = computeFrameGraph(
      [source, first, second],
      [wire(source.id, 'OUT', first.id, 'IN'), wire(first.id, 'OUT', second.id, 'IN')],
      nextVersion(),
    );
    expect(pressureAt(graph, portKey(second.id, 'OUT'))).toBeCloseTo(2);

    // Order doesn't matter: the tighter setting governs either way round.
    setPressure(first, 2);
    setPressure(second, 4);
    const reversed = computeFrameGraph(
      [source, first, second],
      [wire(source.id, 'OUT', first.id, 'IN'), wire(first.id, 'OUT', second.id, 'IN')],
      nextVersion(),
    );
    expect(pressureAt(reversed, portKey(second.id, 'OUT'))).toBeCloseTo(2);
  });

  it('reports no pressure at all when the supply is not reaching it', () => {
    const reg = createPressureReducingValve(compLayer(), 0, 200);
    const graph = computeFrameGraph([reg], [], nextVersion());
    expect(pressureAt(graph, portKey(reg.id, 'OUT'))).toBe(0);
  });
});
