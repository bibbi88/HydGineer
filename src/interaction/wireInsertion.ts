import type { Connection, Component, PortKey, WireGuide } from '../core/types';
import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { spawnComponent } from './spawn';
import { setComponentRotation } from './componentContextMenu';
import { createConnection, redrawConnection, removeConnection } from '../wires/connection';
import {
  computeConnectionAnchors,
  computeConnectionGeometry,
} from '../geometry/connectionGeometry';
import {
  completeGuides,
  distPointToSegment,
  guideCorners,
  seedGuidesFromPoints,
  stubPoint,
  type Point,
} from '../geometry/routing';
import { portGlobalPosition } from '../geometry/coords';
import { WIRE_STUB } from '../sim/constants';
import { snap } from '../core/grid';
import { CHECK_VALVE_TYPE } from '../components/checkValve';
import { QUICK_EXHAUST_VALVE_TYPE } from '../components/quickExhaustValve';
import { CYLINDER_SINGLE_TYPE } from '../components/cylinderSingle';
import { CYLINDER_DOUBLE_TYPE } from '../components/cylinderDouble';
import { THROTTLE_VALVE_TYPE } from '../components/throttleValve';
import { PRESSURE_REDUCING_VALVE_TYPE } from '../components/pressureReducingValve';
import { ONE_WAY_FLOW_CONTROL_VALVE_TYPE } from '../components/oneWayFlowControlValve';
import { SOURCE_TYPE } from '../components/source';
import { LIMIT_VALVE_32_TYPE } from '../components/limitValve32';
import { PUSH_BUTTON_32_TYPE } from '../components/pushButton32';
import { AIR_VALVE_32_TYPE } from '../components/airValve32';
import { TIME_DELAY_VALVE_TYPE } from '../components/timeDelayValve';

/** The 3/2 valve family (shared/slidingValve32.ts): ports 1 (supply) and 2 (outlet) sit on one
 * vertical line, 2 above 1, but off the component's own center - port 3 (exhaust) and any pilot
 * port stay free. Spliced by spliceThreeTwo. */
const THREE_TWO_TYPES = new Set<string>([
  LIMIT_VALVE_32_TYPE,
  PUSH_BUTTON_32_TYPE,
  AIR_VALVE_32_TYPE,
  TIME_DELAY_VALVE_TYPE,
]);

/** Component types this can splice onto a wire. Most have exactly two ports, named 'IN'/'OUT',
 * that read as a single straight pass-through line when unrotated (vertical, IN at the bottom) -
 * see checkValve.ts/throttleValve.ts/oneWayFlowControlValve.ts. The quick exhaust valve (ports
 * 1/2 aren't collinear, port 3 stays free) and the 3/2 valves (1/2 collinear but off-center, and
 * which way round they go matters) have their own paths, see spliceQuickExhaust and
 * spliceThreeTwo. Other multi-port components (AND/OR valves, 5/2 valves) are still ordinary
 * unconnected drops. */
const WIRE_INSERTABLE_TYPES = new Set<string>([
  QUICK_EXHAUST_VALVE_TYPE,
  CHECK_VALVE_TYPE,
  THROTTLE_VALVE_TYPE,
  ONE_WAY_FLOW_CONTROL_VALVE_TYPE,
  PRESSURE_REDUCING_VALVE_TYPE,
  ...THREE_TWO_TYPES,
]);

/** How close a drop point needs to land to a wire to splice into it, rather than just landing
 * unconnected on top of it - matches wires/connection.ts's own addBendAtWorldPoint threshold for
 * "close enough to this wire" (double-click-to-bend uses the same distance). */
const HIT_THRESHOLD = 60;

export function isWireInsertableType(type: string): boolean {
  return WIRE_INSERTABLE_TYPES.has(type);
}

let highlightedConn: Connection | null = null;

/** Marks (or clears) which wire currently reads as "drop here to splice in" - toggles a CSS
 * class rather than touching color/width directly so the look stays in app.css alongside every
 * other wire state (.wire.active, .wire.selected, etc.). Safe to call with the same connection
 * repeatedly (a dragover fires continuously) or with the one already highlighted removed. */
