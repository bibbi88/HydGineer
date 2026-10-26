import { describe, expect, it } from 'vitest';
import { createHydCylinderSingle } from './actuators';

/** The x of every point on the spring's zigzag. */
function springXs(el: HTMLElement): number[] {
  const d = el.querySelector('path[stroke-linejoin="round"]')?.getAttribute('d') ?? '';
  return [...d.matchAll(/[ML] ([-\d.]+) /g)].map((m) => Number(m[1]));
}

describe('single-acting cylinder return spring', () => {
  it('spans piston to end wall around the rod, and packs tighter - never solid - when compressed', () => {
    const cyl = createHydCylinderSingle(document.createElement('div'), 0, 0);
    const restXs = springXs(cyl.el);
    expect(restXs).toHaveLength(6 * 2 + 2); // six coils with room for them

    cyl.restore({ ...cyl.snapshot(), pos: 1 });
    const squeezed = springXs(cyl.el);
    expect(squeezed.length).toBeLessThan(restXs.length);
    expect(squeezed.at(-1)).toBe(restXs.at(-1)); // still seated on the end wall
    // Zig to zig (the ends are half a step from their neighbours).
    for (let i = 1; i < squeezed.length - 2; i++) {
      expect(squeezed[i + 1]! - squeezed[i]!).toBeGreaterThanOrEqual(3.9);
    }
  });
});
