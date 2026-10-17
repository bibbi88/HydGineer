import { describe, expect, it } from 'vitest';
import { createValve53Mono } from './valve53Mono';
import type { ConductivityContext } from '../core/types';

function layer(): HTMLElement {
  return document.createElement('div');
}

function ctxWith(pressurized: Partial<Record<string, boolean>>): ConductivityContext {
  return { isPressurized: (p) => pressurized[p] ?? false };
}

describe('createValve53Mono', () => {
  it('rests closed-center (no connections) with neither pilot pressurized', () => {
    const valve = createValve53Mono(layer(), 0, 0);
    expect(valve.conductivityRule(ctxWith({}))).toEqual([]);
  });

  it('shifts to the 1-4/2-3 pattern while only pilot 14 is pressurized', () => {
    const valve = createValve53Mono(layer(), 0, 0);
    valve.onPressureChange?.(ctxWith({ '14': true }));
    expect(valve.conductivityRule(ctxWith({}))).toEqual([
      { a: '1', b: '4' },
      { a: '2', b: '3' },
    ]);
  });

  it('shifts to the 1-2/4-5 pattern while only pilot 12 is pressurized', () => {
    const valve = createValve53Mono(layer(), 0, 0);
    valve.onPressureChange?.(ctxWith({ '12': true }));
    expect(valve.conductivityRule(ctxWith({}))).toEqual([
      { a: '1', b: '2' },
      { a: '4', b: '5' },
    ]);
  });

  it('returns to center - not either working position - once a pilot releases', () => {
    const valve = createValve53Mono(layer(), 0, 0);
    valve.onPressureChange?.(ctxWith({ '14': true }));
    valve.onPressureChange?.(ctxWith({}));
    expect(valve.conductivityRule(ctxWith({}))).toEqual([]);
  });

  it('centers itself (does not pick a side) if both pilots are pressurized at once', () => {
    const valve = createValve53Mono(layer(), 0, 0);
    valve.onPressureChange?.(ctxWith({ '12': true, '14': true }));
    expect(valve.conductivityRule(ctxWith({}))).toEqual([]);
  });

  it('resets to center and restores a saved side state', () => {
    const valve = createValve53Mono(layer(), 0, 0);
    valve.onPressureChange?.(ctxWith({ '12': true }));
    valve.reset();
    expect(valve.conductivityRule(ctxWith({}))).toEqual([]);

    valve.restore({ ...valve.snapshot(), state: 'R' });
    expect(valve.conductivityRule(ctxWith({}))).toEqual([
      { a: '1', b: '2' },
      { a: '4', b: '5' },
    ]);
  });

  it('has the fixed 1/2/3/4/5 ports plus both pilots (12/14)', () => {
    const valve = createValve53Mono(layer(), 0, 0);
    for (const key of ['1', '2', '3', '4', '5', '12', '14']) {
      expect(valve.ports[key], `missing port ${key}`).toBeDefined();
    }
  });

  it('lands the fixed 1/2/3/4/5 ports on the 10px grid, offset from the canvas center', () => {
    const valve = createValve53Mono(layer(), 0, 0);
    for (const key of ['1', '2', '3', '4', '5']) {
      const port = valve.ports[key];
      expect(port, `missing port ${key}`).toBeDefined();
      expect(
        Math.abs(((port?.cx ?? 0) - valve.svgW / 2) % 10),
        `port ${key} cx=${port?.cx} off-grid`,
      ).toBe(0);
      expect(
        Math.abs(((port?.cy ?? 0) - valve.svgH / 2) % 10),
        `port ${key} cy=${port?.cy} off-grid`,
      ).toBe(0);
    }
  });

  it('lands both pilot ports on the 10px grid too, from their own default (center) position', () => {
    // Unlike the fixed ports, the pilots live inside gInner (see drawPilotActuator's own doc),
    // so their world position is gInner's own translate(gx0+shift, gy0) plus their stored local
    // cx/cy - in the default center state that's shift = -cellW.
    const valve = createValve53Mono(layer(), 0, 0);
    const cellW = 80;
    const gx0 = 115;
    const gy0 = 24;
    const shift = -cellW;
    for (const key of ['12', '14']) {
      const port = valve.ports[key];
      expect(port, `missing port ${key}`).toBeDefined();
      const worldX = gx0 + shift + (port?.cx ?? 0);
      const worldY = gy0 + (port?.cy ?? 0);
      expect(Math.abs((worldX - valve.svgW / 2) % 10), `port ${key} worldX off-grid`).toBe(0);
      expect(Math.abs((worldY - valve.svgH / 2) % 10), `port ${key} worldY off-grid`).toBe(0);
    }
  });
});
