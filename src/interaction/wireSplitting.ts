import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { createJunction } from '../components/junction';
import { createConnection, redrawConnection, setWireClickInterceptor } from '../wires/connection';
import { computeConnectionGeometry, worldPortAnchor } from '../geometry/connectionGeometry';
import { distPointToSegment, type Point, type PortAnchor } from '../geometry/routing';
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
 * Wires up "release a new wire on an existing one" to join it there: a junction dot is put on
 * the existing wire at that point - a tap (see wires/taps.ts) - and the new wire ends on it. The
 * existing wire isn't cut in two: it stays one wire, keeping its shape, with the junction riding
 * on it, and the simulation counts the junction as part of its line.
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
    const points = computeConnectionGeometry(viewport, workspaceEl, conn);
    if (points.length < 2) return false;

    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      const d = distPointToSegment(clickWorld, points[i] as Point, points[i + 1] as Point);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) return false;

    const a = points[bestIdx] as Point;
    const b = points[bestIdx + 1] as Point;
    // Snapped like everything else placed on the canvas, but only along the line - the cross
    // axis stays exactly on the wire.
    const lineHorizontal = a.y === b.y;
    const projected = projectOntoSegment(clickWorld, a, b);
    const junctionPos = lineHorizontal
      ? { x: clampToSegment(snap(projected.x), a.x, b.x), y: projected.y }
      : { x: projected.x, y: clampToSegment(snap(projected.y), a.y, b.y) };
    // The new branch leaves the junction across the line - a clean T.
    const branchOrientation: 'H' | 'V' = lineHorizontal ? 'V' : 'H';

    // Line the junction up with the port the new wire starts from, if it's close, so the
    // branch runs straight over (see alignJunctionToPort).
    const pendingComp = appState.findComponent(pending.compId);
    const from = pendingComp && worldPortAnchor(viewport, workspaceEl, pendingComp, pending.port);
    if (from) Object.assign(junctionPos, alignJunctionToPort(junctionPos, a, b, from));

    const junction = createJunction(compLayer, junctionPos.x, junctionPos.y, branchOrientation);
    junction.restore({ ...junction.snapshot(), host: { from: conn.from, to: conn.to } });
    appState.addComponent(junction);
    makeDraggable(junction, viewport);
    wireUpPortLinking(junction);
    wireUpComponentContextMenu(junction);

    // The new wire, from whichever port the drag started at to the junction. It keeps a normal
    // stub at the junction end, which (with the junction's port facing across the line) makes
    // it leave the line at a right angle, on whichever side the other port is.
    const branch = createConnection(
      { id: pending.compId, port: pending.port },
      { id: junction.id, port: 'P' },
    );
    redrawConnection(branch);
    return true;
  });
}
