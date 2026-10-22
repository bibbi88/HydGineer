import type { Component, Connection, ComponentId, PortKey } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { componentRotation, portGlobalPosition, rotateQuarter } from './coords';
import { routeWithGuides, type Point, type PortAnchor } from './routing';
import { autoRouteAStar } from './autoRoute';
import { JUNCTION_TYPE } from '../components/junction';

interface CacheEntry {
  topologyVersion: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Which way each end leaves - a junction's can change without either end moving. */
  sides: string;
  points: Point[];
}

const cache = new Map<ComponentId, CacheEntry>();

/** Each connection's most recently computed polyline, whichever way it was routed - what the
 * auto-router steers new wires away from running along. Entries for deleted connections are
 * simply never looked up again (only ids still in appState.connections are read). */
const lastRoute = new Map<ComponentId, Point[]>();

/**
 * A port's wire anchor in world space: its position, the axis its wire leaves along, and which
 * way along that axis.
 *
 * A port's own `entryOrientation`/`pilotDir` describe the component's unrotated artwork, so
 * they're turned here to match the component's current rotation and mirroring - otherwise a
 * rotated valve's wires would leave sideways along (or straight into) its body.
 *
 * The exit direction is fixed to point *out of* the component (away from its center along the
 * exit axis): a wire leaving the top port of a valve goes up first and then around, never down
 * through the valve, even when the other end is below. A port sitting at the component's own
 * center along that axis (a junction dot) has no "outward", so it keeps the default of heading
 * toward whatever the wire connects to.
 */
export function worldPortAnchor(
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
  comp: Component,
  portKey: PortKey,
): PortAnchor | null {
  const port = comp.ports[portKey];
  if (!port) return null;
  const pos = portGlobalPosition(viewport, workspaceEl, comp, portKey);
  const rot = componentRotation(comp);
  const quarterTurned = rot === 90 || rot === 270;
  const entryOrientation: 'H' | 'V' = quarterTurned
    ? port.entryOrientation === 'H'
      ? 'V'
      : 'H'
    : port.entryOrientation;

  let exitDir: 1 | -1 | undefined;
  if (port.pilotDir) {
    let vx = port.entryOrientation === 'H' ? port.pilotDir : 0;
    const vy = port.entryOrientation === 'V' ? port.pilotDir : 0;
    if (comp.el.dataset.mirror === '1') vx = -vx;
    const [wx, wy] = rotateQuarter(vx, vy, rot);
    exitDir = (entryOrientation === 'H' ? wx : wy) > 0 ? 1 : -1;
  } else {
    const b = comp.getBounds();
    const offset = entryOrientation === 'H' ? pos.x - (b.x + b.w / 2) : pos.y - (b.y + b.h / 2);
    if (Math.abs(offset) >= 1) exitDir = offset > 0 ? 1 : -1;
  }

  return { pos, entryOrientation, pilotDir: exitDir };
}

export function computeConnectionAnchors(
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
  conn: Connection,
): { fromAnchor: PortAnchor; toAnchor: PortAnchor } | null {
  const fromComp = appState.findComponent(conn.from.id);
  const toComp = appState.findComponent(conn.to.id);
  if (!fromComp || !toComp) return null;

  const fromAnchor = worldPortAnchor(viewport, workspaceEl, fromComp, conn.from.port);
  const toAnchor = worldPortAnchor(viewport, workspaceEl, toComp, conn.to.port);
  if (!fromAnchor || !toAnchor) return null;
  return {
    fromAnchor:
      fromComp.type === JUNCTION_TYPE
        ? junctionAnchor(viewport, workspaceEl, fromComp, conn, fromAnchor, toAnchor)
        : fromAnchor,
    toAnchor:
      toComp.type === JUNCTION_TYPE
        ? junctionAnchor(viewport, workspaceEl, toComp, conn, toAnchor, fromAnchor)
        : toAnchor,
  };
}

/** One of a junction dot's four sides: the axis a wire leaves along, and which way. */
interface Side {
  axis: 'H' | 'V';
  dir: 1 | -1;
}

function sameSide(a: Side, b: Side): boolean {
  return a.axis === b.axis && a.dir === b.dir;
}

function sign(v: number): 1 | -1 {
  return v < 0 ? -1 : 1;
}

/** The side a wire whose route is already pinned down uses - read off the route it is actually
 * drawn with (its guides and stubs), not guessed from where its other end is: a split line's
 * half leaves the dot along the line it was split from, wherever its far end lies. These are
 * settled first; free-routed wires then fit round them. */
