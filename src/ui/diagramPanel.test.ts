import { describe, expect, it } from 'vitest';
import { axisTicks } from './diagramPanel';

describe('diagram axes', () => {
  it('give a few round values, and end even for a quantity that barely changes', () => {
    expect(axisTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(axisTicks(150, 150 + 1e-9, 5).length).toBeLessThanOrEqual(50);
    expect(axisTicks(1e6, 1e6 + 1e-7, 5).length).toBeLessThanOrEqual(50);
    expect(axisTicks(3, 3, 5)).toEqual([3]);
  });
});
