/**
 * Steady-state hydraulic network solver.
 *
 * The circuit is reduced to nodes (every set of ports joined by wires/junctions is one node, at
 * one pressure) and elements between them (valve paths, pumps, cylinders...). Each frame the
 * solver finds the node pressures, and every actuator's velocity, that satisfy
 *
 *   - flow continuity at every node (what flows in flows out - oil is treated as incompressible),
 *   - every element's own pressure/flow characteristic (orifice law, check valve, relief valve...),
 *   - force balance on every cylinder piston and torque balance on every motor shaft,
 *
 * with a damped Newton-Raphson iteration. Actuator inertia is neglected (quasi-static), which is
 * the usual assumption for circuit calculations: a piston moves at the speed the supplied flow
 * allows, and the pressure in front of it is whatever the load (plus back pressure and friction)
 * requires.
 *
 * Units throughout: pressure in bar (gauge, tank = 0), flow in L/min, area in cm², force in N,
 * velocity in m/s, displacement in cm³/rev, speed in rev/s, torque in Nm. Useful identities:
 *   F [N]     = p [bar] · A [cm²] · 10
 *   Q [L/min] = A [cm²] · v [m/s] · 6
 *   Q [L/min] = D [cm³/rev] · n [rev/s] · 0.06
 *   T [Nm]    = Δp [bar] · D [cm³/rev] / (20π)
 *
 * Pure: no DOM, no app state - see sim/engine.ts for how components feed it.
 */

/** Oil density, kg/m³ (typical mineral hydraulic oil, ISO VG 46). */
export const OIL_DENSITY = 870;
/** Discharge coefficient of a sharp-edged orifice. */
export const ORIFICE_CD = 0.62;

/** Orifice coefficient K (L/min per √bar) of a round sharp-edged orifice of diameter `dMm`, so
 * that Q = K·√Δp - i.e. the orifice equation Q = Cd·A·√(2Δp/ρ) converted to bar and L/min. */
export function orificeKFromDiameter(dMm: number): number {
  if (!(dMm > 0)) return 0;
  const areaM2 = (Math.PI * dMm * dMm * 1e-6) / 4;
  return ORIFICE_CD * areaM2 * Math.sqrt((2 * 1e5) / OIL_DENSITY) * 60000;
}

/** Orifice coefficient from a catalogue-style rating: `qNom` L/min at a pressure drop of `dpNom`
 * bar (how directional valve manufacturers specify each flow path). */
export function orificeKFromRating(qNom: number, dpNom: number): number {
  if (!(qNom > 0) || !(dpNom > 0)) return 0;
  return qNom / Math.sqrt(dpNom);
}

/** Bore area in cm² of a cylinder of diameter `dMm`. */
export function circleAreaCm2(dMm: number): number {
  return (Math.PI * dMm * dMm) / 400;
}

