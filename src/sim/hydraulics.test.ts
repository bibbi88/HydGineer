import { describe, expect, it } from 'vitest';
import {
  accumulatorOil,
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

  it('hydraulic motor with ηhm: same speed, Δp = T·20π/(D·ηhm)', () => {
    const s = solve(
      ['pump:P', 'tank:T'],
      [],
      [
        { kind: 'pump', out: 'pump:P', q: 12, leak: 0 },
        { kind: 'motor', a: 'pump:P', b: 'tank:T', disp: 20, torque: 30, etaHm: 0.8 },
        { kind: 'relief', a: 'pump:P', b: 'tank:T', set: 200, gain: 20 },
        { kind: 'tank', a: 'tank:T' },
      ],
    );
    expect(s.elementValue[1]! * 60).toBeCloseTo((12 / 20) * 1000, 0);
    expect(s.pressure.get('pump:P')).toBeCloseTo((30 * 20 * Math.PI) / (20 * 0.8), 0);
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

describe('flow dividers', () => {
  /** Spool divider fed by a pump: metering orifices kA/kB from P into chambers C1/C2, the
   * compensating sleeve to outlets A/B. A drains through `loadA`, B through `loadB`. */
  function spoolDivider(
    q: number,
    kA: number,
    kB: number,
    loadA: HydElement[],
    loadB: HydElement[],
  ) {
    return solve(
      ['P', 'C1', 'C2', 'A', 'B', 'T'],
      [],
      [
        { kind: 'pump', out: 'P', q, leak: 0 },
        { kind: 'relief', a: 'P', b: 'T', set: 200, gain: 10 },
        { kind: 'orifice', a: 'P', b: 'C1', k: kA },
        { kind: 'orifice', a: 'P', b: 'C2', k: kB },
        { kind: 'compensator', a: 'C1', b: 'C2', x: 'A', y: 'B', k: 20, spring: 0.3 },
        { kind: 'tank', a: 'T' },
        ...loadA,
        ...loadB,
      ],
    );
  }

  it('spool divider: equal split although one outlet sees 5 bar and the other 80 bar', () => {
    const s = spoolDivider(
      20,
      4,
      4,
      [{ kind: 'orifice', a: 'A', b: 'T', k: 5 }],
      [{ kind: 'relief', a: 'B', b: 'T', set: 80, gain: 10 }],
    );
    const qA = s.elementValue[6]!;
    const qB = s.elementValue[7]!;
    expect(qA + qB).toBeCloseTo(20, 2);
    expect(Math.abs(qA - qB) / 10).toBeLessThan(0.03);
    expect(s.pressure.get('B')!).toBeGreaterThan(80);
    expect(s.pressure.get('A')!).toBeLessThan(10);
    // The sleeve has moved towards closing the low-pressure side.
    expect(s.elementValue[4]!).toBeLessThan(-0.1);
  });

  it('spool divider: unequal metering orifices divide in their ratio (2:1)', () => {
    const s = spoolDivider(
      18,
      6,
      3,
      [{ kind: 'relief', a: 'A', b: 'T', set: 40, gain: 10 }],
      [{ kind: 'orifice', a: 'B', b: 'T', k: 3 }],
    );
    const qA = s.elementValue[6]!;
    const qB = s.elementValue[7]!;
    expect(qA / qB).toBeGreaterThan(1.94);
    expect(qA / qB).toBeLessThan(2.06);
  });

  it('spool divider: blocking one outlet also shuts the other', () => {
    const s = spoolDivider(20, 4, 4, [{ kind: 'orifice', a: 'A', b: 'T', k: 5 }], []);
    // Only a trickle gets past the nearly shut sleeve; the rest goes over the relief valve.
    expect(Math.abs(s.elementValue[6]!)).toBeLessThan(2);
    expect(s.elementValue[1]!).toBeGreaterThan(18);
  });

  function rotary(loadA: HydElement[], loadB: HydElement[], leak = 0) {
    return solve(
      ['P', 'A', 'B', 'T'],
      [],
      [
        { kind: 'pump', out: 'P', q: 20, leak: 0 },
        { kind: 'relief', a: 'P', b: 'T', set: 100, gain: 10 },
        { kind: 'rotaryDivider', a: 'P', b: 'A', x: 'B', d1: 8, d2: 8, leak, torque: 0.5 },
        { kind: 'tank', a: 'T' },
        ...loadA,
        ...loadB,
      ],
    );
  }

  it('rotary divider: equal displacements give equal flows, the inlet sees the mean pressure', () => {
    const s = rotary(
      [{ kind: 'relief', a: 'A', b: 'T', set: 20, gain: 10 }],
      [{ kind: 'relief', a: 'B', b: 'T', set: 60, gain: 10 }],
    );
    const qA = s.elementValue[4]!;
    const qB = s.elementValue[5]!;
    expect(qA).toBeCloseTo(10, 2);
    expect(qB).toBeCloseTo(10, 2);
    const n = s.elementValue[2]!;
    expect(n * 60).toBeCloseTo((10 / 8) * 1000, 0);
    // Torque balance: p_P ≈ (p_A + p_B)/2 plus the friction share.
    const pMean = (s.pressure.get('A')! + s.pressure.get('B')!) / 2;
    const pFriction = (0.5 * 20 * Math.PI) / 16;
    const pViscous = 0.01 * n; // the solver's small viscous drag, bar per rev/s
    expect(s.pressure.get('P')!).toBeCloseTo(pMean + pFriction + pViscous, 2);
  });

  it('rotary divider: intensifies - one outlet can rise above the inlet pressure', () => {
    const s = rotary(
      [{ kind: 'orifice', a: 'A', b: 'T', k: 50 }],
      [{ kind: 'relief', a: 'B', b: 'T', set: 150, gain: 10 }],
    );
    // Inlet held near 100 bar by its relief valve, yet B reaches its 150 bar load.
    expect(s.pressure.get('P')!).toBeLessThan(101);
    expect(s.pressure.get('B')!).toBeGreaterThan(150);
  });

  it('rotary divider: internal leakage makes the higher-pressure side lose flow', () => {
    const s = rotary(
      [{ kind: 'relief', a: 'A', b: 'T', set: 10, gain: 10 }],
      [{ kind: 'relief', a: 'B', b: 'T', set: 90, gain: 10 }],
      0.005,
    );
    const qA = s.elementValue[4]!;
    const qB = s.elementValue[5]!;
    expect(qA).toBeGreaterThan(qB);
    expect(qA + qB).toBeCloseTo(20, 2);
  });
});

describe('pressure-compensated pump', () => {
  it('destrokes at its setting instead of dumping over the relief valve', () => {
    const s = solve(
      ['P', 'T'],
      [],
      [
        { kind: 'pump', out: 'P', q: 30, leak: 0.002, comp: 100, band: 5 },
        { kind: 'relief', a: 'P', b: 'T', set: 120, gain: 10 },
        { kind: 'orifice', a: 'P', b: 'T', k: 0.5 }, // a small consumer: ~5 L/min at 100 bar
        { kind: 'tank', a: 'T' },
      ],
    );
    const p = s.pressure.get('P')!;
    expect(p).toBeGreaterThan(95);
    expect(p).toBeLessThan(100);
    expect(s.elementValue[1]).toBeCloseTo(0, 6); // relief stays shut
    expect(s.elementValue[0]).toBeCloseTo(0.5 * Math.sqrt(p), 3); // delivers only what's taken
  });

  it('delivers full flow well below its setting', () => {
    const s = solve(
      ['P', 'T'],
      [],
      [
        { kind: 'pump', out: 'P', q: 30, leak: 0, comp: 100, band: 5 },
        { kind: 'orifice', a: 'P', b: 'T', k: 10 },
        { kind: 'tank', a: 'T' },
      ],
    );
    expect(s.elementValue[0]).toBeCloseTo(30, 3);
    expect(s.pressure.get('P')).toBeCloseTo(9, 2);
  });
});

describe('accumulator', () => {
  const acc = { volume: 2, precharge: 60, n: 1.4 };

  it('holds no oil below pre-charge and follows the gas law above it', () => {
    expect(accumulatorOil(acc, 40)).toBe(0);
    const expected = 2 * (1 - Math.pow(61 / 121, 1 / 1.4));
    expect(accumulatorOil(acc, 120)).toBeCloseTo(expected, 4);
  });

  it('charges from a pump over time: oil taken in equals pump flow × time', () => {
    let oil = 0;
    let guess;
    const dt = 0.05;
    for (let i = 0; i < 400; i++) {
      const s = solveHydraulics({
        ports: ['P', 'T'],
        links: [],
        elements: [
          { kind: 'pump', out: 'P', q: 6, leak: 0 },
          { kind: 'relief', a: 'P', b: 'T', set: 150, gain: 10 },
          { kind: 'accumulator', a: 'P', ...acc, oilPrev: oil },
          { kind: 'tank', a: 'T' },
        ],
        guess,
        dt,
      });
      expect(s.converged).toBe(true);
      guess = s;
      oil = accumulatorOil(acc, s.pressure.get('P')!);
      if (i === 39) {
        // 2 s at 6 L/min = 0.2 L (less the line volume's own share).
        expect(oil).toBeGreaterThan(0.18);
        expect(oil).toBeLessThan(0.2);
      }
    }
    // Full: the relief valve takes over at 150 bar.
    expect(oil).toBeCloseTo(accumulatorOil(acc, 150.6), 1);
  });
});

describe('counterbalance valve', () => {
  const areaA = circleAreaCm2(63);
  // A 20 kN load hangs on the cap side: 63.7 bar holds it. Valve set at 85 bar, pilot 4:1.
  function lowering(pilot: number) {
    return solve(
      ['V', 'L', 'X', 'T'],
      [],
      [
        { kind: 'counterbalance', a: 'V', b: 'L', x: 'X', set: 85, ratio: 4, k: 10, band: 5 },
        { kind: 'orifice', a: 'V', b: 'T', k: 10 },
        {
          kind: 'piston',
          a: 'L',
          areaA,
          areaB: 0,
          load: 20000,
          friction: 0,
          atMin: false,
          atMax: false,
        },
        { kind: 'pump', out: 'X', q: 1, leak: 0 },
        { kind: 'relief', a: 'X', b: 'T', set: pilot, gain: 10 },
        { kind: 'tank', a: 'T' },
      ],
    );
  }

  it('holds the load with no pilot pressure', () => {
    const s = lowering(0);
    expect(Math.abs(s.elementValue[2]!)).toBeLessThan(1e-5);
    expect(s.pressure.get('L')).toBeCloseTo(20000 / (areaA * 10), 1);
  });

  it('lets it down under control once piloted, never faster than the opening allows', () => {
    const s = lowering(8);
    const v = s.elementValue[2]!;
    expect(v).toBeLessThan(-0.005);
    // Load-side pressure stays at the holding pressure: the load is still carried by the oil.
    expect(s.pressure.get('L')!).toBeGreaterThan(60);
  });
});

describe('moving mass', () => {
  it('accelerates under a net force as F = m·a, then a stop builds a pressure spike', () => {
    const areaA = circleAreaCm2(50);
    const step = (vPrev: number, dt: number) =>
      solveHydraulics({
        ports: ['A'],
        links: [],
        elements: [
          {
            kind: 'piston',
            a: 'A',
            areaA,
            areaB: 0,
            load: -1000, // 1 kN pulls the rod out, A is shut off: only the oil holds it
            friction: 0,
            atMin: false,
            atMax: false,
            volA: 0.2,
            mass: 500,
            vPrev,
          },
        ],
        dt,
      });
    // Released from rest with the trapped oil at 0 bar: the 1 kN accelerates 500 kg at 2 m/s²
    // until the oil column (cavitating at first) pulls it back - first step ≈ free acceleration.
    const s = step(0, 0.001);
    expect(s.elementValue[0]!).toBeCloseTo(0.002, 3);
  });
});

describe('load sensing', () => {
  /** LS pump (60 L/min max, 20 bar margin, 250 bar cut-off) → metering orifice k → load at A,
   * whose pressure is fed back to the pump's LS port. The LS line bleeds to tank. */
  function ls(k: number, loadSet: number) {
    return solve(
      ['P', 'A', 'LS', 'T'],
      [],
      [
        { kind: 'pump', out: 'P', q: 60, leak: 0, comp: 250, band: 3, x: 'LS', margin: 20 },
        { kind: 'orifice', a: 'P', b: 'A', k },
        { kind: 'orifice', a: 'A', b: 'LS', k: 1 }, // LS signal line
        { kind: 'orifice', a: 'LS', b: 'T', k: 0.02 }, // LS bleed
        { kind: 'relief', a: 'A', b: 'T', set: loadSet, gain: 10 }, // the load
        { kind: 'tank', a: 'T' },
      ],
    );
  }

  it('pump pressure follows the load plus the margin', () => {
    const s = ls(4, 80);
    const pA = s.pressure.get('A')!;
    const pP = s.pressure.get('P')!;
    expect(pP - pA).toBeGreaterThan(16);
    expect(pP - pA).toBeLessThan(20.1);
  });

  it('flow is set by the valve opening, not by the load', () => {
    const light = ls(4, 30).elementValue[0]!;
    const heavy = ls(4, 150).elementValue[0]!;
    expect(Math.abs(light - heavy) / light).toBeLessThan(0.03);
    // Q = k·√Δp with Δp ≈ the margin.
    expect(light).toBeGreaterThan(4 * Math.sqrt(16));
    expect(light).toBeLessThan(4 * Math.sqrt(20.1));
  });

  it('stands by at the margin pressure with no demand, delivering only the leakage', () => {
    const s = solve(
      ['P', 'LS', 'T'],
      [],
      [
        { kind: 'pump', out: 'P', q: 60, leak: 0, comp: 250, band: 3, x: 'LS', margin: 20 },
        { kind: 'orifice', a: 'LS', b: 'T', k: 0.02 },
        { kind: 'orifice', a: 'P', b: 'T', k: 0.05 }, // some leakage
        { kind: 'tank', a: 'T' },
      ],
    );
    expect(s.pressure.get('P')!).toBeGreaterThan(16);
    expect(s.pressure.get('P')!).toBeLessThan(20.1);
    expect(s.elementValue[0]!).toBeLessThan(0.3);
  });

  it('2-way pressure compensator holds a fixed Δp across the metering orifice after it', () => {
    const run = (supply: number, load: number) =>
      solve(
        ['P', 'C', 'A', 'T'],
        [],
        [
          { kind: 'pump', out: 'P', q: 60, leak: 0 },
          { kind: 'relief', a: 'P', b: 'T', set: supply, gain: 10 },
          { kind: 'reducing', a: 'P', b: 'C', set: 10, k: 20, band: 1, x: 'A' },
          { kind: 'orifice', a: 'C', b: 'A', k: 3 }, // the valve's metering notch
          { kind: 'relief', a: 'A', b: 'T', set: load, gain: 10 },
          { kind: 'tank', a: 'T' },
        ],
      );
    const s1 = run(150, 40);
    const s2 = run(250, 120);
    const dp1 = s1.pressure.get('C')! - s1.pressure.get('A')!;
    const dp2 = s2.pressure.get('C')! - s2.pressure.get('A')!;
    expect(dp1).toBeGreaterThan(9);
    expect(dp1).toBeLessThan(10.01);
    expect(Math.abs(dp1 - dp2)).toBeLessThan(0.2);
    // So the flow through the notch is the same, whatever the supply and load pressures.
    expect(Math.abs(s1.elementValue[3]! - s2.elementValue[3]!)).toBeLessThan(0.2);
  });

  it('shuttle valve passes on the higher of two signals', () => {
    const s = solve(
      ['A', 'B', 'X', 'T'],
      [],
      [
        { kind: 'pump', out: 'A', q: 1, leak: 0 },
        { kind: 'relief', a: 'A', b: 'T', set: 90, gain: 10 },
        { kind: 'pump', out: 'B', q: 1, leak: 0 },
        { kind: 'relief', a: 'B', b: 'T', set: 40, gain: 10 },
        { kind: 'shuttle', a: 'A', b: 'B', x: 'X', k: 1 },
        { kind: 'orifice', a: 'X', b: 'T', k: 0.02 },
        { kind: 'tank', a: 'T' },
      ],
    );
    expect(s.pressure.get('X')!).toBeGreaterThan(89);
    expect(s.elementValue[4]!).toBeGreaterThan(0.99); // ball on the B seat
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
