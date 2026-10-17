import type { Component, ComponentId, Connection, PortKey } from '../core/types';
import { SOURCE_PRESSURE } from './constants';

export type PortKeyStr = string;

export function portKey(id: ComponentId, port: PortKey): PortKeyStr {
  return `${id}:${port}`;
}

export interface FrameGraph {
  pressurized: Set<PortKeyStr>;
  /** Directed weighted adjacency: neighbor -> multiplier to apply when flow crosses that edge. */
  adjacency: Map<PortKeyStr, Map<PortKeyStr, number>>;
  /** `adjacency` transposed - port -> every port with an edge pointing *into* it. Wires and
   * components like the one-way flow control valve add both directions of their edge to
   * `adjacency` already, so this only actually matters for a genuinely one-directional edge
   * (e.g. a plain check valve's `directed: true`), where it's the only way to discover, from the
   * downstream port, that an edge from the upstream port exists at all - `adjacency` alone only
   * exposes edges leaving a port, never ones arriving at it. */
  reverseAdjacency: Map<PortKeyStr, Set<PortKeyStr>>;
  sourceKeys: Set<PortKeyStr>;
  /** Ports with at least one wire attached. Air only escapes to atmosphere through a port with
   * nothing connected to it (a valve's exhaust port, the open end of a throttle) - a wired dead
   * end (another cylinder's chamber, a closed valve port, the outlet of a valve that won't let
   * air back through) traps it instead. See `flowMultiplierToOpenExhaust`. */
  wiredKeys: Set<PortKeyStr>;
  /** Pressure (bar) available at each port that has any - see `computePressures`. A port absent
   * from the map has none: either it isn't pressurized, or no live supply reaches it. */
  pressure: Map<PortKeyStr, number>;
  /** Per-edge pressure ceilings, mirroring `adjacency`'s own shape. Only edges that actually cap
   * something appear here, which in practice means pressure-reducing valves. */
  pressureCaps: Map<PortKeyStr, Map<PortKeyStr, number>>;
  /** Ports carrying live exhaust flow this frame (populated by `markExhaustFlow`, after step()
   * has run and components can report what they're currently venting) - purely a
   * visualization signal, not consulted anywhere in the pressure/conductivity simulation. */
  exhausting: Set<PortKeyStr>;
  /** Hop count from the nearest venting port, for every port in `exhausting` - lets a renderer
   * tell which end of a wire air is coming from without needing its own separate walk. */
  exhaustDepth: Map<PortKeyStr, number>;
  /** Hop count back toward the supply from the nearest port actively drawing supply air (see
   * `markSupplyFlow`), for every port currently carrying live supply flow - the supply-side
   * counterpart of `exhaustDepth`. Visualization only, like `exhausting`. */
  supplyDepth: Map<PortKeyStr, number>;
}

export function emptyFrameGraph(): FrameGraph {
  return {
    pressurized: new Set(),
    adjacency: new Map(),
    reverseAdjacency: new Map(),
    sourceKeys: new Set(),
    wiredKeys: new Set(),
    pressure: new Map(),
    pressureCaps: new Map(),
    exhausting: new Set(),
    exhaustDepth: new Map(),
    supplyDepth: new Map(),
  };
}

/**
 * Walks back toward the supply from every port currently drawing supply air in (see
 * `Component.currentlyFilling`), following edges against their direction (`reverseAdjacency`:
 * which ports can feed air into this one) and only through pressurized ports, recording each
 * port's hop count in `graph.supplyDepth`. Supply air streams from higher counts toward lower
 * ones. Like `markExhaustFlow`, call after the step() pass and before rendering.
 */
export function markSupplyFlow(graph: FrameGraph, fillingKeys: PortKeyStr[]): void {
  graph.supplyDepth.clear();

  const queue: PortKeyStr[] = [];
  for (const key of fillingKeys) {
    if (graph.supplyDepth.has(key) || !graph.pressurized.has(key)) continue;
    graph.supplyDepth.set(key, 0);
    queue.push(key);
  }

  while (queue.length > 0) {
    const cur = queue.shift() as PortKeyStr;
    const curDepth = graph.supplyDepth.get(cur) ?? 0;
    for (const prev of graph.reverseAdjacency.get(cur) ?? []) {
      if (graph.supplyDepth.has(prev) || !graph.pressurized.has(prev)) continue;
      graph.supplyDepth.set(prev, curDepth + 1);
      queue.push(prev);
    }
  }
}