export type HydElement =
  /** Two-way orifice/flow path: Q(a→b) = k·sign(Δp)·√|Δp|. */
  | { kind: 'orifice'; a: string; b: string; k: number }
  /** Check valve: flows a→b only, once Δp exceeds the cracking pressure, then like an orifice. */
  | { kind: 'check'; a: string; b: string; crack: number; k: number }
  /** Direct-operated relief valve a→b: closed below `set`, then Q = gain·(Δp − set). */
  | { kind: 'relief'; a: string; b: string; set: number; gain: number }
  /** Pilot-operated check valve: free flow a→b like a check valve; opened for flow in both
   * directions while the pilot pressure at `x`, times the pilot ratio, exceeds the load-side
   * pressure (p_x − p_a)·ratio > p_b − p_a. The pilot port itself passes no flow. */
  | { kind: 'pilotCheck'; a: string; b: string; x: string; crack: number; ratio: number; k: number }
  /** Pressure-reducing valve a(in)→b(out): an orifice whose opening closes as p_b approaches
   * `set`, across a regulating band of `band` bar. */
  | {
      kind: 'reducing';
      a: string;
      b: string;
      set: number;
      k: number;
      band: number;
      /** If given, the setting is relative to this pilot port's pressure - p_b is held at
       * p_x + set. That's a 2-way pressure compensator: it holds a fixed Δp above a load
       * (LS) pressure. No flow passes through `x`. */
      x?: string;
    }
  /** Pressure-compensated 2-way flow control a→b: holds `q` once Δp exceeds about `dpMin`. */
  | { kind: 'flowControl'; a: string; b: string; q: number; dpMin: number }
  /** Pump drawing from tank: delivers q·f − leak·p_out into `out`. f = 1 for a fixed pump; with
   * a pressure compensator (`comp`, bar) the displacement is swivelled back over the last
   * `band` bar below the setting, so the pump delivers only what the circuit takes there. */
  | {
      kind: 'pump';
      out: string;
      q: number;
      leak: number;
      comp?: number;
      band?: number;
      /** Load-sensing control: the pump holds its outlet at p_x + `margin` - the highest load
       * pressure fed back on its LS port `x`, plus the margin (standby pressure) - swivelling
       * back once the outlet rises above that. No flow passes through `x` itself. */
      x?: string;
      margin?: number;
    }
  /**
   * Shuttle valve: outlet `x` is connected to whichever of inlets `a`, `b` has the higher
   * pressure (the ball seals the lower one) - selects the highest of two load-sensing signals.
   */
  | { kind: 'shuttle'; a: string; b: string; x: string; k: number }
  /**
   * Gas-loaded (bladder/piston) accumulator on node `a`. Below the pre-charge pressure it holds
   * no oil; above it the gas is compressed polytropically, (p + 1)·V_gas^n = (p0 + 1)·V0^n in
   * absolute bar, so the oil it holds is V0·(1 − ((p0 + 1)/(p + 1))^(1/n)). `oilPrev` is what it
   * held a time step ago; the flow into it is the change over the step (needs HydInput.dt -
   * without it the accumulator is treated as shut off).
   */
  | {
      kind: 'accumulator';
      a: string;
      volume: number;
      precharge: number;
      n: number;
      oilPrev: number;
    }
  /**
   * Counterbalance valve between the directional valve (`a`) and an overrunning load (`b`), pilot
   * `x`. Free flow a → b through its check. Flow b → a only once
   *   p_b + ratio·p_x ≥ set
   * - the load pressure alone (set above the load-holding pressure) or the pilot from the other
   * side of the actuator opens it, modulating over `band` bar, so the load can only be driven
   * down, never run away.
   */
  | {
      kind: 'counterbalance';
      a: string;
      b: string;
      x: string;
      set: number;
      ratio: number;
      k: number;
      band: number;
    }
  /**
   * Sequence valve, inlet `a` → outlet `b`: shut until the inlet pressure reaches `set`, then
   * opening over `band` bar - so it holds the inlet at about `set` while passing on whatever
   * the inlet line delivers beyond that, and the next actuator only moves once the first has
   * built up that pressure. Piloted from its own inlet, spring chamber drained to tank, so the
   * outlet pressure doesn't shift the setting. With `check`, a bypass check lets return oil
   * flow freely b → a.
   */
  | { kind: 'sequence'; a: string; b: string; set: number; k: number; band: number; check: boolean }
  /** Closed-loop (over-centre) pump: draws `q` from `b` and delivers it into `a`; a negative
   * `q` (swash plate past centre) reverses the flow. No tank connection - any leakage is
   * modelled separately by the component. */
  | { kind: 'loopPump'; a: string; b: string; q: number }
  /** Tank (reservoir) connection: holds this node at 0 bar. */
  | { kind: 'tank'; a: string }
  /** Linear actuator. Extending (v > 0) draws areaA·v from `a` and pushes areaB·v into `b`.
   * `load` (N) opposes extension; `friction` (N) opposes motion in either direction. */
  | {
      kind: 'piston';
      a?: string;
      b?: string;
      areaA: number;
      areaB: number;
      load: number;
      friction: number;
      atMin: boolean;
      atMax: boolean;
      /** Oil volume (L) of each chamber, for compressibility (see HydInput.dt). */
      volA?: number;
      volB?: number;
      /** Moving mass (kg) and its velocity a time step ago (m/s): with both and HydInput.dt the
       * piston accelerates, m·dv/dt = net force, instead of being in force balance at once. */
      mass?: number;
      vPrev?: number;
    }
  /** Rotary actuator: forward rotation (n > 0) passes D·n from `a` to `b`. `torque` (Nm)
   * opposes rotation in either direction. `etaHm` (0…1, default 1) is the hydromechanical
   * efficiency: the shaft gives T = Δp·D·ηhm / 20π, so a load needs Δp = 20π·T / (D·ηhm). */
  | { kind: 'motor'; a: string; b: string; disp: number; torque: number; etaHm?: number }
  /**
   * Pressure-compensating sleeve (spool) of a spool-type flow divider. Chambers `a` and `b` sit
   * downstream of the divider's two fixed metering orifices; the sleeve throttles chamber a → outlet
   * `x` and chamber b → outlet `y` in opposite directions, and is pushed by the chamber pressures
   * against a soft centring spring (`spring`, bar per unit travel). It settles where the two
   * chamber pressures are equal - so both metering orifices see the same Δp and the flows divide
   * in the ratio of their sizes, whatever the outlet pressures. At travel s = ±0.5 one outlet is
   * fully open and the other shut; a stop just beyond that limits the travel. Each throttle is an orifice of coefficient k when
   * fully open.
   */
  | { kind: 'compensator'; a: string; b: string; x: string; y: string; k: number; spring: number }
  /**
   * Rotary (gear) flow divider: two gear sections of displacement d1 (inlet `a` → outlet `b`) and
   * d2 (`a` → `x`) on one shaft, so they pass flows in the ratio d1:d2 at a common speed n.
   * Torque balance: (p_a − p_b)·d1 + (p_a − p_x)·d2 = friction - the section with the lower
   * outlet pressure drives the other as a pump, which is why the other outlet can rise above
   * inlet pressure (pressure intensification). `leak` (L/min per bar) is the internal leakage
   * of each section past its gears, `torque` (Nm) the breakaway friction.
   */
  | {
      kind: 'rotaryDivider';
      a: string;
      b: string;
      x: string;
      d1: number;
      d2: number;
      leak: number;
      torque: number;
    };