function pinnedSide(
  junction: PortAnchor,
  other: PortAnchor,
  otherIsJunction: boolean,
  conn: Connection,
  atFrom: boolean,
): Side {
  const j = alignJunctionAnchor(junction, other);
  const o = otherIsJunction ? alignJunctionAnchor(other, junction) : other;
  const route = atFrom
    ? routeWithGuides(j, o, conn.guides, conn.stubStartLen, conn.stubEndLen)
    : routeWithGuides(o, j, conn.guides, conn.stubStartLen, conn.stubEndLen).reverse();
  const start = route[0] ?? junction.pos;
  for (const p of route.slice(1)) {
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (Math.abs(dx) >= 0.5) return { axis: 'H', dir: sign(dx) };
    if (Math.abs(dy) >= 0.5) return { axis: 'V', dir: sign(dy) };
  }
  return { axis: j.entryOrientation, dir: 1 };
}

/** Whether a wire's route at the dot is already settled: it's drawn through guides or with a
 * set stub length (a split line's halves, a dragged wire), or it lines up with the dot. */
function isPinned(junction: PortAnchor, other: PortAnchor, conn: Connection): boolean {
  if (conn.guides.length > 0 || conn.stubStartLen !== null || conn.stubEndLen !== null) {
    return true;
  }
  const sameRow = Math.abs(junction.pos.y - other.pos.y) < 0.5;
  const sameColumn = Math.abs(junction.pos.x - other.pos.x) < 0.5;
  return sameRow !== sameColumn;
}

/** The side facing `other` best that no wire already uses - or, if every free side faces away
 * from it, the best-facing side even though another free-routed wire shares it (two wires of the
 * same net running into the dot together read as one; a detour round the dot does not). A side
 * held by a pinned wire is never shared. */
function chooseSide(junction: PortAnchor, other: PortAnchor, pinned: Side[], used: Side[]): Side {
  const dx = other.pos.x - junction.pos.x;
  const dy = other.pos.y - junction.pos.y;
  const sides: Side[] = [
    { axis: 'H', dir: 1 },
    { axis: 'H', dir: -1 },
    { axis: 'V', dir: 1 },
    { axis: 'V', dir: -1 },
  ];
  const facing = (s: Side): number => (s.axis === 'H' ? dx : dy) * s.dir;
  // Ties go to the junction's own axis - set across the line it was dropped on.
  const ranked = sides
    .filter((s) => !pinned.some((p) => sameSide(p, s)))
    .sort(
      (a, b) =>
        facing(b) - facing(a) ||
        (a.axis === junction.entryOrientation ? -1 : 0) -
          (b.axis === junction.entryOrientation ? -1 : 0),
    );
  const free = ranked.find((s) => !used.some((u) => sameSide(u, s)) && facing(s) > 0);
  return free ?? ranked[0] ?? { axis: junction.entryOrientation, dir: sign(dy) };
}

/**
 * Which side of a junction dot `conn` leaves from. Wires whose route is pinned down (lined up
 * with the dot, or drawn through guides) keep `alignJunctionAnchor`'s answer. Every other wire at
 * the dot gets its own side, facing its other end, out of the ones left over - so a wire never
 * has to approach along a side another wire already occupies and detour round the dot to avoid
 * running on top of it. Decided for all the dot's wires together, in connection order, from
 * endpoint positions alone, so the answer doesn't depend on which wire happened to be redrawn
 * first.
 */
function junctionAnchor(
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
  junction: Component,
  conn: Connection,
  anchor: PortAnchor,
  other: PortAnchor,
): PortAnchor {
  if (isPinned(anchor, other, conn)) return alignJunctionAnchor(anchor, other);

  const pinned: Side[] = [];
  const free: Array<{ conn: Connection; other: PortAnchor }> = [];
  for (const c of appState.connections) {
    const atFrom = c.from.id === junction.id;
    if (!atFrom && c.to.id !== junction.id) continue;
    const end = atFrom ? c.to : c.from;
    const otherComp = appState.findComponent(end.id);
    const otherAnchor = otherComp && worldPortAnchor(viewport, workspaceEl, otherComp, end.port);
    if (!otherAnchor) continue;
    if (isPinned(anchor, otherAnchor, c)) {
      const otherIsJunction = otherComp.type === JUNCTION_TYPE;
      pinned.push(pinnedSide(anchor, otherAnchor, otherIsJunction, c, atFrom));
    } else free.push({ conn: c, other: otherAnchor });
  }

  const used: Side[] = [];
  for (const f of free) {
    const side = chooseSide(anchor, f.other, pinned, used);
    if (f.conn.id === conn.id)
      return { ...anchor, entryOrientation: side.axis, pilotDir: side.dir };
    used.push(side);
  }
  return alignJunctionAnchor(anchor, other);
}