/**
 * Walks outward from every currently-venting port (see `Component.currentlyVenting`) over the
 * same adjacency graph the pressure simulation itself uses, marking every port air can reach on
 * its way out - wires between two marked ports are exhausting live air this frame. Call after
 * the step() pass (venting state isn't known until then) and before rendering; mutates `graph`
 * in place rather than returning a new one so callers already holding a reference see it too.
 */
export function markExhaustFlow(graph: FrameGraph, ventingKeys: PortKeyStr[]): void {
  graph.exhausting.clear();
  graph.exhaustDepth.clear();

  const queue: PortKeyStr[] = [];
  for (const key of ventingKeys) {
    if (graph.exhausting.has(key)) continue;
    graph.exhausting.add(key);
    graph.exhaustDepth.set(key, 0);
    queue.push(key);
  }

  while (queue.length > 0) {
    const cur = queue.shift() as PortKeyStr;
    const curDepth = graph.exhaustDepth.get(cur) ?? 0;
    for (const next of graph.adjacency.get(cur)?.keys() ?? []) {
      if (!graph.exhausting.has(next)) {
        graph.exhausting.add(next);
        graph.exhaustDepth.set(next, curDepth + 1);
        queue.push(next);
      }
    }
  }
}

interface WireAdjacencyCache {
  version: number;
  adjacency: Map<PortKeyStr, Set<PortKeyStr>>;
}

let wireCache: WireAdjacencyCache | null = null;

/** Wire-only adjacency, rebuilt only when the topology (components/connections) actually changes. */
function getWireAdjacency(
  connections: Connection[],
  topologyVersion: number,
): Map<PortKeyStr, Set<PortKeyStr>> {
  if (wireCache && wireCache.version === topologyVersion) return wireCache.adjacency;

  const adjacency = new Map<PortKeyStr, Set<PortKeyStr>>();
  for (const conn of connections) {
    const a = portKey(conn.from.id, conn.from.port);
    const b = portKey(conn.to.id, conn.to.port);
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  }

  wireCache = { version: topologyVersion, adjacency };
  return adjacency;
}

function addDirEdge(
  adjacency: Map<PortKeyStr, Map<PortKeyStr, number>>,
  reverseAdjacency: Map<PortKeyStr, Set<PortKeyStr>>,
  a: PortKeyStr,
  b: PortKeyStr,
  multiplier: number,
  pressureCaps?: Map<PortKeyStr, Map<PortKeyStr, number>>,
  pressureCap?: number | null,
): void {
  if (!adjacency.has(a)) adjacency.set(a, new Map());
  adjacency.get(a)?.set(b, multiplier);
  if (!reverseAdjacency.has(b)) reverseAdjacency.set(b, new Set());
  reverseAdjacency.get(b)?.add(a);

  if (pressureCaps && pressureCap != null && Number.isFinite(pressureCap)) {
    if (!pressureCaps.has(a)) pressureCaps.set(a, new Map());
    pressureCaps.get(a)?.set(b, Math.max(0, pressureCap));
  }
}

/**
 * Pressure available at every reachable port: each live supply port starts at SOURCE_PRESSURE,
 * and crossing an edge yields `min(pressure behind it, that edge's ceiling)`.
 *
 * Each port keeps the *highest* pressure any path can deliver to it, which is what makes a line
 * fed from both a regulator and the raw supply behave the way the real circuit does - the
 * unregulated path wins, rather than a regulator quietly limiting a line it isn't actually in
 * series with. That makes this a widest-path relaxation rather than a plain flood: a port is
 * re-examined whenever a better path to it turns up. It terminates because a port's value only
 * ever increases and is bounded above by SOURCE_PRESSURE.
 */
function computePressures(
  adjacency: Map<PortKeyStr, Map<PortKeyStr, number>>,
  pressureCaps: Map<PortKeyStr, Map<PortKeyStr, number>>,
  pressurized: Set<PortKeyStr>,
  sourceKeys: Set<PortKeyStr>,
): Map<PortKeyStr, number> {
  const pressure = new Map<PortKeyStr, number>();
  const queue: PortKeyStr[] = [];
  for (const key of sourceKeys) {
    if (!pressurized.has(key)) continue;
    pressure.set(key, SOURCE_PRESSURE);
    queue.push(key);
  }

  while (queue.length > 0) {
    const cur = queue.shift() as PortKeyStr;
    const curPressure = pressure.get(cur) ?? 0;
    const caps = pressureCaps.get(cur);
    for (const next of adjacency.get(cur)?.keys() ?? []) {
      const cap = caps?.get(next);
      const candidate = cap == null ? curPressure : Math.min(curPressure, cap);
      if (candidate > (pressure.get(next) ?? 0)) {
        pressure.set(next, candidate);
        queue.push(next);
      }
    }
  }

  return pressure;
}

