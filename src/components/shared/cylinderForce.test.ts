import { describe, expect, it } from 'vitest';
import { annularAreaMm2, boreAreaMm2, forceFromArea } from './cylinderForce';
import { SOURCE_PRESSURE } from '../../sim/constants';

describe('cylinderForce', () => {
  it('computes the full-bore area from a diameter', () => {
    expect(boreAreaMm2(32)).toBeCloseTo(Math.PI * 16 * 16);
  });

  it('computes the annular (rod-side) area as bore area minus rod area', () => {
    expect(annularAreaMm2(32, 12)).toBeCloseTo(Math.PI * (16 * 16 - 6 * 6));
  });

  it('never returns a negative annular area for a rod as wide as the bore', () => {
    expect(annularAreaMm2(20, 30)).toBe(0);
  });

  it('converts an area at SOURCE_PRESSURE (bar) to force in Newtons', () => {
    // 1 bar = 0.1 N/mm^2, so 100 mm^2 at SOURCE_PRESSURE bar is simple to check by hand.
    expect(forceFromArea(100)).toBeCloseTo(SOURCE_PRESSURE * 0.1 * 100);
  });
});
