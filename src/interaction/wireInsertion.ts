import type { Connection, Component, PortKey, WireGuide } from '../core/types';
import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { spawnComponent } from './spawn';
import { getComponentRotation, setComponentRotation } from './componentContextMenu';
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
import { GRID_SIZE, snap } from '../core/grid';
import {
  HYD_CHECK_TYPE,
  HYD_THROTTLE_TYPE,
  HYD_ONE_WAY_FC_TYPE,
  HYD_FLOW_CONTROL_TYPE,
} from '../components/hyd/valves';
import { HYD_FILTER_TYPE, HYD_FLOW_METER_TYPE } from '../components/hyd/supply';

/** Component types this can splice onto a wire: the inline two-port valves, the flow meter and the filter,
 * whose ports are named 'IN'/'OUT' and lie on one straight line (vertical, IN at the bottom,
 * when unrotated). */
const WIRE_INSERTABLE_TYPES = new Set<string>([
  HYD_CHECK_TYPE,
  HYD_THROTTLE_TYPE,
  HYD_ONE_WAY_FC_TYPE,
  HYD_FLOW_CONTROL_TYPE,
  HYD_FLOW_METER_TYPE,
  HYD_FILTER_TYPE,
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
 * Slides `comp` along the wire segment a-b so both of its ports `p` and `q` (on the segment's
 * line) lie within the segment - a drop near a bend would otherwise leave one port past the
 * corner, and the wire half kept from there would double back over the component. Returns false
 * when the segment is shorter than the component: its halves then have to route afresh.
 */
function fitAlongSegment(comp: Component, p: Point, q: Point, a: Point, b: Point): boolean {
  const horizontal = a.y === b.y;
  const along = (pt: Point): number => (horizontal ? pt.x : pt.y);
  const lo = Math.min(along(a), along(b));
  const hi = Math.max(along(a), along(b));
  const pLo = Math.min(along(p), along(q));
  const pHi = Math.max(along(p), along(q));
  const room = hi - lo - (pHi - pLo);
  if (room < 0) return false;
  const margin = room >= 2 * GRID_SIZE ? GRID_SIZE : 0;
  let shift = 0;
  if (pLo < lo + margin) shift = lo + margin - pLo;
  else if (pHi > hi - margin) shift = hi - margin - pHi;
  if (shift !== 0) {
    comp.setPos(horizontal ? comp.x + shift : comp.x, horizontal ? comp.y : comp.y + shift);
  }
  return true;
}

/** The kept guides of the two halves of a split wire - none (route afresh) if the component
 * didn't fit on the segment. */
function halfGuides(
  guides: WireGuide[],
  bestIdx: number,
  fits: boolean,
): [WireGuide[], WireGuide[]] {
  return fits ? [guides.slice(0, bestIdx), guides.slice(bestIdx)] : [[], []];
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
  const splitRaw = projectOntoSegment(worldPoint, hit.a, hit.b);
  const comp = spawnComponent(type, ctx, viewport, snap(splitRaw.x), snap(splitRaw.y));
  spliceInto(comp, hit, worldPoint, viewport, workspaceEl, rotation);
  return comp;
}

/**
 * A component already on the canvas, dragged onto a wire: spliced into it just as one dropped
 * from the library is (see trySpliceOntoWire) - if it's a wire-insertable type, has no wires of
 * its own yet, and sits close enough to one. Returns whether it was spliced. Without this it
 * would only lie on top of the wire, looking connected while the wire ran straight past it.
 */
export function trySpliceExisting(
  comp: Component,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): boolean {
  setWireInsertHighlight(null);
  if (!splicableExisting(comp)) return false;
  const at = { x: comp.x, y: comp.y };
  const hit = findNearestWireHit(viewport, workspaceEl, at);
  if (!hit) return false;
  // Turned by the user (R while dragging): kept if it runs along the wire.
  const rot = getComponentRotation(comp);
  spliceInto(comp, hit, at, viewport, workspaceEl, rot === 0 ? undefined : rot);
  return true;
}

/** Whether `comp` could be spliced into a wire it's dragged onto: a wire-insertable type with no
 * wires of its own. */
export function splicableExisting(comp: Component): boolean {
  return (
    isWireInsertableType(comp.type) &&
    !appState.connections.some((c) => c.from.id === comp.id || c.to.id === comp.id)
  );
}

/** Splices `comp` into the wire of `hit`, at the point nearest `worldPoint`. */
function spliceInto(
  comp: Component,
  hit: WireHit,
  worldPoint: Point,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
  rotation: number | undefined,
): void {
  const { conn, a, b, bestIdx, guides } = hit;

  const splitRaw = projectOntoSegment(worldPoint, a, b);
  const splitPoint = { x: snap(splitRaw.x), y: snap(splitRaw.y) };
  const horizontal = a.y === b.y;
  comp.setPos(splitPoint.x, splitPoint.y);

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
  let inPos = portGlobalPosition(viewport, workspaceEl, comp, 'IN');
  let outPos = portGlobalPosition(viewport, workspaceEl, comp, 'OUT');
  const fits = fitAlongSegment(comp, inPos, outPos, a, b);
  inPos = portGlobalPosition(viewport, workspaceEl, comp, 'IN');
  outPos = portGlobalPosition(viewport, workspaceEl, comp, 'OUT');
  const distToA = (p: Point): number => Math.hypot(p.x - a.x, p.y - a.y);
  const fromPort: PortKey = distToA(inPos) <= distToA(outPos) ? 'IN' : 'OUT';
  const toPort: PortKey = fromPort === 'IN' ? 'OUT' : 'IN';

  const { from: originalFrom, to: originalTo, stubStartLen, stubEndLen } = conn;
  const [firstGuides, secondGuides] = halfGuides(guides, bestIdx, fits);
  const join = fits ? 0 : null;

  removeConnection(conn.id);

  // Zeroed at the end that now meets the new component, same reasoning as
  // interaction/wireSplitting.ts's own junction split: that end sits exactly on the original
  // wire's own line, so a non-zero stub would only add a bend that wasn't there before.
  const firstConn = createConnection(originalFrom, { id: comp.id, port: fromPort });
  firstConn.guides = firstGuides;
  firstConn.stubStartLen = stubStartLen;
  firstConn.stubEndLen = join;
  redrawConnection(firstConn);

  const secondConn = createConnection({ id: comp.id, port: toPort }, originalTo);
  secondConn.guides = secondGuides;
  secondConn.stubStartLen = join;
  secondConn.stubEndLen = stubEndLen;
  redrawConnection(secondConn);
}
