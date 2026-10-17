import { describe, expect, it } from 'vitest';
import {
  circleAreaCm2,
  orificeKFromDiameter,
  orificeKFromRating,
  solveHydraulics,
  wireFlows,
  type HydElement,
} from './hydraulics';

function solve(ports: string[], links: Array<[string, string]>, elements: HydElement[]) {
  const s = solveHydraulics({ ports, links, elements });
  expect(s.converged).toBe(true);
  return s;
}

describe('unit conversions', () => {
  it('orifice coefficient matches Q = Cd·A·√(2Δp/ρ)', () => {
    // 1 mm orifice, 50 bar: A = 7.854e-7 m², v = √(2·5e6/870) = 107.2 m/s
    const q = orificeKFromDiameter(1) * Math.sqrt(50);
    expect(q).toBeCloseTo(0.62 * 7.854e-7 * 107.21 * 60000, 2);
    expect(orificeKFromRating(40, 4)).toBe(20);
    expect(circleAreaCm2(50)).toBeCloseTo(19.635, 3);
  });
});

describe('solveHydraulics', () => {
  it('relief valve limits pump pressure to its setting plus override', () => {
    const s = solve(
      ['pump:P', 'rv:P', 'rv:T', 'tank:T'],
      [
        ['pump:P', 'rv:P'],
        ['rv:T', 'tank:T'],
      ],
      [
        { kind: 'pump', out: 'pump:P', q: 10, leak: 0 },
        { kind: 'relief', a: 'rv:P', b: 'rv:T', set: 100, gain: 20 },
        { kind: 'tank', a: 'tank:T' },
      ],
    );
    expect(s.pressure.get('pump:P')).toBeCloseTo(100.5, 2);
    expect(s.portFlow.get('pump:P')).toBeCloseTo(10, 4);
    expect(s.portFlow.get('rv:P')).toBeCloseTo(-10, 4);
    expect(s.portFlow.get('tank:T')).toBeCloseTo(-10, 4);
  });

  it('orifice pressure drop follows Δp = (Q/K)²', () => {
    const k = orificeKFromDiameter(2);
    const s = solve(
      ['pump:P', 'o:A', 'o:B', 'tank:T'],
      [
        ['pump:P', 'o:A'],
        ['o:B', 'tank:T'],
      ],
      [
        { kind: 'pump', out: 'pump:P', q: 10, leak: 0 },
        { kind: 'orifice', a: 'o:A', b: 'o:B', k },
        { kind: 'tank', a: 'tank:T' },
      ],
    );
    expect(s.pressure.get('pump:P')).toBeCloseTo((10 / k) ** 2, 2);
  });

  it('extending cylinder: speed = Q/A, pressure = load/A plus back pressure', () => {
    const areaA = circleAreaCm2(50);
    const areaB = areaA - circleAreaCm2(30);
    const kPath = orificeKFromRating(30, 5);
    const s = solve(
      ['pump:P', 'cyl:A', 'cyl:B', 'tank:T'],
      [],
      [
        { kind: 'pump', out: 'pump:P', q: 10, leak: 0 },
        { kind: 'orifice', a: 'pump:P', b: 'cyl:A', k: kPath },
        { kind: 'orifice', a: 'cyl:B', b: 'tank:T', k: kPath },
        { kind: 'relief', a: 'pump:P', b: 'tank:T', set: 150, gain: 20 },
        {
          kind: 'piston',
          a: 'cyl:A',
          b: 'cyl:B',
          areaA,
          areaB,
          load: 10000,
          friction: 0,
          atMin: true,
          atMax: false,
        },
        { kind: 'tank', a: 'tank:T' },
      ],
    );
    const v = s.elementValue[4]!;
    expect(v).toBeCloseTo(10 / (areaA * 6), 3);
    const qB = areaB * v * 6;
    const pB = (qB / kPath) ** 2;
    const pA = (10000 + pB * areaB * 10) / (areaA * 10);
    expect(s.pressure.get('cyl:B')).toBeCloseTo(pB, 1);
    expect(s.pressure.get('cyl:A')).toBeCloseTo(pA, 1);
    expect(s.pressure.get('pump:P')).toBeCloseTo(pA + (10 / kPath) ** 2, 1);
    // Return flow out of B is smaller than supply by the area ratio.
    expect(s.elementValue[2]).toBeCloseTo(qB, 3);
  });

  it('cylinder at its end stop: everything goes over the relief valve', () => {
    const areaA = circleAreaCm2(50);
    const s = solve(
      ['pump:P', 'cyl:A', 'tank:T'],
      [['pump:P', 'cyl:A']],
      [
        { kind: 'pump', out: 'pump:P', q: 10, leak: 0 },
        { kind: 'relief', a: 'pump:P', b: 'tank:T', set: 120, gain: 20 },
        {
          kind: 'piston',
          a: 'cyl:A',
          areaA,
          areaB: 0,
          load: 0,
          friction: 0,
          atMin: false,
          atMax: true,
        },
        { kind: 'tank', a: 'tank:T' },
      ],
    );
    expect(s.elementValue[2]).toBe(0);
    expect(s.elementLocked[2]).toBe(true);
    expect(s.pressure.get('pump:P')).toBeCloseTo(120.5, 2);
  });

  it('load holds a blocked cylinder at p = F/A', () => {
    const areaA = circleAreaCm2(40);
    const s = solve(
      ['cyl:A'],
      [],
      [
        {
          kind: 'piston',
          a: 'cyl:A',
          areaA,
          areaB: 0,
          load: 5000,
          friction: 0,
          atMin: false,
          atMax: false,
        },
      ],
    );
    expect(s.pressure.get('cyl:A')).toBeCloseTo(5000 / (areaA * 10), 2);
    expect(Math.abs(s.elementValue[0]!)).toBeLessThan(1e-6);
  });

  it('check valve blocks reverse flow and cracks forward', () => {
    const s = solve(
      ['pump:P', 'tank:T'],
      [],
      [
        { kind: 'pump', out: 'pump:P', q: 5, leak: 0 },
        { kind: 'check', a: 'tank:T', b: 'pump:P', crack: 0.5, k: 10 },
        { kind: 'check', a: 'pump:P', b: 'tank:T', crack: 5, k: 10 },
        { kind: 'tank', a: 'tank:T' },
      ],
    );
    // 5 L/min through k = 10: Δp ≈ 0.25 above the 5 bar cracking pressure.
    expect(s.pressure.get('pump:P')).toBeGreaterThan(5.2);
    expect(s.pressure.get('pump:P')).toBeLessThan(5.35);
    expect(s.elementValue[1]).toBeCloseTo(0, 3);
  });

  it('pressure-compensated flow control passes its set flow, excess over the relief', () => {
    const s = solve(
      ['pump:P', 'tank:T'],
      [],
      [
        { kind: 'pump', out: 'pump:P', q: 20, leak: 0 },
        { kind: 'flowControl', a: 'pump:P', b: 'tank:T', q: 6, dpMin: 3 },
        { kind: 'relief', a: 'pump:P', b: 'tank:T', set: 80, gain: 20 },
        { kind: 'tank', a: 'tank:T' },
      ],
    );
    expect(s.elementValue[1]).toBeCloseTo(6, 3);
    expect(s.elementValue[2]).toBeCloseTo(14, 3);
  });

  it('pressure reducing valve regulates its outlet', () => {
    const s = solve(
      ['pump:P', 'out', 'tank:T'],
      [],
      [
        { kind: 'pump', out: 'pump:P', q: 10, leak: 0 },
        { kind: 'relief', a: 'pump:P', b: 'tank:T', set: 150, gain: 20 },
        { kind: 'reducing', a: 'pump:P', b: 'out', set: 40, k: 20, band: 2 },
        { kind: 'orifice', a: 'out', b: 'tank:T', k: 0.5 },
        { kind: 'tank', a: 'tank:T' },
      ],
    );
    const pOut = s.pressure.get('out')!;
    expect(pOut).toBeGreaterThan(38);
    expect(pOut).toBeLessThan(40);
  });

  it('hydraulic motor: n = Q/D, Δp = T·20π/D', () => {
    const s = solve(
      ['pump:P', 'tank:T'],
      [],
      [
        { kind: 'pump', out: 'pump:P', q: 12, leak: 0 },
        { kind: 'motor', a: 'pump:P', b: 'tank:T', disp: 20, torque: 30 },
        { kind: 'relief', a: 'pump:P', b: 'tank:T', set: 200, gain: 20 },
        { kind: 'tank', a: 'tank:T' },
      ],
    );
    expect(s.elementValue[1]! * 60).toBeCloseTo((12 / 20) * 1000, 0);
    expect(s.pressure.get('pump:P')).toBeCloseTo((30 * 20 * Math.PI) / 20, 0);
  });
});