export interface HydInput {
  /** Every hydraulic port key in the circuit. */
  ports: string[];
  /** Pairs of ports joined by a wire (same node, same pressure). */
  links: Array<[string, string]>;
  elements: HydElement[];
  /** Previous frame's solution, used as the starting guess - and, with `dt`, as the pressures
   * the oil was at a time step ago. */
  guess?: HydSolution;
  /**
   * Time step (s). When given, the oil is treated as slightly compressible: every node holds a
   * volume (line volume plus any cylinder chamber on it) whose pressure changes by
   * dp = ΣQ·dt·β/V - one implicit Euler step. Once nothing changes any more this term is zero, so
   * steady states are exactly the incompressible ones; what it adds is the right behaviour of
   * oil trapped in a closed-off volume (it keeps its pressure instead of being undetermined) and
   * realistic pressure build-up. Omitted: pure steady state.
   */
  dt?: number;
}

export interface HydSolution {
  /** Pressure (bar) at every port. */
  pressure: Map<string, number>;
  /** Net flow (L/min) each component pushes out through each of its ports into the line -
   * negative when oil flows into the component there. */
  portFlow: Map<string, number>;
  /** Per element: its flow (L/min, a→b direction) or, for actuators, its velocity (m/s) /
   * speed (rev/s). */
  elementValue: number[];
  /** Per element, for pistons: true while held against an end stop. */
  elementLocked: boolean[];
  converged: boolean;
  iterations: number;
}

/** Effective bulk modulus of oil plus hoses (bar). */
export const BULK_MODULUS = 10000;
/** Oil volume (L) of the lines making up each node. */
const LINE_VOLUME = 0.1;

/** Vapour pressure of the oil (bar gauge): no line can be sucked below this - the oil boils off
 * (cavitates) and fills the void instead. */
export const VAPOUR_PRESSURE = -0.95;
/** How stiffly the vapour-pressure floor is enforced, L/min per bar below it. */
const CAVITATION_GAIN = 2000;

/** Leakage conductance from every node to tank (L/min per bar) - small enough to be
 * invisible in any reading, large enough that an isolated, sealed-off node still has a defined
 * pressure instead of making the equations singular. */
const NODE_LEAK = 1e-7;
/** Below this pressure drop (bar) the orifice law's √ is replaced by a polynomial with the same
 * value and slope at the boundary, so the slope stays finite at Δp = 0 - exact above it. */
const ORIFICE_DELTA = 0.1;
/** Width (bar) of the smoothed opening edge of check/relief valves (C¹ instead of a kink). */
const EDGE_EPS = 0.1;
/** Pressure band (bar) over which a pilot-operated check valve goes from shut to fully open. */
const PILOT_BAND = 2;
/** Velocity (m/s) over which a moving mass's Coulomb friction is smoothed. */
const FRICTION_V0 = 2e-4;

/** Oil volume (L) a gas-loaded accumulator holds at gauge pressure `p` - see its HydElement. */
export function accumulatorOil(
  e: { volume: number; precharge: number; n: number },
  p: number,
): number {
  const p0abs = Math.max(e.precharge, 0) + 1;
  const pabs = p0abs + ramp(p - e.precharge);
  return e.volume * (1 - Math.pow(p0abs / pabs, 1 / Math.max(e.n, 1)));
}

/** Pressure difference (bar) over which a shuttle valve's ball moves from one seat to the other. */
const SHUTTLE_BAND = 0.5;

/** End-stop stiffness of a flow divider's compensating sleeve (bar per unit overtravel). */
const SPOOL_END_STIFFNESS = 2000;
/** Viscous damping of a piston, as the extra pressure (bar) it takes per m/s - small. */
const PISTON_VISCOUS_BAR = 0.02;
/** Viscous damping of a motor, bar per rev/s - small. */
const MOTOR_VISCOUS_BAR = 0.01;

/** k·sign(Δp)·√|Δp|, regularised inside |Δp| < ORIFICE_DELTA. */
function orificeFlow(k: number, dp: number): number {
  const a = Math.abs(dp);
  if (a >= ORIFICE_DELTA) return Math.sign(dp) * k * Math.sqrt(a);
  const t = dp / ORIFICE_DELTA;
  return k * Math.sqrt(ORIFICE_DELTA) * (1.25 * t - 0.25 * t * t * t);
}

/** One-way orifice opening at x = 0: 0 for x <= 0, k·√x above EDGE_EPS, a C¹ blend between. */
function seatFlow(k: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= EDGE_EPS) return k * Math.sqrt(x);
  const t = x / EDGE_EPS;
  return k * Math.sqrt(EDGE_EPS) * (2.5 * t * t - 1.5 * t * t * t);
}

