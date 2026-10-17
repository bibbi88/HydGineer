import { describe, expect, it } from 'vitest';
import { alignJunctionToPort } from './wireSplitting';

describe('alignJunctionToPort', () => {
  const a = { x: 0, y: 100 };
  const b = { x: 300, y: 100 };

  it('pulls a near-miss drop on a horizontal wire straight above a vertical port', () => {
    const port = { pos: { x: 150, y: 200 }, entryOrientation: 'V' as const };
    expect(alignJunctionToPort({ x: 170, y: 100 }, a, b, port)).toEqual({ x: 150, y: 100 });
  });

  it('does the same across a vertical wire for a sideways-facing port', () => {
    const port = { pos: { x: 0, y: 140 }, entryOrientation: 'H' as const };
    const v1 = { x: 200, y: 0 };
    const v2 = { x: 200, y: 300 };
    expect(alignJunctionToPort({ x: 200, y: 120 }, v1, v2, port)).toEqual({ x: 200, y: 140 });
  });

  it('leaves the drop alone when it was meant to be somewhere else', () => {
    const port = { pos: { x: 150, y: 200 }, entryOrientation: 'V' as const };
    expect(alignJunctionToPort({ x: 250, y: 100 }, a, b, port)).toEqual({ x: 250, y: 100 });
  });

  it('leaves the drop alone when the port runs parallel to the wire or lies past its end', () => {
    const sideways = { pos: { x: 150, y: 200 }, entryOrientation: 'H' as const };
    expect(alignJunctionToPort({ x: 160, y: 100 }, a, b, sideways)).toEqual({ x: 160, y: 100 });
    const beyond = { pos: { x: 320, y: 200 }, entryOrientation: 'V' as const };
    expect(alignJunctionToPort({ x: 290, y: 100 }, a, b, beyond)).toEqual({ x: 290, y: 100 });
  });
});
