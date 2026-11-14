import { describe, expect, it } from 'vitest';
import { createHydValveLS } from './valves';

/** The x offset the valve's boxes are drawn at. */
function slideX(el: HTMLElement): number {
  const t = Array.from(el.querySelectorAll('g'))
    .map((g) => g.getAttribute('transform') ?? '')
    .find((v) => v.startsWith('translate('));
  return Number(/translate\(([-\d.]+)/.exec(t ?? '')?.[1] ?? 0);
}

describe('proportional (LS) valve drawing', () => {
  it('slides the boxes the way ISO 1219 does, and the lever with them', () => {
    const valve = createHydValveLS(document.createElement('div'), 0, 0);
    const lever = valve.el.querySelector<HTMLInputElement>('input.lsLever')!;
    const set = (v: number): void => {
      lever.value = String(v);
      lever.dispatchEvent(new Event('input'));
    };
    set(50); // lever to the right: P→A, the left box comes over the ports - the boxes move right
    expect(slideX(valve.el)).toBeGreaterThan(0);
    set(-50); // to the left: P→B, the right box over the ports - the boxes move left
    expect(slideX(valve.el)).toBeLessThan(0);
  });
});