/** Coulomb friction as a dead zone: 0 while |x| <= f (stiction - the actuator doesn't move),
 * x ∓ f beyond it. Piecewise linear, which suits Newton far better than a steep tanh. */
function deadZone(x: number, f: number): number {
  return ramp(x - f) - ramp(-x - f);
}

/** max(0, x), with the corner rounded over |x| < EDGE_EPS/2 (C¹) - exact outside that band. */
function ramp(x: number): number {
  const h = EDGE_EPS / 2;
  if (x <= -h) return 0;
  if (x >= h) return x;
  return ((x + h) * (x + h)) / (2 * EDGE_EPS);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Smooth 0→1 step for x in [0, 1]. */
function smoothstep(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

class UnionFind {
  private parent = new Map<string, string>();
  find(k: string): string {
    let p = this.parent.get(k);
    if (p === undefined) {
      this.parent.set(k, k);
      return k;
    }
    if (p === k) return k;
    p = this.find(p);
    this.parent.set(k, p);
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** Solves A·x = b in place (Gaussian elimination, partial pivoting). Returns null if singular. */
function solveLinear(A: Float64Array[], b: Float64Array): Float64Array | null {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(A[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r]![col]!);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-300) return null;
    if (piv !== col) {
      const tmp = A[piv]!;
      A[piv] = A[col]!;
      A[col] = tmp;
      const tb = b[piv]!;
      b[piv] = b[col]!;
      b[col] = tb;
    }
    const rowC = A[col]!;
    const d = rowC[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = A[r]!;
      const f = row[col]! / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) row[c]! -= f * rowC[c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    const row = A[r]!;
    for (let c = r + 1; c < n; c++) s -= row[c]! * x[c]!;
    x[r] = s / row[r]!;
  }
  return x;
}

interface Terminal {
  node: number;
}

export function solveHydraulics(input: HydInput): HydSolution {
  const uf = new UnionFind();
  for (const p of input.ports) uf.find(p);
  for (const [a, b] of input.links) uf.union(a, b);

  // Number the nodes.
  const nodeOfRoot = new Map<string, number>();
  const nodeOfPort = new Map<string, number>();
  const nodePorts: string[][] = [];
  const nodeFor = (port: string): number => {
    const root = uf.find(port);
    let n = nodeOfRoot.get(root);
    if (n === undefined) {
      n = nodePorts.length;
      nodeOfRoot.set(root, n);
      nodePorts.push([]);
    }
    if (!nodeOfPort.has(port)) {
      nodeOfPort.set(port, n);
      nodePorts[n]!.push(port);
    }
    return n;
  };
  for (const p of input.ports) nodeFor(p);
  const term = (port: string | undefined): Terminal | null =>
    port === undefined ? null : { node: nodeFor(port) };

  const els = input.elements;
  const nodeCount = (): number => nodePorts.length;

  // Resolve terminals once.
  const tA: Array<Terminal | null> = [];
  const tB: Array<Terminal | null> = [];
  const tX: Array<Terminal | null> = [];
  const tY: Array<Terminal | null> = [];
  for (const e of els) {
    tX.push('x' in e ? term(e.x) : null);
    tY.push('y' in e ? term(e.y) : null);
    switch (e.kind) {
      case 'pump':
        tA.push(null);
        tB.push(term(e.out));
        break;
      case 'tank':
      case 'accumulator':
        tA.push(term(e.a));
        tB.push(null);
        break;
      case 'piston':
        tA.push(term(e.a));
        tB.push(term(e.b));
        break;
      default:
        tA.push(term(e.a));
        tB.push(term(e.b));
    }
  }
  const N = nodeCount();

  // Nodes tied to tank are fixed at 0 bar; all others are unknowns.
  const fixed = new Uint8Array(N);
  els.forEach((e, i) => {
    if (e.kind === 'tank' && tA[i]) fixed[tA[i]!.node] = 1;
  });
  const varOfNode = new Int32Array(N).fill(-1);
  let nv = 0;
  for (let n = 0; n < N; n++) if (!fixed[n]) varOfNode[n] = nv++;
  const varOfElement = new Int32Array(els.length).fill(-1);
  els.forEach((e, i) => {
    if (
      e.kind === 'piston' ||
      e.kind === 'motor' ||
      e.kind === 'compensator' ||
      e.kind === 'rotaryDivider'
    ) {
      varOfElement[i] = nv++;
    }
  });
  const nVars = nv;

  // Starting guess.
  const x = new Float64Array(nVars);
  /** Pressure a time step ago, per unknown node. */
  const prev = new Float64Array(nVars);
  if (input.guess) {
    for (let n = 0; n < N; n++) {
      const v = varOfNode[n]!;
      if (v < 0) continue;
      let p = 0;
      for (const port of nodePorts[n]!) {
        const g = input.guess.pressure.get(port);
        if (g !== undefined && Number.isFinite(g)) {
          p = g;
          break;
        }
      }
      x[v] = p;
      prev[v] = p;
    }
  }
  /** Compressibility term per unknown node: L/min per bar of change over this step. */
  const capacity = new Float64Array(nVars);
  if (input.dt !== undefined) {
    const vol = new Float64Array(N).fill(LINE_VOLUME);
    els.forEach((e, i) => {
      if (e.kind !== 'piston') return;
      if (tA[i] && e.volA) vol[tA[i]!.node]! += e.volA;
      if (tB[i] && e.volB) vol[tB[i]!.node]! += e.volB;
    });
    const dt = Math.max(input.dt, 1e-3);
    for (let n = 0; n < N; n++) {
      const v = varOfNode[n]!;
      if (v >= 0) capacity[v] = ((vol[n]! / BULK_MODULUS) * 60) / dt;
    }
  }

  // Active set for pistons at an end stop: locked pistons have v = 0 forced.
  const locked = new Array<boolean>(els.length).fill(false);
  els.forEach((e, i) => {
    if (e.kind === 'piston') locked[i] = e.atMin || e.atMax;
  });

  const pressureOf = (xx: Float64Array, t: Terminal | null): number => {
    if (!t) return 0;
    const v = varOfNode[t.node]!;
    return v < 0 ? 0 : xx[v]!;
  };

  /** Flows (L/min) element i draws from the nodes at its terminals a, b (and x, y where it has
   * them) - negative where it pushes oil into that node - plus its reported value. */
  function elementFlows(
    xx: Float64Array,
    i: number,
  ): { qa: number; qb: number; qx?: number; qy?: number; value: number } {
    const e = els[i]!;
    const pa = pressureOf(xx, tA[i]!);
    const pb = pressureOf(xx, tB[i]!);
    switch (e.kind) {
      case 'orifice': {
        const q = orificeFlow(e.k, pa - pb);
        return { qa: q, qb: -q, value: q };
      }
      case 'check': {
        const q = seatFlow(e.k, pa - pb - e.crack);
        return { qa: q, qb: -q, value: q };
      }
      case 'pilotCheck': {
        const px = pressureOf(xx, tX[i]!);
        const opening = smoothstep(((px - pa) * e.ratio - (pb - pa)) / PILOT_BAND);
        const q = seatFlow(e.k, pa - pb - e.crack) + opening * orificeFlow(e.k, pa - pb);
        return { qa: q, qb: -q, value: q };
      }
      case 'relief': {
        const q = e.gain * ramp(pa - pb - e.set);
        return { qa: q, qb: -q, value: q };
      }
      case 'reducing': {
        const ref = tX[i] ? pressureOf(xx, tX[i]!) : 0;
        const opening = smoothstep((ref + e.set - pb) / e.band);
        const q = opening * orificeFlow(e.k, pa - pb);
        return { qa: q, qb: -q, value: q };
      }
      case 'flowControl': {
        const q = e.q * Math.tanh(ramp(pa - pb) / e.dpMin);
        return { qa: q, qb: -q, value: q };
      }
      case 'pump': {
        const band = e.band ?? 5;
        let f = e.comp === undefined ? 1 : smoothstep((e.comp - pb) / band);
        if (e.margin !== undefined && tX[i]) {
          const pls = pressureOf(xx, tX[i]!);
          f *= smoothstep((pls + e.margin - pb) / band);
        }
        const q = e.q * f - e.leak * Math.max(0, pb);
        // `qa` is the (nonexistent) suction side - the pump draws from the tank.
        return { qa: 0, qb: -q, value: q };
      }
      case 'tank':
        return { qa: 0, qb: 0, value: 0 };
      case 'loopPump':
        return { qa: -e.q, qb: e.q, value: e.q };
      case 'piston': {
        const v = xx[varOfElement[i]!]!;
        return { qa: e.areaA * v * 6, qb: -e.areaB * v * 6, value: v };
      }
      case 'motor': {
        const n = xx[varOfElement[i]!]!;
        const q = e.disp * n * 0.06;
        return { qa: q, qb: -q, value: n };
      }
      case 'shuttle': {
        const px = pressureOf(xx, tX[i]!);
        const w = smoothstep(0.5 + (pa - pb) / (2 * SHUTTLE_BAND));
        const q1 = w * orificeFlow(e.k, pa - px);
        const q2 = (1 - w) * orificeFlow(e.k, pb - px);
        return { qa: q1, qb: q2, qx: -(q1 + q2), value: w };
      }
      case 'accumulator': {
        if (input.dt === undefined) return { qa: 0, qb: 0, value: 0 };
        const q = ((accumulatorOil(e, pa) - e.oilPrev) * 60) / Math.max(input.dt, 1e-4);
        return { qa: q, qb: 0, value: q };
      }
      case 'counterbalance': {
        const px = pressureOf(xx, tX[i]!);
        const free = seatFlow(e.k, pa - pb - 1);
        const opening = smoothstep((pb + e.ratio * Math.max(0, px) - e.set) / e.band);
        const q = free - opening * orificeFlow(e.k, pb - pa);
        return { qa: q, qb: -q, value: q };
      }
      case 'sequence': {
        const opening = smoothstep((pa - e.set) / e.band);
        const back = e.check ? seatFlow(e.k, pb - pa - 1) : 0;
        const q = opening * orificeFlow(e.k, pa - pb) - back;
        return { qa: q, qb: -q, value: q };
      }
      case 'compensator': {
        const sp = xx[varOfElement[i]!]!;
        const px = pressureOf(xx, tX[i]!);
        const py = pressureOf(xx, tY[i]!);
        const q1 = clamp01(0.5 + sp) * orificeFlow(e.k, pa - px);
        const q2 = clamp01(0.5 - sp) * orificeFlow(e.k, pb - py);
        return { qa: q1, qb: q2, qx: -q1, qy: -q2, value: sp };
      }
      case 'rotaryDivider': {
        const n = xx[varOfElement[i]!]!;
        const px = pressureOf(xx, tX[i]!);
        const q1 = e.d1 * n * 0.06 + e.leak * (pa - pb);
        const q2 = e.d2 * n * 0.06 + e.leak * (pa - px);
        return { qa: q1 + q2, qb: -q1, qx: -q2, value: n };
      }
    }
  }

  /** Force/torque balance residual (bar-scaled) for actuator i - signed so that it grows with
   * the actuator's own speed, like a node's outflow grows with its pressure (which keeps the
   * pseudo-transient iteration below stable). */
  function actuatorResidual(xx: Float64Array, i: number): number {
    const e = els[i]!;
    if (e.kind === 'piston') {
      const v = xx[varOfElement[i]!]!;
      if (locked[i]) return v;
      const pa = pressureOf(xx, tA[i]!);
      const pb = pressureOf(xx, tB[i]!);
      const aRef = Math.max(e.areaA, e.areaB, 1e-6);
      const net = pa * e.areaA * 10 - pb * e.areaB * 10 - e.load;
      if (e.mass && e.mass > 0 && input.dt !== undefined) {
        // Newton's second law, implicit Euler: m·(v − v_prev)/dt = net − friction. Coulomb
        // friction is smoothed over ±FRICTION_V0 so a stopped piston can't creep noticeably.
        const accel = (e.mass * (v - (e.vPrev ?? 0))) / Math.max(input.dt, 1e-4);
        const friction = e.friction * Math.tanh(v / FRICTION_V0);
        return PISTON_VISCOUS_BAR * v + (accel + friction - net) / (10 * aRef);
      }
      return PISTON_VISCOUS_BAR * v - deadZone(net / (10 * aRef), e.friction / (10 * aRef));
    }
    if (e.kind === 'motor') {
      const n = xx[varOfElement[i]!]!;
      const pa = pressureOf(xx, tA[i]!);
      const pb = pressureOf(xx, tB[i]!);
      const etaHm = Math.min(1, Math.max(0.05, e.etaHm ?? 1));
      const torquePerBar = (Math.max(e.disp, 1e-6) * etaHm) / (20 * Math.PI);
      return MOTOR_VISCOUS_BAR * n - deadZone(pa - pb, Math.abs(e.torque) / torquePerBar);
    }
    if (e.kind === 'compensator') {
      const sp = xx[varOfElement[i]!]!;
      const pa = pressureOf(xx, tA[i]!);
      const pb = pressureOf(xx, tB[i]!);
      // The stop sits just beyond full closure (|s| = 0.5), so an outlet can actually shut.
      const endStop = SPOOL_END_STIFFNESS * (ramp(sp - 0.6) - ramp(-sp - 0.6));
      return e.spring * sp + endStop - (pa - pb);
    }
    if (e.kind === 'rotaryDivider') {
      const n = xx[varOfElement[i]!]!;
      const pa = pressureOf(xx, tA[i]!);
      const pb = pressureOf(xx, tB[i]!);
      const px = pressureOf(xx, tX[i]!);
      const dSum = Math.max(e.d1 + e.d2, 1e-6);
      // Mean pressure drop across the two sections, weighted by displacement: Δp_eff·(d1+d2)/20π
      // is the net shaft torque.
      const dpEff = ((pa - pb) * e.d1 + (pa - px) * e.d2) / dSum;
      return MOTOR_VISCOUS_BAR * n - deadZone(dpEff, (Math.abs(e.torque) * 20 * Math.PI) / dSum);
    }
    return 0;
  }

  function residual(xx: Float64Array, out: Float64Array): void {
    out.fill(0);
    for (let n = 0; n < N; n++) {
      const v = varOfNode[n]!;
      if (v >= 0) {
        const p = xx[v]!;
        out[v] =
          NODE_LEAK * p +
          capacity[v]! * (p - prev[v]!) -
          CAVITATION_GAIN * ramp(VAPOUR_PRESSURE - p);
      }
    }
    for (let i = 0; i < els.length; i++) {
      const { qa, qb, qx, qy } = elementFlows(xx, i);
      const add = (t: Terminal | null | undefined, q: number | undefined): void => {
        if (!t || q === undefined) return;
        const v = varOfNode[t.node]!;
        if (v >= 0) out[v]! += q;
      };
      add(tA[i], qa);
      add(tB[i], qb);
      add(tX[i], qx);
      add(tY[i], qy);
      const av = varOfElement[i]!;
      if (av >= 0) out[av] = actuatorResidual(xx, i);
    }
  }

  const norm = (r: Float64Array): number => {
    let m = 0;
    for (let k = 0; k < r.length; k++) m = Math.max(m, Math.abs(r[k]!));
    return m;
  };

  function jacobian(xx: Float64Array, r: Float64Array): Float64Array[] {
    // Numerical Jacobian (forward differences) - the networks are small.
    const J: Float64Array[] = [];
    for (let k = 0; k < nVars; k++) J.push(new Float64Array(nVars));
    const r2 = new Float64Array(nVars);
    for (let c = 0; c < nVars; c++) {
      const h = 1e-6 * Math.max(1, Math.abs(xx[c]!));
      const keep = xx[c]!;
      xx[c] = keep + h;
      residual(xx, r2);
      xx[c] = keep;
      for (let rr = 0; rr < nVars; rr++) J[rr]![c] = (r2[rr]! - r[rr]!) / h;
    }
    return J;
  }

  const TOL = 1e-7;

  /** Damped Newton with a backtracking line search - fast from a good guess (e.g. last frame). */
  function lineSearchNewton(maxIt: number): { converged: boolean; iterations: number } {
    const r = new Float64Array(nVars);
    const r2 = new Float64Array(nVars);
    const xTry = new Float64Array(nVars);
    residual(x, r);
    let rn = norm(r);
    for (let it = 0; it < maxIt; it++) {
      if (rn < TOL) return { converged: true, iterations: it };
      const J = jacobian(x, r);
      const rhs = new Float64Array(nVars);
      for (let k = 0; k < nVars; k++) rhs[k] = -r[k]!;
      const dx = solveLinear(J, rhs);
      if (!dx) return { converged: false, iterations: it };
      let alpha = 1;
      let accepted = false;
      for (let ls = 0; ls < 20; ls++) {
        for (let k = 0; k < nVars; k++) xTry[k] = x[k]! + alpha * dx[k]!;
        residual(xTry, r2);
        const n2 = norm(r2);
        if (Number.isFinite(n2) && n2 < rn * (1 - 1e-4 * alpha)) {
          x.set(xTry);
          r.set(r2);
          rn = n2;
          accepted = true;
          break;
        }
        alpha *= 0.5;
      }
      if (!accepted) return { converged: false, iterations: it };
    }
    return { converged: rn < TOL * 100, iterations: maxIt };
  }

  /**
   * Pseudo-transient continuation: each step solves (I/Δτ + J)·dx = −R, i.e. marches a fictitious
   * "fill the lines" transient towards steady state, growing Δτ as the residual falls (switched
   * evolution relaxation). Much more robust than plain Newton from a poor starting point -
   * stalled actuators, valves just cracking open - and becomes Newton as Δτ → ∞.
   */
  function pseudoTransient(maxIt: number): { converged: boolean; iterations: number } {
    const r = new Float64Array(nVars);
    const r2 = new Float64Array(nVars);
    const xTry = new Float64Array(nVars);
    residual(x, r);
    let rn = norm(r);
    const rn0 = Math.max(rn, 1e-12);
    let dtau = 0.01;
    for (let it = 0; it < maxIt; it++) {
      if (rn < TOL) return { converged: true, iterations: it };
      const J = jacobian(x, r);
      for (let k = 0; k < nVars; k++) J[k]![k]! += 1 / dtau;
      const rhs = new Float64Array(nVars);
      for (let k = 0; k < nVars; k++) rhs[k] = -r[k]!;
      const dx = solveLinear(J, rhs);
      if (!dx) return { converged: false, iterations: it };
      for (let k = 0; k < nVars; k++) xTry[k] = x[k]! + dx[k]!;
      residual(xTry, r2);
      const n2 = norm(r2);
      if (!Number.isFinite(n2) || n2 > 10 * rn) {
        dtau *= 0.25;
        continue;
      }
      x.set(xTry);
      r.set(r2);
      rn = n2;
      dtau = Math.min(1e12, 0.01 * Math.pow(rn0 / Math.max(rn, 1e-300), 1.5) + dtau * 1.5);
    }
    return { converged: rn < TOL * 100, iterations: maxIt };
  }

  function newton(): { converged: boolean; iterations: number } {
    if (nVars === 0) return { converged: true, iterations: 0 };
    const start = Float64Array.from(x);
    const fast = lineSearchNewton(30);
    if (fast.converged) return fast;
    x.set(start);
    const slow = pseudoTransient(400);
    return { converged: slow.converged, iterations: fast.iterations + slow.iterations };
  }

  // Newton with an active-set loop for pistons hitting/leaving their end stops.
  let result = newton();
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    els.forEach((e, i) => {
      if (e.kind !== 'piston') return;
      if (locked[i]) {
        // Would the piston, if released, move away from the stop it is resting on?
        const pa = pressureOf(x, tA[i]!);
        const pb = pressureOf(x, tB[i]!);
        const drive = pa * e.areaA * 10 - pb * e.areaB * 10 - e.load;
        const away = e.atMax ? drive < -e.friction : drive > e.friction;
        if (away || (!e.atMin && !e.atMax)) {
          locked[i] = false;
          changed = true;
        }
      } else {
        const v = x[varOfElement[i]!]!;
        if ((e.atMax && v > 0) || (e.atMin && v < 0)) {
          locked[i] = true;
          x[varOfElement[i]!] = 0;
          changed = true;
        }
      }
    });
    if (!changed) break;
    result = newton();
  }

  // Report.
  const pressure = new Map<string, number>();
  for (let n = 0; n < N; n++) {
    const v = varOfNode[n]!;
    const p = v < 0 ? 0 : x[v]!;
    for (const port of nodePorts[n]!) pressure.set(port, p);
  }
  const portFlow = new Map<string, number>();
  for (const p of input.ports) portFlow.set(p, 0);
  const elementValue: number[] = [];
  const addFlow = (port: string | undefined, q: number): void => {
    if (port === undefined) return;
    portFlow.set(port, (portFlow.get(port) ?? 0) + q);
  };
  els.forEach((e, i) => {
    const { qa, qb, qx, qy, value } = elementFlows(x, i);
    elementValue.push(value);
    // qa/qb are flows drawn *from* the node into the element; out of the component is the
    // negative of that.
    if (e.kind === 'pump') addFlow(e.out, -qb);
    else if (e.kind !== 'tank') {
      addFlow((e as { a?: string }).a, -qa);
      addFlow((e as { b?: string }).b, -qb);
      if (qx !== undefined) addFlow((e as { x?: string }).x, -qx);
      if (qy !== undefined) addFlow((e as { y?: string }).y, -qy);
    }
  });
  // Tank connections absorb whatever arrives at their node.
  els.forEach((e, i) => {
    if (e.kind !== 'tank' || !tA[i]) return;
    const node = tA[i]!.node;
    let net = 0;
    for (const port of nodePorts[node]!) if (port !== e.a) net += portFlow.get(port) ?? 0;
    // Shared between all tank terminals on the same node - normally just one.
    const tanks = els.filter((t, j) => t.kind === 'tank' && tA[j]?.node === node).length;
    addFlow(e.a, -net / tanks);
  });

  return {
    pressure,
    portFlow,
    elementValue,
    elementLocked: locked,
    converged: result.converged,
    iterations: result.iterations,
  };
}

/**
 * Flow (L/min) along each wire, from its `from` end to its `to` end, given the net flow every
 * port pushes into the line (`portFlow`). Exact for tree-shaped nets (the normal case: wires
 * and junctions branching without loops) - peeled leaf by leaf. Wires that close a loop can't
 * be resolved from port flows alone and are reported as NaN.
 */
export function wireFlows(
  wires: Array<{ id: number; from: string; to: string }>,
  portFlow: Map<string, number>,
): Map<number, number> {
  const result = new Map<number, number>();
  const adj = new Map<string, Array<{ id: number; other: string; sign: number }>>();
  for (const w of wires) {
    (adj.get(w.from) ?? adj.set(w.from, []).get(w.from)!).push({ id: w.id, other: w.to, sign: 1 });
    (adj.get(w.to) ?? adj.set(w.to, []).get(w.to)!).push({ id: w.id, other: w.from, sign: -1 });
  }
  const inj = new Map<string, number>();
  for (const port of adj.keys()) inj.set(port, portFlow.get(port) ?? 0);
  const degree = new Map<string, number>();
  for (const [port, list] of adj) degree.set(port, list.length);
  const done = new Set<number>();
  const queue = [...adj.keys()].filter((p) => degree.get(p) === 1);
  while (queue.length > 0) {
    const leaf = queue.pop()!;
    if (degree.get(leaf) !== 1) continue;
    const edge = adj.get(leaf)!.find((e) => !done.has(e.id));
    if (!edge) continue;
    done.add(edge.id);
    const q = inj.get(leaf) ?? 0;
    // Flow leaves `leaf` along this wire; positive means from→to when leaf is `from`.
    result.set(edge.id, edge.sign * q);
    inj.set(edge.other, (inj.get(edge.other) ?? 0) + q);
    degree.set(leaf, 0);
    const d = (degree.get(edge.other) ?? 1) - 1;
    degree.set(edge.other, d);
    if (d === 1) queue.push(edge.other);
  }
  for (const w of wires) if (!result.has(w.id)) result.set(w.id, NaN);
  return result;
}