export function setWireInsertHighlight(conn: Connection | null): void {
  if (conn === highlightedConn) return;
  if (highlightedConn) {
    highlightedConn.pathEl.classList.remove('wireInsertTarget');
    highlightedConn.hitEl.classList.remove('wireInsertTarget');
  }
  highlightedConn = conn;
  if (conn) {
    conn.pathEl.classList.add('wireInsertTarget');
    conn.hitEl.classList.add('wireInsertTarget');
  }
}

function projectOntoSegment(p: Point, a: Point, b: Point): Point {
  if (a.y === b.y) {
    const x = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), p.x));
    return { x, y: a.y };
  }
  const y = Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), p.y));
  return { x: a.x, y };
}

/** The connection's rendered polyline (corners + final stub-in point) plus the guide list that
 * produced it - seeded from its current auto-routed shape first if it doesn't have one of its
 * own yet, same as wires/connection.ts's addBendAtWorldPoint and interaction/wireSplitting.ts
 * both already do before splitting a wire at a clicked point. */
function connectionPolyline(
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
  conn: Connection,
): { points: Point[]; guides: WireGuide[] } | null {
  const anchors = computeConnectionAnchors(viewport, workspaceEl, conn);
  if (!anchors) return null;
  const { fromAnchor, toAnchor } = anchors;
  const stubIn = stubPoint(toAnchor, fromAnchor.pos, conn.stubEndLen ?? WIRE_STUB);

  let guides = conn.guides;
  if (guides.length === 0) {
    const stubOut0 = stubPoint(fromAnchor, toAnchor.pos, conn.stubStartLen ?? WIRE_STUB);
    const points = computeConnectionGeometry(viewport, workspaceEl, conn);
    guides = seedGuidesFromPoints(points, stubOut0, stubIn);
  }
  // Including the bend the renderer adds when the last guide doesn't line up with the end
  // stub - otherwise the last segment here is a diagonal that isn't on screen.
  guides = completeGuides(fromAnchor, toAnchor, guides, conn.stubStartLen, conn.stubEndLen);

  const corners = guideCorners(fromAnchor, toAnchor, guides, conn.stubStartLen);
  return { points: [...corners, stubIn], guides };
}

interface WireHit {
  conn: Connection;
  a: Point;
  b: Point;
  bestIdx: number;
  guides: WireGuide[];
}

/** The nearest wire to `worldPoint` across every connection, within HIT_THRESHOLD - `a`/`b` are
 * the two ends of whichever segment of it was closest, in from->to order (segment index
 * `bestIdx` within `guides`, the same indexing wires/connection.ts's own bend-splitting uses).
 * Exported so a live drag (main.ts's dragover handler) can preview the same target this would
 * actually splice into, via setWireInsertHighlight, before the user lets go. */
export function findNearestWireHit(
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
  worldPoint: Point,
): WireHit | null {
  let best: WireHit | null = null;
  let bestDist = HIT_THRESHOLD;

  for (const conn of appState.connections) {
    const poly = connectionPolyline(viewport, workspaceEl, conn);
    if (!poly) continue;
    const { points, guides } = poly;

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i] as Point;
      const b = points[i + 1] as Point;
      const d = distPointToSegment(worldPoint, a, b);
      if (d < bestDist) {
        bestDist = d;
        best = { conn, a, b, bestIdx: i, guides };
      }
    }
  }

  return best;
}

function isCylinder(id: number): boolean {
  const t = appState.findComponent(id)?.type;
  return t === CYLINDER_SINGLE_TYPE || t === CYLINDER_DOUBLE_TYPE;
}

/**
 * Splices a quick exhaust valve in: port 1 (supply inlet) takes the wire half on one side, port
 * 2 (outlet) the other, port 3 (exhaust) is left free. Unlike the plain pass-through valves its
 * ports aren't collinear, so it can't avoid a bend: it's kept unrotated (as the library shows
 * it), port 1 is placed on the wire line at the drop point, and the port-2 half auto-routes. Port 2 goes to whichever end is a cylinder (the valve belongs at the cylinder),
 * defaulting to the wire's "to" end.
 */
