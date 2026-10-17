import { describe, expect, it } from 'vitest';
import { createPushButton32 } from './pushButton32';
import type { Component } from '../core/types';

function layer(): HTMLElement {
  return document.createElement('div');
}

const CLOSED = [{ a: '2', b: '3' }];
const OPEN = [{ a: '2', b: '1' }];

function press(valve: Component, pressed: boolean): void {
  valve.restore({ ...valve.snapshot(), active: pressed });
}

function setNormallyOpen(valve: Component, no: boolean): void {
  valve.restore({ ...valve.snapshot(), normallyOpen: no });
}

/** The mover's own translate - which of the two cells is currently sitting under the fixed
 * 1/2/3 ports, and equally the pressed/released position of the button and its spring. */
function moverShift(valve: Component): string {
  const mover = valve.el.querySelector('svg.compSvg > g');
  return mover?.getAttribute('transform') ?? '';
}

describe('createPushButton32 normally-open option', () => {
  it('defaults to normally closed: blocked at rest, passing 1->2 while pressed', () => {
    const valve = createPushButton32(layer(), 0, 0);
    expect(valve.snapshot().normallyOpen).toBe(false);
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual(CLOSED);

    press(valve, true);
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual(OPEN);
  });

  it('normally open inverts both rest and pressed', () => {
    const valve = createPushButton32(layer(), 0, 0);
    setNormallyOpen(valve, true);
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual(OPEN);

    press(valve, true);
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual(CLOSED);
  });

  it('swapping the function does not move the button itself, only the two cells', () => {
    // The whole reason the cells are repositioned rather than the mover being shifted: a
    // normally-open valve at rest must still look (and animate) like an unpressed button.
    const valve = createPushButton32(layer(), 0, 0);
    const restShift = moverShift(valve);

    setNormallyOpen(valve, true);
    expect(moverShift(valve)).toBe(restShift);

    press(valve, true);
    const pressedShift = moverShift(valve);
    expect(pressedShift).not.toBe(restShift);

    // ...and pressing moves it the same way round whichever function is selected.
    setNormallyOpen(valve, false);
    expect(moverShift(valve)).toBe(pressedShift);
  });

  it('the two cells trade places when swapped, and trade back', () => {
    const valve = createPushButton32(layer(), 0, 0);
    const cells = () => ({
      flow: valve.el.querySelector('.valveCell--flow')?.getAttribute('transform'),
      exhaust: valve.el.querySelector('.valveCell--exhaust')?.getAttribute('transform'),
    });
    const unswapped = cells();

    setNormallyOpen(valve, true);
    const swapped = cells();
    expect(swapped).not.toEqual(unswapped);
    // They trade places exactly, rather than drifting somewhere new.
    expect(swapped.flow).toBe(unswapped.exhaust);
    expect(swapped.exhaust).toBe(unswapped.flow);

    setNormallyOpen(valve, false);
    expect(cells()).toEqual(unswapped);
  });

  it('round-trips the setting, and reset() releases the button without changing it', () => {
    const valve = createPushButton32(layer(), 0, 0);
    setNormallyOpen(valve, true);
    press(valve, true);
    const snap = valve.snapshot();

    const restored = createPushButton32(layer(), 10, 10);
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);

    valve.reset();
    expect(valve.snapshot().normallyOpen).toBe(true);
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual(OPEN);
  });
});
