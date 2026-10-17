import { beforeEach, describe, expect, it } from 'vitest';
import { createValve53Solenoid } from './solenoidValves';
import { resetSignals, setSignal } from '../sim/signals';
import type { Component, ConductivityContext } from '../core/types';

function layer(): HTMLElement {
  return document.createElement('div');
}

const noPressure: ConductivityContext = { isPressurized: () => false };

/** The valve reads its coils off the signal bus, so energizing one is setSignal + recompute -
 * the same two steps solveElectrical() performs for it in the real sim. */
function energize(valve: Component, ...coils: string[]): void {
  resetSignals();
  for (const c of coils) setSignal(c, true);
  valve.recompute?.();
}

describe('createValve53Solenoid', () => {
  beforeEach(() => resetSignals());

  it('rests closed-center (no connections) with neither coil energized', () => {
    const valve = createValve53Solenoid(layer(), 0, 0);
    expect(valve.conductivityRule(noPressure)).toEqual([]);
  });

  it('shifts to the 1-4/2-3 pattern while only the left coil (Y1) is energized', () => {
    const valve = createValve53Solenoid(layer(), 0, 0);
    energize(valve, 'Y1');
    expect(valve.conductivityRule(noPressure)).toEqual([
      { a: '1', b: '4' },
      { a: '2', b: '3' },
    ]);
  });

  it('shifts to the 1-2/4-5 pattern while only the right coil (Y2) is energized', () => {
    const valve = createValve53Solenoid(layer(), 0, 0);
    energize(valve, 'Y2');
    expect(valve.conductivityRule(noPressure)).toEqual([
      { a: '1', b: '2' },
      { a: '4', b: '5' },
    ]);
  });

  it('springs back to center - not the other side - once a coil de-energizes', () => {
    const valve = createValve53Solenoid(layer(), 0, 0);
    energize(valve, 'Y1');
    energize(valve);
    expect(valve.conductivityRule(noPressure)).toEqual([]);
  });

  it('centers itself (does not latch or pick a side) with both coils energized at once', () => {
    const valve = createValve53Solenoid(layer(), 0, 0);
    energize(valve, 'Y1', 'Y2');
    expect(valve.conductivityRule(noPressure)).toEqual([]);
  });

  it('follows renamed coils rather than the Y1/Y2 defaults', () => {
    const valve = createValve53Solenoid(layer(), 0, 0);
    valve.restore({ ...valve.snapshot(), key14: 'K7' });
    energize(valve, 'Y1');
    expect(valve.conductivityRule(noPressure)).toEqual([]);
    energize(valve, 'K7');
    expect(valve.conductivityRule(noPressure)).toEqual([
      { a: '1', b: '4' },
      { a: '2', b: '3' },
    ]);
  });

  it('has only the fixed 1/2/3/4/5 ports - the solenoids replace the pneumatic pilots', () => {
    const valve = createValve53Solenoid(layer(), 0, 0);
    for (const key of ['1', '2', '3', '4', '5']) {
      expect(valve.ports[key], `missing port ${key}`).toBeDefined();
    }
    expect(valve.ports['12']).toBeUndefined();
    expect(valve.ports['14']).toBeUndefined();
  });

  it('round-trips its coil names and position, and resets to center', () => {
    const valve = createValve53Solenoid(layer(), 0, 0);
    valve.restore({ ...valve.snapshot(), key14: 'K1', key12: 'K2', state: 'R' });
    const snap = valve.snapshot();
    expect(snap).toMatchObject({ key14: 'K1', key12: 'K2', state: 'R' });

    const restored = createValve53Solenoid(layer(), 10, 10);
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);

    valve.reset();
    expect(valve.conductivityRule(noPressure)).toEqual([]);
  });

  it('lands the fixed 1/2/3/4/5 ports on the 10px grid, offset from the canvas center', () => {
    const valve = createValve53Solenoid(layer(), 0, 0);
    for (const key of ['1', '2', '3', '4', '5']) {
      const port = valve.ports[key];
      expect(Math.abs(((port?.cx ?? 0) - valve.svgW / 2) % 10), `port ${key} cx off-grid`).toBe(0);
      expect(Math.abs(((port?.cy ?? 0) - valve.svgH / 2) % 10), `port ${key} cy off-grid`).toBe(0);
    }
  });
});