/**
 * A junction dot's port axis is only a default - set across the line it was dropped on, so a
 * branch made there leaves at a right angle. A wire whose other end lies dead level with the
 * dot (or dead in line above/below it) enters along that line instead; held to the default
 * axis, a supply wired straight across to a junction on a vertical branch would jog down and
 * back up to meet it from below.
 */
export function alignJunctionAnchor(junction: PortAnchor, other: PortAnchor): PortAnchor {
  const sameRow = Math.abs(junction.pos.y - other.pos.y) < 0.5;
  const sameColumn = Math.abs(junction.pos.x - other.pos.x) < 0.5;
  if (sameRow === sameColumn) return junction;
  const entryOrientation = sameRow ? 'H' : 'V';
  return entryOrientation === junction.entryOrientation
    ? junction
    : { ...junction, entryOrientation };
}

export function computeConnectionGeometry(
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
  conn: Connection,
): Point[] {
  const anchors = computeConnectionAnchors(viewport, workspaceEl, conn);
  if (!anchors) return [];
  const { fromAnchor, toAnchor } = anchors;

  // A connection has "explicit" geometry - and should be drawn exactly via its guides/stub
  // lengths rather than re-auto-routed - once anything has deliberately set one of those
  // fields, even to a value (like an empty guide list, or a zero stub) that matches what A*
  // might have produced anyway. guides.length > 0 alone isn't enough: wire-splitting can
  // deliberately produce a connection with zero guides (a straight run with no bends) that
  // still must not fall through to A*, which only guarantees a *shortest* path, not the exact
  // straight line the split was preserving - so a non-null stub length (only ever set by
  // deliberate editing, never left as A*'s implicit default) is treated as the same signal.
  if (conn.guides.length > 0 || conn.stubStartLen !== null || conn.stubEndLen !== null) {
    const guided = routeWithGuides(
      fromAnchor,
      toAnchor,
      conn.guides,
      conn.stubStartLen,
      conn.stubEndLen,
    );
    lastRoute.set(conn.id, guided);
    return guided;
  }

  // The A* route only depends on endpoint positions and topology (which components exist/where) -
  // skip re-running it if neither has changed since the last redraw of this connection.
  const sides = `${fromAnchor.entryOrientation}${fromAnchor.pilotDir ?? 0}${toAnchor.entryOrientation}${toAnchor.pilotDir ?? 0}`;
  const cached = cache.get(conn.id);
  if (
    cached &&
    cached.sides === sides &&
    cached.topologyVersion === appState.topologyVersion &&
    cached.fromX === fromAnchor.pos.x &&
    cached.fromY === fromAnchor.pos.y &&
    cached.toX === toAnchor.pos.x &&
    cached.toY === toAnchor.pos.y
  ) {
    lastRoute.set(conn.id, cached.points);
    return cached.points;
  }

  // Wires entering the same junction from the same side are one net running together into the
  // dot - how a shared return is drawn - so they're not steered apart the way unrelated wires
  // are. Wires on other sides of the dot are, so a branch doesn't hug the line it branches off.
  const sideAt = (c: Connection, junctionId: ComponentId): string | null => {
    const a = c === conn ? anchors : computeConnectionAnchors(viewport, workspaceEl, c);
    if (!a) return null;
    const end = c.from.id === junctionId ? a.fromAnchor : a.toAnchor;
    return `${end.entryOrientation}${end.pilotDir ?? 0}`;
  };
  const sharedRun = (other: Connection): boolean => {
    for (const end of [conn.from, conn.to]) {
      if (appState.findComponent(end.id)?.type !== JUNCTION_TYPE) continue;
      if (other.from.id !== end.id && other.to.id !== end.id) continue;
      const mine = sideAt(conn, end.id);
      if (mine !== null && mine === sideAt(other, end.id)) return true;
    }
    return false;
  };
  const otherWires: Point[][] = [];
  for (const other of appState.connections) {
    if (other.id === conn.id) continue;
    if (sharedRun(other)) continue;
    const route = lastRoute.get(other.id);
    if (route) otherWires.push(route);
  }

  // The wire's own two components are obstacles too: every wire now leaves its port outward
  // (see worldPortAnchor), so there's no need to let the route cut back through the very
  // component it starts or ends at - which is exactly what it used to do when the other end
  // was on the far side of it.
  const excludeIds = new Set<ComponentId>();
  const points = autoRouteAStar(
    fromAnchor,
    toAnchor,
    appState.components,
    excludeIds,
    conn.stubStartLen,
    conn.stubEndLen,
    otherWires,
  );
  lastRoute.set(conn.id, points);

  cache.set(conn.id, {
    topologyVersion: appState.topologyVersion,
    fromX: fromAnchor.pos.x,
    fromY: fromAnchor.pos.y,
    toX: toAnchor.pos.x,
    toY: toAnchor.pos.y,
    sides,
    points,
  });

  return points;
}
