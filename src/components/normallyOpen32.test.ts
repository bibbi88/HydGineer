import { describe, expect, it } from 'vitest';
import { createPushButton32 } from './pushButton32';
import { createLimitValve32 } from './limitValve32';
import { createAirValve32 } from './airValve32';
import { createTimeDelayValve } from './timeDelayValve';
import type { Component } from '../core/types';

function layer(): HTMLElement {
  return document.createElement('div');
}

const CLOSED = [{ a: '2', b: '3' }];
const OPEN = [{ a: '2', b: '1' }];
const noPressure = { isPressurized: () => false };

/** Every 3/2 valve in the family shares buildSlidingValve32Body, so they all get the swap from
 * the same place - this checks each one actually wired it up rather than only the push button. */
const FAMILY: Array<{ name: string; make: () => Component }> = [
  { name: 'pushButton32', make: () => createPushButton32(layer(), 0, 0) },
  { name: 'limitValve32', make: () => createLimitValve32(layer(), 0, 0) },
  { name: 'airValve32', make: () => createAirValve32(layer(), 0, 0) },
  { name: 'timeDelayValve', make: () => createTimeDelayValve(layer(), 0, 0) },
];

describe('normally-open option across the 3/2 valve family', () => {
  for (const { name, make } of FAMILY) {
    describe(name, () => {
      it('defaults to normally closed: blocks 1 and vents 2 to 3 at rest', () => {
        const valve = make();
        expect(valve.snapshot().normallyOpen).toBe(false);
        expect(valve.conductivityRule(noPressure)).toEqual(CLOSED);
      });

      it('passes 1 through to 2 at rest once set normally open', () => {
        const valve = make();
        valve.restore({ ...valve.snapshot(), normallyOpen: true });
        expect(valve.conductivityRule(noPressure)).toEqual(OPEN);
      });

      it('swaps the two cells rather than moving the mover, so the actuator stays put', () => {
        const valve = make();
        const mover = () =>
          valve.el.querySelector('svg.compSvg > g')?.getAttribute('transform') ?? '';
        const before = mover();

        valve.restore({ ...valve.snapshot(), normallyOpen: true });
        expect(mover()).toBe(before);

        const flow = valve.el.querySelector('.valveCell--flow')?.getAttribute('transform');
        const exhaust = valve.el.querySelector('.valveCell--exhaust')?.getAttribute('transform');
        expect(flow).not.toBe(exhaust);
      });

      it('round-trips the setting through snapshot/restore', () => {
        const original = make();
        original.restore({ ...original.snapshot(), normallyOpen: true });
        const snap = original.snapshot();

        const restored = make();
        restored.restore(snap);
        expect(restored.snapshot()).toEqual(snap);
        expect(restored.conductivityRule(noPressure)).toEqual(OPEN);
      });

      it('reset() releases the valve without forgetting which function it is set to', () => {
        const valve = make();
        valve.restore({ ...valve.snapshot(), normallyOpen: true });
        valve.reset();
        expect(valve.snapshot().normallyOpen).toBe(true);
        expect(valve.conductivityRule(noPressure)).toEqual(OPEN);
      });
    });
  }
});
