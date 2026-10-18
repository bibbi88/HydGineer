import type { SimStepContext } from '../core/types';
import { appState } from '../app/AppState';
import { getSignal, setSignal } from './signals';
import { solveElectrical } from './electrical';
import { portKey } from './ports';
import { setPressureScale } from './pressureScale';
import { solveHydraulics, wireFlows, type HydElement, type HydSolution } from './hydraulics';

/** Everything render.ts needs from one simulation frame. */
export interface HydFrame {
  solution: HydSolution;
  /** Flow (L/min) along each connection, from its `from` end to its `to` end (NaN if unknown). */
  wireFlow: Map<number, number>;
}

let lastSolution: HydSolution | undefined;
let lastTopology = -1;

export function resetHydraulics(): void {
  lastSolution = undefined;
  lastTopology = -1;
}

/** Re-keys a component's element (local port keys) onto global port keys. */
function globalize(id: number, e: HydElement): HydElement {
  const k = (p: string): string => portKey(id, p);
  switch (e.kind) {
    case 'pump':
      return { ...e, out: k(e.out), x: e.x === undefined ? undefined : k(e.x) };
    case 'tank':
    case 'accumulator':
      return { ...e, a: k(e.a) };
    case 'piston':
      return {
        ...e,
        a: e.a === undefined ? undefined : k(e.a),
        b: e.b === undefined ? undefined : k(e.b),
      };
    case 'pilotCheck':
    case 'rotaryDivider':
    case 'counterbalance':
    case 'shuttle':
      return { ...e, a: k(e.a), b: k(e.b), x: k(e.x) };
    case 'compensator':
      return { ...e, a: k(e.a), b: k(e.b), x: k(e.x), y: k(e.y) };
    case 'reducing':
      return { ...e, a: k(e.a), b: k(e.b), x: e.x === undefined ? undefined : k(e.x) };
    default:
      return { ...e, a: k(e.a), b: k(e.b) };
  }
}

/** Longest time step (s) the hydraulics are solved over. A frame is split into substeps of at
 * most this, so a moving mass against the springy oil column (oscillating at tens of Hz) and an
 * accumulator's gas spring are integrated finely enough to show real pressure peaks. */
export const MAX_SUBSTEP = 0.002;

export function stepSimulation(dt: number): HydFrame {
  // Electrical first, so solenoid valves/pump motors see this frame's coil states.
  solveElectrical(dt);
  for (const c of appState.components) c.recompute?.();

  const ports: string[] = [];
  const isHydraulic = new Set<string>();
  for (const c of appState.components) {
    for (const p of Object.values(c.ports)) {
      if (p.electrical) continue;
      const key = portKey(c.id, p.key);
      ports.push(key);
      isHydraulic.add(key);
    }
  }
  const links: Array<[string, string]> = [];
  const wires: Array<{ id: number; from: string; to: string }> = [];
  for (const conn of appState.connections) {
    const from = portKey(conn.from.id, conn.from.port);
    const to = portKey(conn.to.id, conn.to.port);
    if (!isHydraulic.has(from) || !isHydraulic.has(to)) continue;
    links.push([from, to]);
    wires.push({ id: conn.id, from, to });
  }

  if (appState.topologyVersion !== lastTopology) {
    lastTopology = appState.topologyVersion;
    lastSolution = undefined;
  }

  const substeps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP - 1e-9));
  const h = dt / substeps;
  let solution = lastSolution;
  for (let sub = 0; sub < substeps; sub++) {
    // Re-read every substep: cylinder positions, accumulator contents etc. have moved on.
    const elements: HydElement[] = [];
    const firstElement = new Map<number, number>();
    for (const c of appState.components) {
      firstElement.set(c.id, elements.length);
      for (const e of c.hydElements?.() ?? []) elements.push(globalize(c.id, e));
    }
    const sol = solveHydraulics({ ports, links, elements, guess: solution, dt: h });
    solution = sol;
    if (sub === substeps - 1) {
      let pMax = 0;
      for (const p of sol.pressure.values()) pMax = Math.max(pMax, p);
      setPressureScale(pMax);
    }
    for (const c of appState.components) {
      if (!c.step) continue;
      const base = firstElement.get(c.id) ?? 0;
      const ctx: SimStepContext = {
        dt: h,
        pressureAt: (p) => sol.pressure.get(portKey(c.id, p)) ?? 0,
        flowAt: (p) => sol.portFlow.get(portKey(c.id, p)) ?? 0,
        elementValue: (i) => sol.elementValue[base + i] ?? 0,
        elementLocked: (i) => sol.elementLocked[base + i] ?? false,
        isPressurized: (p) => (sol.pressure.get(portKey(c.id, p)) ?? 0) > 1,
        emitSignal: setSignal,
        readSignal: getSignal,
      };
      c.step(h, ctx);
    }
  }
  lastSolution = solution;
  const final = solution!;
  return { solution: final, wireFlow: wireFlows(wires, final.portFlow) };
}
