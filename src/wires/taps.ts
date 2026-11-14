import type { Component, Connection, ConnectionEndpoint } from '../core/types';
import { appState } from '../app/AppState';
import {
  isHostWire,
  JUNCTION_TYPE,
  readJunctionHost,
  type JunctionHost,
} from '../components/junction';
import { routeOf } from '../geometry/connectionGeometry';
import type { Point } from '../geometry/routing';

/**
 * Taps: a junction placed on a wire to branch off it, joined to it without cutting it in two
 * (see interaction/wireSplitting.ts). The junction remembers its host wire by the wire's two
 * ends (JunctionHost); the simulation counts the junction as part of that wire's line
 * (tapLinks), and the junction keeps to the wire when it's redrawn (placeTapsOn).
 */

/** Whether `p` lies on the orthogonal polyline `route` (within `tol`); the point on it if so. */
function nearestOnRoute(
  route: Point[],
  p: Point,
): { point: Point; dist: number; horizontal: boolean } | null {
  let best: { point: Point; dist: number; horizontal: boolean } | null = null;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const horizontal = a.y === b.y;
    const point = horizontal
      ? { x: Math.min(Math.max(p.x, Math.min(a.x, b.x)), Math.max(a.x, b.x)), y: a.y }
      : { x: a.x, y: Math.min(Math.max(p.y, Math.min(a.y, b.y)), Math.max(a.y, b.y)) };
    const dist = Math.hypot(point.x - p.x, point.y - p.y);
    if (!best || dist < best.dist) best = { point, dist, horizontal };
  }
  return best;
}

const isJunctionEnd = (conn: Connection, junction: Component): boolean =>
  conn.from.id === junction.id || conn.to.id === junction.id;

/**
 * The wire `junction` taps, if it's a tap: the one its host names - or, if that wire is gone
 * (split by a valve dropped onto it, say), whichever wire now runs through the junction, which
 * then becomes its host.
 */
export function hostWireOf(junction: Component): Connection | null {
  if (junction.type !== JUNCTION_TYPE) return null;
  const snap = junction.snapshot();
  const host = readJunctionHost(snap);
  if (!host) return null;
  const named = appState.connections.find((c) => isHostWire(host, c));
  if (named) return named;
  const at = { x: junction.x, y: junction.y };
  for (const conn of appState.connections) {
    if (isJunctionEnd(conn, junction)) continue;
    const route = routeOf(conn.id);
    const near = route && nearestOnRoute(route, at);
    if (near && near.dist < 1) {
      const rehost: JunctionHost = { from: conn.from, to: conn.to };
      junction.restore({ ...snap, host: rehost });
      return conn;
    }
  }
  return null;
}

/** Every junction tapping `conn`. */
export function tapsOn(conn: Connection): Component[] {
  return appState.components.filter((c) => {
    if (c.type !== JUNCTION_TYPE) return false;
    const host = readJunctionHost(c.snapshot());
    return host !== null && isHostWire(host, conn);
  });
}

/** For the simulation: each tap's junction joined to one end of the wire it taps, so it's part
 * of that wire's line. */
export function tapLinks(): Array<[ConnectionEndpoint, ConnectionEndpoint]> {
  const links: Array<[ConnectionEndpoint, ConnectionEndpoint]> = [];
  for (const c of appState.components) {
    const host = hostWireOf(c);
    if (host) links.push([{ id: c.id, port: 'P' }, host.from]);
  }
  return links;
}

/**
 * Puts each junction tapping `conn` back onto its route - the nearest point of it - with its
 * branch leaving across the line there. Returns the junctions that moved, whose own wires need
 * redrawing.
 */
export function placeTapsOn(conn: Connection): Component[] {
  const route = routeOf(conn.id);
  if (!route || route.length < 2) return [];
  const moved: Component[] = [];
  for (const junction of tapsOn(conn)) {
    const near = nearestOnRoute(route, { x: junction.x, y: junction.y });
    if (!near) continue;
    const orientation = near.horizontal ? 'V' : 'H';
    const port = junction.ports.P;
    const turned = port && port.entryOrientation !== orientation;
    if (port) port.entryOrientation = orientation;
    if (near.dist > 0.01) {
      junction.setPos(near.point.x, near.point.y);
      moved.push(junction);
    } else if (turned) {
      moved.push(junction);
    }
  }
  return moved;
}