/** Pressure (bar) at `key` - 0 if it has none. */
export function pressureAt(graph: FrameGraph, key: PortKeyStr): number {
  return graph.pressure.get(key) ?? 0;
}

function flood(
  adjacency: Map<PortKeyStr, Map<PortKeyStr, number>>,
  pressurized: Set<PortKeyStr>,
): void {
  const queue = [...pressurized];
  while (queue.length > 0) {
    const cur = queue.shift() as PortKeyStr;
    for (const next of adjacency.get(cur)?.keys() ?? []) {
      if (!pressurized.has(next)) {
        pressurized.add(next);
        queue.push(next);
      }
    }
  }
}

/**
 * Builds this frame's pressure state: seeds from every component's source ports, then floods
 * over wires plus each component's current conductivity rule, iterating to a fixed point
 * (valve/AND/OR-style rules can only become newly satisfied as more ports light up).
 * The wire adjacency itself is cached by topologyVersion; only this per-frame dynamic overlay
 * (component-internal conductivity, which can depend on current pressurized state) is rebuilt
 * every call, and that part stays cheap (O(components) per pass, 1-3 passes to converge).
 */
export function computeFrameGraph(
  components: Component[],
  connections: Connection[],
  topologyVersion: number,
): FrameGraph {
  const wireAdjacency = getWireAdjacency(connections, topologyVersion);

  const adjacency = new Map<PortKeyStr, Map<PortKeyStr, number>>();
  const reverseAdjacency = new Map<PortKeyStr, Set<PortKeyStr>>();
  const pressureCaps = new Map<PortKeyStr, Map<PortKeyStr, number>>();
  for (const [a, neighbors] of wireAdjacency) {
    for (const b of neighbors) addDirEdge(adjacency, reverseAdjacency, a, b, 1);
  }

  const pressurized = new Set<PortKeyStr>();
  const sourceKeys = new Set<PortKeyStr>();
  for (const c of components) {
    for (const p of c.sourcePorts?.() ?? []) {
      const key = portKey(c.id, p);
      pressurized.add(key);
      sourceKeys.add(key);
    }
  }
  flood(adjacency, pressurized);

  let changed = true;
  while (changed) {
    const sizeBefore = pressurized.size;
    for (const c of components) {
      const edges = c.conductivityRule({ isPressurized: (p) => pressurized.has(portKey(c.id, p)) });
      for (const edge of edges) {
        const a = portKey(c.id, edge.a);
        const b = portKey(c.id, edge.b);
        // Each direction gets its own multiplier lookup - a component like the one-way flow
        // control valve conducts both ways on one undirected edge but throttles only one of
        // them, so reusing a single (edge.a, edge.b) multiplier for both directions would
        // silently apply the free-flow rate to the throttled direction too.
        addDirEdge(
          adjacency,
          reverseAdjacency,
          a,
          b,
          c.flowMultiplier?.(edge.a, edge.b) ?? 1,
          pressureCaps,
          c.pressureLimit?.(edge.a, edge.b),
        );
        if (!edge.directed) {
          addDirEdge(
            adjacency,
            reverseAdjacency,
            b,
            a,
            c.flowMultiplier?.(edge.b, edge.a) ?? 1,
            pressureCaps,
            c.pressureLimit?.(edge.b, edge.a),
          );
        }
      }
    }
    flood(adjacency, pressurized);
    changed = pressurized.size > sizeBefore;
  }

  return {
    pressurized,
    adjacency,
    reverseAdjacency,
    sourceKeys,
    wiredKeys: new Set(wireAdjacency.keys()),
    pressure: computePressures(adjacency, pressureCaps, pressurized, sourceKeys),
    pressureCaps,
    exhausting: new Set(),
    exhaustDepth: new Map(),
    supplyDepth: new Map(),
  };
}

/**
 * Multiplier for air escaping outward from `fromKey` (a cylinder's currently-venting port) to
 * open atmosphere - i.e. a "meter-out" speed control, the flow-control placement real pneumatic
 * circuits actually favor for controlling actuator speed (throttling the exhaust rather than
 * the supply gives much steadier control, since the exhausting chamber is what's resisting the
 * piston's motion). Walks the graph outward from `fromKey`, multiplying each edge's flow
 * multiplier along the way, until it dead-ends at a port with no further unvisited neighbors.
 * There's no dedicated "atmosphere" node in this graph: an open port - one with no wire attached,
 * like a valve's exhaust port (typically fitted with just a silencer, which doesn't appear here)
 * or the free end of a throttle - is what stands in for it. A dead end at a *wired* port is not
 * a way out: the air is trapped there (another cylinder's chamber on the same line, a closed
 * valve port, the outlet of a check or pressure reducing valve that won't let air back through).
 * When more than one open port is reachable (a branching exhaust path), the most restrictive one
 * wins, matching this simulator's existing multiply-along-the-path model for components in
 * series. Returns 1 (unrestricted) if `fromKey` isn't wired to anything at all - it then vents
 * straight to atmosphere itself - and 0 if it is wired but no open port can be reached, so a
 * cylinder whose exhaust is shut off holds its position.
 */