function spliceQuickExhaust(
  comp: Component,
  hit: WireHit,
  splitPoint: Point,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): void {
  const { conn, bestIdx, guides } = hit;
  const outletOnTo = !(isCylinder(conn.from.id) && !isCylinder(conn.to.id));

  // Port 1 sits exactly on the wire line at the drop point.
  const p1 = portGlobalPosition(viewport, workspaceEl, comp, '1');
  comp.setPos(comp.x + splitPoint.x - p1.x, comp.y + splitPoint.y - p1.y);

  const { from: originalFrom, to: originalTo, stubStartLen, stubEndLen } = conn;
  const firstGuides = guides.slice(0, bestIdx);
  const secondGuides = guides.slice(bestIdx);
  removeConnection(conn.id);

  if (outletOnTo) {
    // from -> port 1 keeps its exact path; port 2 -> to auto-routes.
    const first = createConnection(originalFrom, { id: comp.id, port: '1' });
    first.guides = firstGuides;
    first.stubStartLen = stubStartLen;
    first.stubEndLen = 0;
    redrawConnection(first);
    const second = createConnection({ id: comp.id, port: '2' }, originalTo);
    second.stubEndLen = stubEndLen;
    redrawConnection(second);
  } else {
    const first = createConnection(originalFrom, { id: comp.id, port: '2' });
    first.stubStartLen = stubStartLen;
    redrawConnection(first);
    const second = createConnection({ id: comp.id, port: '1' }, originalTo);
    second.guides = secondGuides;
    second.stubStartLen = 0;
    second.stubEndLen = stubEndLen;
    redrawConnection(second);
  }
}

/** Whether the wire's "from" end is its supply side: a pressure source at either end decides it,
 * then a cylinder (always a consumer) at either end, and otherwise the wire's own drawing
 * direction - wires are most often drawn from the supply outward. */
function supplyIsOnFrom(conn: Connection): boolean {
  const fromType = appState.findComponent(conn.from.id)?.type;
  const toType = appState.findComponent(conn.to.id)?.type;
  if (fromType === SOURCE_TYPE) return true;
  if (toType === SOURCE_TYPE) return false;
  if (isCylinder(conn.from.id) && !isCylinder(conn.to.id)) return false;
  return true;
}

/**
 * Splices a 3/2 valve in: port 1 (supply) takes the wire half on the supply side, port 2
 * (outlet) the other half, and port 3 / any pilot port are left free. Rotated to the wire's own
 * direction, picking whichever of the two rotations along it puts port 1 toward the supply, and
 * shifted so port 1 sits exactly on the wire at the drop point - port 2 then lands on the same
 * line, since the two are collinear. The supply half keeps its exact path; the outlet half
 * auto-routes from port 2 (which sits a valve-length further along than the drop point).
 */
function spliceThreeTwo(
  comp: Component,
  hit: WireHit,
  splitPoint: Point,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): void {
  const { conn, a, b, bestIdx, guides } = hit;
  const supplyOnFrom = supplyIsOnFrom(conn);
  const supplyEnd = supplyOnFrom ? a : b;
  const dist = (p: Point, q: Point): number => Math.hypot(p.x - q.x, p.y - q.y);

  const placeAt = (rot: number): void => {
    setComponentRotation(comp, rot);
    const p1 = portGlobalPosition(viewport, workspaceEl, comp, '1');
    comp.setPos(comp.x + splitPoint.x - p1.x, comp.y + splitPoint.y - p1.y);
  };
  const [first, second] = a.y === b.y ? [90, 270] : [0, 180];
  placeAt(first);
  const p2 = portGlobalPosition(viewport, workspaceEl, comp, '2');
  // Port 1 is at the split point, so port 2 should be the one farther from the supply end.
  if (dist(p2, supplyEnd) < dist(splitPoint, supplyEnd)) placeAt(second);

  const { from: originalFrom, to: originalTo, stubStartLen, stubEndLen } = conn;
  removeConnection(conn.id);

  if (supplyOnFrom) {
    const supplyConn = createConnection(originalFrom, { id: comp.id, port: '1' });
    supplyConn.guides = guides.slice(0, bestIdx);
    supplyConn.stubStartLen = stubStartLen;
    supplyConn.stubEndLen = 0;
    redrawConnection(supplyConn);
    const outletConn = createConnection({ id: comp.id, port: '2' }, originalTo);
    outletConn.stubEndLen = stubEndLen;
    redrawConnection(outletConn);
  } else {
    const outletConn = createConnection(originalFrom, { id: comp.id, port: '2' });
    outletConn.stubStartLen = stubStartLen;
    redrawConnection(outletConn);
    const supplyConn = createConnection({ id: comp.id, port: '1' }, originalTo);
    supplyConn.guides = guides.slice(bestIdx);
    supplyConn.stubStartLen = 0;
    supplyConn.stubEndLen = stubEndLen;
    redrawConnection(supplyConn);
  }
}

