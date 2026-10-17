import { appState } from '../app/AppState';
import { portKey } from './pressure';
import { getSignal, setSignal } from './signals';

/** Upper bound on relay-chain settling passes per frame (a coil closing a contact that
 * energizes another coil, and so on) - far more than any realistic circuit needs. */
const MAX_PASSES = 10;

let liveNodes = new Set<string>();

/** Whether the electrical terminal `key` (see `portKey`) is currently connected to +24 V. */
export function isElectricallyLive(key: string): boolean {
  return liveNodes.has(key);
}

export function clearElectrical(): void {
  liveNodes = new Set();
  for (const c of appState.components) c.electrical?.setEnergized?.(false);
}

function reachable(starts: string[], adjacency: Map<string, string[]>): Set<string> {
  const seen = new Set<string>(starts);
  const queue = [...starts];
  while (queue.length > 0) {
    const cur = queue.pop() as string;
    for (const next of adjacency.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * Solves the electrical side of the diagram for this frame: which terminals are connected to
 * +24 V and to 0 V through wires and currently-closed contacts, and so which coils/lamps are
 * energized. Energized coils publish their key on the signal bus (the same one cylinder sensors
 * use), which is what contacts and solenoid valves bound to that key read - so the whole thing
 * is repeated until no signal changes, letting relay chains settle within one frame.
 */
export function solveElectrical(dt: number): void {
  const electrical = appState.components.filter((c) => c.electrical);
  if (electrical.length === 0) {
    if (liveNodes.size > 0) liveNodes = new Set();
    return;
  }

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // A function block's own elapsed time/count must only advance once per real frame, not
    // once per settling pass within it - later passes here are purely re-evaluating logic
    // against newly-settled contact/coil states, not the passage of more time.
    const passDt = pass === 0 ? dt : 0;
    // Contacts and valves bound to a key read the signal bus here, so they reflect the coils
    // solved on the previous pass.
    for (const c of appState.components) c.recompute?.();

    const adjacency = new Map<string, string[]>();
    const link = (a: string, b: string): void => {
      (adjacency.get(a) ?? adjacency.set(a, []).get(a))?.push(b);
      (adjacency.get(b) ?? adjacency.set(b, []).get(b))?.push(a);
    };
    for (const conn of appState.connections) {
      link(portKey(conn.from.id, conn.from.port), portKey(conn.to.id, conn.to.port));
    }

    const plus: string[] = [];
    const zero: string[] = [];
    for (const c of electrical) {
      const e = c.electrical;
      if (!e) continue;
      if (e.role) (e.role.kind === 'plus' ? plus : zero).push(portKey(c.id, e.role.port));
      for (const port of e.sources?.() ?? []) plus.push(portKey(c.id, port));
      for (const edge of e.closedEdges?.() ?? []) {
        link(portKey(c.id, edge.a), portKey(c.id, edge.b));
      }
    }

    const live = reachable(plus, adjacency);
    const ground = reachable(zero, adjacency);
    liveNodes = live;

    let changed = false;
    for (const c of electrical) {
      const load = c.electrical?.load;
      if (!load) continue;
      const a = portKey(c.id, load.a);
      const b = portKey(c.id, load.b);
      const energized = (live.has(a) && ground.has(b)) || (live.has(b) && ground.has(a));
      c.electrical?.setEnergized?.(energized);
      if (load.key && getSignal(load.key) !== energized) {
        setSignal(load.key, energized);
        changed = true;
      }
    }
    for (const c of electrical) {
      const scan = c.electrical?.scan;
      if (
        scan?.call(
          c.electrical,
          passDt,
          (p) => live.has(portKey(c.id, p)),
          (p) => ground.has(portKey(c.id, p)),
        )
      ) {
        changed = true;
      }
    }
    if (!changed) break;
  }
}
