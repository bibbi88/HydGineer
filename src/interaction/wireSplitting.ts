import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { createJunction } from '../components/junction';
import {
  createConnection,
  redrawConnection,
  removeConnection,
  setWireClickInterceptor,
} from '../wires/connection';
import {
  computeConnectionAnchors,
  computeConnectionGeometry,
  worldPortAnchor,
} from '../geometry/connectionGeometry';
import {
  completeGuides,
  distPointToSegment,
  guideCorners,
  seedGuidesFromPoints,
  stubPoint,
  type Point,
  type PortAnchor,
} from '../geometry/routing';
import { WIRE_STUB } from '../sim/constants';
import { snap } from '../core/grid';
import { makeDraggable } from './drag';
import { wireUpPortLinking, getPendingPort } from './linking';
import { wireUpComponentContextMenu } from './componentContextMenu';

/** How far along the wire (world px) a drop may miss the point straight across from the port
 * the new wire starts at and still be pulled onto it, so the branch runs straight. */
const ALIGN_TOLERANCE = 40;

function clampToSegment(v: number, a: number, b: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), v));
}

function projectOntoSegment(p: Point, a: Point, b: Point): Point {
  if (a.y === b.y) {
    const x = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), p.x));
    return { x, y: a.y };
  }
  const y = Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), p.y));
  return { x: a.x, y };
}

/**
 * Where a junction dropped at `dropped` on the wire segment `a`-`b` should go so the new
 * branch from port `from` runs straight. If that port points across the segment and sits
 * opposite it within {@link ALIGN_TOLERANCE} of the drop, the junction moves to the point
 * exactly opposite the port; otherwise the drop stands. Without this, a drop that misses by a
 * grid step or two gives the branch a sideways jog it doesn't need.
 */
export function alignJunctionToPort(dropped: Point, a: Point, b: Point, from: PortAnchor): Point {
  const lineHorizontal = a.y === b.y;
  // The branch leaves the junction across the line, so the port has to point across it too.
  if (from.entryOrientation !== (lineHorizontal ? 'V' : 'H')) return dropped;
  const along = lineHorizontal ? from.pos.x : from.pos.y;
  const lo = lineHorizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
  const hi = lineHorizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
  const at = lineHorizontal ? dropped.x : dropped.y;
  if (along <= lo || along >= hi || Math.abs(along - at) > ALIGN_TOLERANCE) return dropped;
  return lineHorizontal ? { x: along, y: dropped.y } : { x: dropped.x, y: along };
}

/**
 * Wires up "click on a wire while linking" to split it into a junction at that point.
 *
 * Rather than deleting the wire and auto-routing two brand new ones (which could reshape the
 * whole connection into something unrecognizable), this splits the wire's own guide list at
 * the clicked segment: everything before the split becomes the first new wire's guides,
 * everything after becomes the second's, so both halves keep the exact path the original wire
 * already had, joined by a small junction dot right at the click point.
 */