export function flowMultiplierToOpenExhaust(graph: FrameGraph, fromKey: PortKeyStr): number {
  if (!graph.wiredKeys.has(fromKey)) return 1;
  const queue: Array<{ key: PortKeyStr; mult: number }> = [{ key: fromKey, mult: 1 }];
  const visited = new Set<PortKeyStr>([fromKey]);
  let leafMult = Infinity;

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    const neighbors = graph.adjacency.get(cur.key);
    const unvisited = [...(neighbors?.keys() ?? [])].filter((k) => !visited.has(k));
    if (unvisited.length === 0) {
      if (!graph.wiredKeys.has(cur.key)) leafMult = Math.min(leafMult, cur.mult);
      continue;
    }
    for (const next of unvisited) {
      visited.add(next);
      queue.push({ key: next, mult: cur.mult * (neighbors?.get(next) ?? 1) });
    }
  }

  return leafMult === Infinity ? 0 : leafMult;
}

/**
 * Shortest hop-count from `fromKey` to the nearest currently-pressurized source, over the same
 * adjacency graph the pressure simulation itself uses. Returns Infinity if none is reachable.
 * Companion to `exhaustDepth` (same idea, outward from a venting port instead): together they
 * let a component whose own edge is undirected - conducts both ways, but by a different path
 * each way, e.g. the one-way flow control valve's check-valve path vs its throttle path - tell
 * which of its own two ports actually has the supply (or the open vent) behind it, something
 * `isPressurized`/`isExhausting` alone can't do since both ports of such an edge always read the
 * same boolean regardless of which side is actually upstream.
 */
export function sourceDistance(graph: FrameGraph, fromKey: PortKeyStr): number {
  if (graph.sourceKeys.has(fromKey) && graph.pressurized.has(fromKey)) return 0;

  const queue: Array<{ key: PortKeyStr; depth: number }> = [{ key: fromKey, depth: 0 }];
  const visited = new Set<PortKeyStr>([fromKey]);
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    // Backward walk (toward whatever has an edge *into* cur, not out of it) - see
    // `reverseAdjacency`'s own doc for why a directed edge (e.g. a plain check valve) makes this
    // different from just following `adjacency` again.
    for (const next of graph.reverseAdjacency.get(cur.key) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      if (graph.sourceKeys.has(next) && graph.pressurized.has(next)) return cur.depth + 1;
      queue.push({ key: next, depth: cur.depth + 1 });
    }
  }
  return Infinity;
}

/**
 * Shortest-hop path from `fromKey` to any currently-pressurized source, multiplying each edge's
 * flow multiplier along the way. Returns 0 if no pressurized source is reachable.
 */
export function flowMultiplierToNearestSource(graph: FrameGraph, fromKey: PortKeyStr): number {
  const queue: Array<{ key: PortKeyStr; mult: number }> = [{ key: fromKey, mult: 1 }];
  const visited = new Set<PortKeyStr>([fromKey]);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    if (graph.sourceKeys.has(cur.key) && graph.pressurized.has(cur.key)) return cur.mult;

    // This walk goes from the query port back toward a source, i.e. backwards relative to the
    // direction air actually flows - so it has to follow `reverseAdjacency` (who has an edge
    // *into* cur), not `adjacency` (who cur has an edge into). Using `adjacency` here would miss
    // any genuinely one-directional edge entirely once walking from its downstream side (e.g. a
    // plain check valve's `directed: true` IN->OUT edge has no OUT->IN entry to find at all),
    // silently reporting no source reachable - see `reverseAdjacency`'s own doc.
    for (const next of graph.reverseAdjacency.get(cur.key) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        // The multiplier that matters is the one for the real flow direction (next -> cur, since
        // next sits closer to the source), not some multiplier for the cur -> next direction -
        // those two can differ for an asymmetric-but-undirected edge like the one-way flow
        // control valve, which conducts both ways but only throttles one of them.
        const realMult = graph.adjacency.get(next)?.get(cur.key) ?? 1;
        queue.push({ key: next, mult: cur.mult * realMult });
      }
    }
  }

  return 0;
}