/**
 * If `type` is one of the wire-insertable types and `worldPoint` lands close enough to an
 * existing wire, creates it spliced into that wire instead of floating unconnected - the
 * original connection is replaced by two new ones (original-from -> new component's near port,
 * new component's far port -> original-to), each keeping its share of the original wire's exact
 * path, and the component is rotated to match the wire's own direction (horizontal or vertical)
 * so both ports land exactly on the original line with no added kink.
 *
 * Returns the new component, or null if nothing was spliced (wrong type, or nothing close
 * enough) - callers should fall back to a normal unconnected placement in that case.
 */
export function trySpliceOntoWire(
  type: string,
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
  worldPoint: Point,
): Component | null {
  setWireInsertHighlight(null);
  if (!isWireInsertableType(type)) return null;

  const hit = findNearestWireHit(viewport, workspaceEl, worldPoint);
  if (!hit) return null;
  const { conn, a, b, bestIdx, guides } = hit;

  const splitRaw = projectOntoSegment(worldPoint, a, b);
  const splitPoint = { x: snap(splitRaw.x), y: snap(splitRaw.y) };
  const horizontal = a.y === b.y;

  const comp = spawnComponent(type, ctx, viewport, splitPoint.x, splitPoint.y);
  if (type === QUICK_EXHAUST_VALVE_TYPE) {
    spliceQuickExhaust(comp, hit, splitPoint, viewport, workspaceEl);
    return comp;
  }
  if (THREE_TWO_TYPES.has(type)) {
    spliceThreeTwo(comp, hit, splitPoint, viewport, workspaceEl);
    return comp;
  }
  if (horizontal) setComponentRotation(comp, 90);

  // Which physical port (IN or OUT) actually ended up on `a`'s side (the original wire's "from"
  // side) depends on the rotation just applied - rather than re-deriving that by hand, measure
  // where each port really landed and pick whichever is closer to `a`.
  const inPos = portGlobalPosition(viewport, workspaceEl, comp, 'IN');
  const outPos = portGlobalPosition(viewport, workspaceEl, comp, 'OUT');
  const distToA = (p: Point): number => Math.hypot(p.x - a.x, p.y - a.y);
  const fromPort: PortKey = distToA(inPos) <= distToA(outPos) ? 'IN' : 'OUT';
  const toPort: PortKey = fromPort === 'IN' ? 'OUT' : 'IN';

  const { from: originalFrom, to: originalTo, stubStartLen, stubEndLen } = conn;
  const firstGuides = guides.slice(0, bestIdx);
  const secondGuides = guides.slice(bestIdx);

  removeConnection(conn.id);

  // Zeroed at the end that now meets the new component, same reasoning as
  // interaction/wireSplitting.ts's own junction split: that end sits exactly on the original
  // wire's own line, so a non-zero stub would only add a bend that wasn't there before.
  const firstConn = createConnection(originalFrom, { id: comp.id, port: fromPort });
  firstConn.guides = firstGuides;
  firstConn.stubStartLen = stubStartLen;
  firstConn.stubEndLen = 0;
  redrawConnection(firstConn);

  const secondConn = createConnection({ id: comp.id, port: toPort }, originalTo);
  secondConn.guides = secondGuides;
  secondConn.stubStartLen = 0;
  secondConn.stubEndLen = stubEndLen;
  redrawConnection(secondConn);

  return comp;
}