export function initWireSplitting(
  compLayer: HTMLElement,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): void {
  setWireClickInterceptor((conn, clientX, clientY) => {
    const pending = getPendingPort();
    if (!pending) return false;

    const clickWorld = viewport.clientToWorld(clientX, clientY);
    const anchors = computeConnectionAnchors(viewport, workspaceEl, conn);
    if (!anchors) return false;
    const { fromAnchor, toAnchor } = anchors;

    // Ensure the wire has an editable guide list matching its current visual shape, so there's
    // something concrete to split - a still-auto-routed wire has none yet.
    if (conn.guides.length === 0) {
      const stubOut0 = stubPoint(fromAnchor, toAnchor.pos, conn.stubStartLen ?? WIRE_STUB);
      const stubIn0 = stubPoint(toAnchor, fromAnchor.pos, conn.stubEndLen ?? WIRE_STUB);
      const points = computeConnectionGeometry(viewport, workspaceEl, conn);
      conn.guides = seedGuidesFromPoints(points, stubOut0, stubIn0);
    }

    // Include the bend the renderer adds when the last guide doesn't line up with the end stub,
    // so the segments measured below are the ones actually drawn.
    conn.guides = completeGuides(
      fromAnchor,
      toAnchor,
      conn.guides,
      conn.stubStartLen,
      conn.stubEndLen,
    );
    const stubIn = stubPoint(toAnchor, fromAnchor.pos, conn.stubEndLen ?? WIRE_STUB);
    const corners = guideCorners(fromAnchor, toAnchor, conn.guides, conn.stubStartLen);
    const allPoints: Point[] = [...corners, stubIn];

    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < allPoints.length - 1; i++) {
      const a = allPoints[i] as Point;
      const b = allPoints[i + 1] as Point;
      const d = distPointToSegment(clickWorld, a, b);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) return false;

    const a = allPoints[bestIdx] as Point;
    const b = allPoints[bestIdx + 1] as Point;
    // Snapped like everything else placed on the canvas, but only along the line - the cross
    // axis stays exactly on the wire.
    const lineHorizontal = a.y === b.y;
    const projected = projectOntoSegment(clickWorld, a, b);
    const junctionPos = lineHorizontal
      ? { x: clampToSegment(snap(projected.x), a.x, b.x), y: projected.y }
      : { x: projected.x, y: clampToSegment(snap(projected.y), a.y, b.y) };
    // The junction's port faces *across* the line it sits on: the two halves of the split
    // line meet it with zero-length stubs (so its axis doesn't affect them), and the new
    // branch then leaves it at a right angle - a clean T rather than a wire that may set off
    // along the very line it's joining.
    const branchOrientation: 'H' | 'V' = lineHorizontal ? 'V' : 'H';

    // Line the junction up with the port the new wire starts from, if it's close, so the
    // branch runs straight over (see alignJunctionToPort).
    const pendingComp = appState.findComponent(pending.compId);
    const from = pendingComp && worldPortAnchor(viewport, workspaceEl, pendingComp, pending.port);
    if (from) Object.assign(junctionPos, alignJunctionToPort(junctionPos, a, b, from));

    const junction = createJunction(compLayer, junctionPos.x, junctionPos.y, branchOrientation);
    appState.addComponent(junction);
    makeDraggable(junction, viewport);
    wireUpPortLinking(junction);
    wireUpComponentContextMenu(junction);

    const { from: originalFrom, to: originalTo, stubStartLen, stubEndLen } = conn;
    const firstGuides = conn.guides.slice(0, bestIdx);
    const secondGuides = conn.guides.slice(bestIdx);

    removeConnection(conn.id);

    // The junction sits exactly on the original wire's own line, so the end of each split half
    // that meets it needs no stub of its own - a non-zero stub would launch off perpendicular
    // to the original line before the router even starts, adding a bend that wasn't there
    // before. Zeroing it collapses stubPoint() to the junction's own position, so each half
    // reproduces its share of the original path with nothing extra, whether that original line
    // was horizontal or vertical.
    const firstConn = createConnection(originalFrom, { id: junction.id, port: 'P' });
    firstConn.guides = firstGuides;
    firstConn.stubStartLen = stubStartLen;
    firstConn.stubEndLen = 0;
    redrawConnection(firstConn);

    const secondConn = createConnection({ id: junction.id, port: 'P' }, originalTo);
    secondConn.guides = secondGuides;
    secondConn.stubStartLen = 0;
    secondConn.stubEndLen = stubEndLen;
    redrawConnection(secondConn);

    // The third wire, from whichever port the drag started at to this new junction. It keeps a
    // normal stub at the junction end, which (with the junction's port facing across the line)
    // makes it leave the line at a right angle, on whichever side the other port is.
    const thirdConn = createConnection(
      { id: pending.compId, port: pending.port },
      { id: junction.id, port: 'P' },
    );
    redrawConnection(thirdConn);

    return true;
  });
}
