import type { SimStepContext } from '../core/types';
import { appState } from '../app/AppState';
import { getSignal, setSignal } from './signals';
import { solveElectrical } from './electrical';
import { portKey } from './ports';
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
      return { ...e, out: k(e.out) };
    case 'tank':
      return { ...e, a: k(e.a) };
    case 'piston':
      return {
        ...e,
        a: e.a === undefined ? undefined : k(e.a),
        b: e.b === undefined ? undefined : k(e.b),
      };
    case 'pilotCheck':
      return { ...e, a: k(e.a), b: k(e.b), x: k(e.x) };
    default:
      return { ...e, a: k(e.a), b: k(e.b) };
  }
}

export function stepSimulation(dt: number): HydFrame {
  // Electrical first, so solenoid valves/pump motors see this frame's coil states.
  solveElectrical(dt);
  for (const c of appState.components) c.recompute?.();

  const ports: string[] = [];
  const isHydraulic = new Set<string>();
  const elements: HydElement[] = [];
  const firstElement = new Map<number, number>();
  for (const c of appState.components) {
    for (const p of Object.values(c.ports)) {
      if (p.electrical) continue;
      const key = portKey(c.id, p.key);
      ports.push(key);
      isHydraulic.add(key);
    }
    firstElement.set(c.id, elements.length);
    for (const e of c.hydElements?.() ?? []) elements.push(globalize(c.id, e));
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
  const solution = solveHydraulics({ ports, links, elements, guess: lastSolution, dt });
  lastSolution = solution;

  for (const c of appState.components) {
    if (!c.step) continue;
    const base = firstElement.get(c.id) ?? 0;
    const ctx: SimStepContext = {
      dt,
      pressureAt: (p) => solution.pressure.get(portKey(c.id, p)) ?? 0,
      flowAt: (p) => solution.portFlow.get(portKey(c.id, p)) ?? 0,
      elementValue: (i) => solution.elementValue[base + i] ?? 0,
      elementLocked: (i) => solution.elementLocked[base + i] ?? false,
      isPressurized: (p) => (solution.pressure.get(portKey(c.id, p)) ?? 0) > 1,
      emitSignal: setSignal,
      readSignal: getSignal,
    };
    c.step(dt, ctx);
  }

  return { solution, wireFlow: wireFlows(wires, solution.portFlow) };
}
