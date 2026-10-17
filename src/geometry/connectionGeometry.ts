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
      fromComp.type === JUNCTION_TYPE ? alignJunctionAnchor(fromAnchor, toAnchor) : fromAnchor,
    toAnchor: toComp.type === JUNCTION_TYPE ? alignJunctionAnchor(toAnchor, fromAnchor) : toAnchor,
  };
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
  const cached = cache.get(conn.id);
  if (
    cached &&
    cached.topologyVersion === appState.topologyVersion &&
    cached.fromX === fromAnchor.pos.x &&
    cached.fromY === fromAnchor.pos.y &&
    cached.toX === toAnchor.pos.x &&
    cached.toY === toAnchor.pos.y
  ) {
    lastRoute.set(conn.id, cached.points);
    return cached.points;
  }

  const otherWires: Point[][] = [];
  for (const other of appState.connections) {
    if (other.id === conn.id) continue;
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
    points,
  });

  return points;
}
