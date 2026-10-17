import { describe, expect, it, vi } from 'vitest';
import { createQuickExhaustValve } from './quickExhaustValve';
import { createOneWayFlowControlValve } from './oneWayFlowControlValve';
import { createThrottleValve } from './throttleValve';
import { createTimeDelayValve } from './timeDelayValve';
import { SOURCE_PRESSURE } from '../sim/constants';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

function stepCtx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    dt: 0.1,
    isPressurized: () => false,
    flowMultiplierToNearestSource: () => 1,
    flowMultiplierToOpenExhaust: () => 1,
    pressureAt: () => SOURCE_PRESSURE,
    emitSignal: vi.fn(),
    readSignal: () => false,
    ...overrides,
  };
}

describe('quickExhaustValve', () => {
  it('passes supply through to the cylinder when port 1 is pressurized', () => {
    const valve = createQuickExhaustValve(compLayer(), 0, 0);
    const edges = valve.conductivityRule({ isPressurized: (p) => p === '1' });
    expect(edges).toEqual([{ a: '1', b: '2' }]);
  });

  it('opens a one-way vent from 2 to 3 when port 1 is not pressurized', () => {
    const valve = createQuickExhaustValve(compLayer(), 0, 0);
    const edges = valve.conductivityRule({ isPressurized: () => false });
    expect(edges).toEqual([{ a: '2', b: '3', directed: true }]);
  });

  it('colors the supply-to-cylinder path pressurized (red), not exhausting (amber)', () => {
    // Regression test: both directions previously shared one generic "exhausting" amber class,
    // which is only correct for the genuine 2->3 vent to atmosphere - 1->2 is ordinary supply
    // reaching the cylinder and should read the same red as any other pressurized wire.
    const valve = createQuickExhaustValve(compLayer(), 0, 0);
    valve.step?.(0.1, stepCtx({ isPressurized: (p: string) => p === '1' }));

    expect(valve.el.querySelectorAll('.qevFlowPath--pressurized').length).toBeGreaterThan(0);
    expect(valve.el.querySelectorAll('.qevFlowPath--exhausting').length).toBe(0);
  });

  it('colors the exhaust-to-atmosphere path exhausting (amber), not pressurized (red)', () => {
    const valve = createQuickExhaustValve(compLayer(), 0, 0);
    valve.step?.(0.1, stepCtx({ isPressurized: () => false }));

    expect(valve.el.querySelectorAll('.qevFlowPath--exhausting').length).toBeGreaterThan(0);
    expect(valve.el.querySelectorAll('.qevFlowPath--pressurized').length).toBe(0);
  });
});

describe('oneWayFlowControlValve', () => {
  it('always conducts IN<->OUT but throttles only the OUT->IN direction', () => {
    const valve = createOneWayFlowControlValve(compLayer(), 0, 0);
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual([{ a: 'IN', b: 'OUT' }]);
    expect(valve.flowMultiplier?.('IN', 'OUT')).toBe(1);
    expect(valve.flowMultiplier?.('OUT', 'IN')).toBeCloseTo(0.5);
  });

  it('flowPct can be adjusted live via restore(), like the inspector does mid-simulation', () => {
    const valve = createOneWayFlowControlValve(compLayer(), 0, 0);
    valve.restore({ ...valve.snapshot(), flowPct: 25 });
    expect(valve.flowMultiplier?.('OUT', 'IN')).toBeCloseTo(0.25);
  });
});

describe('throttleValve', () => {
  it('throttles both directions equally, unlike the one-way flow control valve', () => {
    const valve = createThrottleValve(compLayer(), 0, 0);
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual([{ a: 'IN', b: 'OUT' }]);
    expect(valve.flowMultiplier?.('IN', 'OUT')).toBeCloseTo(0.5);
    expect(valve.flowMultiplier?.('OUT', 'IN')).toBeCloseTo(0.5);
  });

  it('flowPct can be adjusted live via restore(), like the inspector does mid-simulation', () => {
    const valve = createThrottleValve(compLayer(), 0, 0);
    valve.restore({ ...valve.snapshot(), flowPct: 10 });
    expect(valve.flowMultiplier?.('IN', 'OUT')).toBeCloseTo(0.1);
    expect(valve.flowMultiplier?.('OUT', 'IN')).toBeCloseTo(0.1);
  });
});

describe('timeDelayValve', () => {
  it('stays on the exhaust path until the pilot has been held for delaySec', () => {
    const valve = createTimeDelayValve(compLayer(), 0, 0);
    // default delaySec is 1.0s; step with a pressurized pilot in 0.1s increments
    for (let i = 0; i < 5; i++) {
      valve.step?.(0.1, stepCtx({ isPressurized: () => true }));
    }
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual([{ a: '2', b: '3' }]);

    for (let i = 0; i < 6; i++) {
      valve.step?.(0.1, stepCtx({ isPressurized: () => true }));
    }
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual([{ a: '2', b: '1' }]);
  });

  it('resets immediately once the pilot depressurizes', () => {
    const valve = createTimeDelayValve(compLayer(), 0, 0);
    for (let i = 0; i < 15; i++) {
      valve.step?.(0.1, stepCtx({ isPressurized: () => true }));
    }
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual([{ a: '2', b: '1' }]);

    valve.step?.(0.1, stepCtx({ isPressurized: () => false }));
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual([{ a: '2', b: '3' }]);
  });
});