describe('load holding and overrunning loads', () => {
  const areaA = circleAreaCm2(40);
  const holding = (pilot: number) =>
    solve(
      ['cyl:A', 'tank:T', 'pilot'],
      [],
      [
        { kind: 'pilotCheck', a: 'tank:T', b: 'cyl:A', x: 'pilot', crack: 0.5, ratio: 4, k: 20 },
        {
          kind: 'piston',
          a: 'cyl:A',
          areaA,
          areaB: 0,
          load: 5000,
          friction: 0,
          atMin: false,
          atMax: false,
        },
        { kind: 'tank', a: 'tank:T' },
        { kind: 'pump', out: 'pilot', q: 1, leak: 0 },
        { kind: 'relief', a: 'pilot', b: 'tank:T', set: pilot, gain: 10 },
      ],
    );

  it('a pilot-operated check valve holds the load until piloted open', () => {
    const shut = holding(5);
    expect(shut.pressure.get('cyl:A')).toBeCloseTo(5000 / (areaA * 10), 1);
    expect(Math.abs(shut.elementValue[1]!)).toBeLessThan(1e-6);
    const open = holding(40);
    // Now the load drives the oil out to tank: the piston retracts.
    expect(open.elementValue[1]!).toBeLessThan(-0.01);
  });

  it('seal friction stalls a cylinder until the pressure can overcome it', () => {
    const s = solve(
      ['cyl:A', 'tank:T'],
      [],
      [
        { kind: 'pump', out: 'cyl:A', q: 5, leak: 0 },
        { kind: 'relief', a: 'cyl:A', b: 'tank:T', set: 20, gain: 10 },
        {
          kind: 'piston',
          a: 'cyl:A',
          areaA,
          areaB: 0,
          load: 0,
          friction: 4000, // needs 31.8 bar, relief opens at 20
          atMin: true,
          atMax: false,
        },
        { kind: 'tank', a: 'tank:T' },
      ],
    );
    expect(Math.abs(s.elementValue[2]!)).toBeLessThan(1e-6);
    expect(s.pressure.get('cyl:A')).toBeCloseTo(20.5, 1);
  });
});

