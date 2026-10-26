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
import {
  HYD_CHECK_TYPE,
  HYD_THROTTLE_TYPE,
  HYD_ONE_WAY_FC_TYPE,
  HYD_FLOW_CONTROL_TYPE,
} from '../components/hyd/valves';
import { HYD_FLOW_METER_TYPE } from '../components/hyd/supply';

/** Component types this can splice onto a wire: the inline two-port valves and the flow meter,
 * whose ports are named 'IN'/'OUT' and lie on one straight line (vertical, IN at the bottom,
 * when unrotated). */
const WIRE_INSERTABLE_TYPES = new Set<string>([
  HYD_CHECK_TYPE,
  HYD_THROTTLE_TYPE,
  HYD_ONE_WAY_FC_TYPE,
  HYD_FLOW_CONTROL_TYPE,
  HYD_FLOW_METER_TYPE,
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

/**
 * If `type` is one of the wire-insertable types and `worldPoint` lands close enough to an
 * existing wire, creates it spliced into that wire instead of floating unconnected - the
 * original connection is replaced by two new ones (original-from -> new component's near port,
 * new component's far port -> original-to), each keeping its share of the original wire's exact
 * path, and the component is rotated to match the wire's own direction (horizontal or vertical)
 * so both ports land exactly on the original line with no added kink.
 *
 * `rotation`, when the user turned the component while dragging it (see libraryDrag.ts), is
 * kept if it runs along the wire - choosing which way round the component goes in; across the
 * wire it can't splice straight, so the usual orientation is used instead.
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
  rotation?: number,
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
  const [usual, reversed] = horizontal ? [90, 270] : [0, 180];
  setComponentRotation(comp, rotation === reversed ? reversed : usual);
  // Some of these symbols carry their through-line off their own centre (e.g. a one-way flow
  // control's bypass sits beside it) - shift so the IN-OUT line lies exactly on the wire.
  {
    const pIn = portGlobalPosition(viewport, workspaceEl, comp, 'IN');
    const pOut = portGlobalPosition(viewport, workspaceEl, comp, 'OUT');
    const midX = (pIn.x + pOut.x) / 2;
    const midY = (pIn.y + pOut.y) / 2;
    comp.setPos(comp.x + splitPoint.x - midX, comp.y + splitPoint.y - midY);
  }

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