describe('cavitation', () => {
  it('an overrunning load cannot suck a line below vapour pressure', () => {
    // Load pulls the rod out (negative load); only 2 L/min is fed to A, the B side is free to
    // tank - the piston runs away faster than A is filled, and A cavitates.
    const areaA = circleAreaCm2(50);
    const areaB = areaA - circleAreaCm2(30);
    const s = solve(
      ['cyl:A', 'cyl:B', 'tank:T'],
      [],
      [
        { kind: 'pump', out: 'cyl:A', q: 2, leak: 0 },
        { kind: 'orifice', a: 'cyl:B', b: 'tank:T', k: 10 },
        {
          kind: 'piston',
          a: 'cyl:A',
          b: 'cyl:B',
          areaA,
          areaB,
          load: -10000,
          friction: 0,
          atMin: false,
          atMax: false,
        },
        { kind: 'tank', a: 'tank:T' },
      ],
    );
    const pA = s.pressure.get('cyl:A')!;
    expect(pA).toBeGreaterThan(-1.1);
    expect(pA).toBeLessThan(-0.9);
    // The load is held back only by the B-side outflow: pB·A_B ≈ 10000 + pA·A_A.
    const pB = s.pressure.get('cyl:B')!;
    expect((pB * areaB - pA * areaA) * 10).toBeCloseTo(10000, -1);
  });
});

describe('wireFlows', () => {
  it('splits flow along a branched net', () => {
    // pump -> J, J -> a, J -> b (a takes 3, b takes 7)
    const flows = wireFlows(
      [
        { id: 1, from: 'pump', to: 'J' },
        { id: 2, from: 'J', to: 'a' },
        { id: 3, from: 'b', to: 'J' },
      ],
      new Map([
        ['pump', 10],
        ['a', -3],
        ['b', -7],
        ['J', 0],
      ]),
    );
    expect(flows.get(1)).toBeCloseTo(10);
    expect(flows.get(2)).toBeCloseTo(3);
    expect(flows.get(3)).toBeCloseTo(-7);
  });
});
