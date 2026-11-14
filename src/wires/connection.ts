import type {
  Connection,
  ConnectionEndpoint,
  ComponentId,
  PortKey,
  WireGuide,
} from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { uid } from '../core/ids';
import { createSvgEl } from '../components/shared/svgHelpers';
import {
  computeConnectionAnchors,
  computeConnectionGeometry,
} from '../geometry/connectionGeometry';
import {
  completeGuides,
  distPointToSegment,
  guideCorners,
  pathFromPoints,
  polylineMidpoint,
  seedGuidesFromPoints,
  stubPoint,
  type Point,
} from '../geometry/routing';
import { snap } from '../core/grid';
import { WIRE_STUB } from '../sim/constants';
import { selectConnection } from '../interaction/selection';
import { showContextMenu } from '../interaction/contextMenu';
import { placeLabels, type LabelRequest, type Rect } from './labelPlacement';

let connLayerEl: SVGSVGElement | null = null;
/** The wires' live labels, in a layer of their own drawn over every wire, so a wire drawn later
 * can't paint over a label. */
let labelLayerEl: SVGGElement | null = null;
/** Each wire's route as last drawn, and a counter bumped whenever any route changes - what
 * layoutWireLabels() places the labels by. */
const routes = new Map<number, Point[]>();
let routeEpoch = 0;

function labelLayer(): SVGGElement {
  if (!labelLayerEl || labelLayerEl.parentNode !== connLayerEl) {
    labelLayerEl = createSvgEl('g', { class: 'wireLabels' }) as SVGGElement;
    connLayerEl?.appendChild(labelLayerEl);
  }
  return labelLayerEl;
}
let viewportRef: ViewportAdapter | null = null;
let workspaceRef: HTMLElement | null = null;

/**
 * Set by interaction/wireSplitting.ts (dependency-injected to avoid a connection<->linking
 * import cycle): returning true means the click was consumed (e.g. split into a junction).
 */
let wireClickInterceptor: ((conn: Connection, clientX: number, clientY: number) => boolean) | null =
  null;

export function setWireClickInterceptor(
  fn: (conn: Connection, clientX: number, clientY: number) => boolean,
): void {
  wireClickInterceptor = fn;
}

/**
 * Set by interaction/handles.ts (dependency-injected, same reasoning as the click
 * interceptor above): called after every redraw so drag handles stay in sync with the wire's
 * current shape without connection.ts needing to import the handles module.
 */
let geometryChangeListener: (() => void) | null = null;

export function setGeometryChangeListener(fn: () => void): void {
  geometryChangeListener = fn;
}

export function initWires(
  connLayer: SVGSVGElement,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): void {
  connLayerEl = connLayer;
  viewportRef = viewport;
  workspaceRef = workspaceEl;
}

/** Shows/hides a port's dot depending on whether any wire currently ends there, so a connected
 * port reads as a continuous line running into the component instead of a visible stop. */
export function updatePortConnectionVisual(compId: ComponentId, port: PortKey): void {
  const comp = appState.findComponent(compId);
  const portDef = comp?.ports[port];
  if (!portDef) return;
  const connected = appState.connections.some(
    (c) =>
      (c.from.id === compId && c.from.port === port) || (c.to.id === compId && c.to.port === port),
  );
  portDef.el.classList.toggle('portConnected', connected);
}

export function createConnection(from: ConnectionEndpoint, to: ConnectionEndpoint): Connection {
  if (!connLayerEl) throw new Error('initWires() must be called before creating connections');

  const electrical =
    appState.findComponent(from.id)?.ports[from.port]?.electrical === true ||
    appState.findComponent(to.id)?.ports[to.port]?.electrical === true;
  const pathEl = createSvgEl('path', {
    class: electrical ? 'wire wireElectrical' : 'wire',
    fill: 'none',
  });
  const hitEl = createSvgEl('path', { class: 'wireHit', fill: 'none' });
  const labelEl = createSvgEl('text', { class: 'wireLabel', 'font-size': 10 });
  // Wires go under the label layer, labels into it.
  const labels = labelLayer();
  connLayerEl.insertBefore(pathEl, labels);
  connLayerEl.insertBefore(hitEl, labels);
  labels.appendChild(labelEl);

  const conn: Connection = {
    id: uid(),
    from,
    to,
    guides: [],
    stubStartLen: null,
    stubEndLen: null,
    dashed: false,
    pathEl,
    hitEl,
    labelEl,
  };

  hitEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (wireClickInterceptor?.(conn, e.clientX, e.clientY)) return;
    selectConnection(conn.id);
  });
  hitEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const world = viewportRef?.clientToWorld(e.clientX, e.clientY);
    if (world) addBendAtWorldPoint(conn, world);
  });
  hitEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectConnection(conn.id);
    const world = viewportRef?.clientToWorld(e.clientX, e.clientY);
    showContextMenu(e.clientX, e.clientY, [
      {
        label: 'Add bend here',
        onClick: () => {
          if (world) addBendAtWorldPoint(conn, world);
        },
      },
      { label: 'Clear bends (reset to auto-route)', onClick: () => resetToAutoRoute(conn.id) },
      {
        label: conn.dashed ? 'Solid line' : 'Dashed line',
        onClick: () => setWireDashed(conn.id, !conn.dashed),
      },
      { label: 'Delete wire', onClick: () => removeConnection(conn.id) },
    ]);
  });

  appState.addConnection(conn);
  redrawConnection(conn);
  updatePortConnectionVisual(from.id, from.port);
  updatePortConnectionVisual(to.id, to.port);
  return conn;
}

export function removeConnection(connId: number): void {
  const conn = appState.connections.find((c) => c.id === connId);
  if (!conn) return;
  conn.pathEl.remove();
  conn.hitEl.remove();
  conn.labelEl.remove();
  routes.delete(connId);
  routeEpoch++;
  appState.removeConnection(connId);
  updatePortConnectionVisual(conn.from.id, conn.from.port);
  updatePortConnectionVisual(conn.to.id, conn.to.port);
}

/**
 * Deletes a component along with every wire attached to it. Deleting a component directly via
 * appState.removeComponent() alone would leave those wires dangling (never unhooked from the
 * DOM) and, more visibly, leave the *other* end's port stuck showing as "connected" (hidden
 * dot) even though its wire is now gone - so any component deletion must always go through
 * this rather than appState.removeComponent() directly.
 */
export function removeComponentAndConnections(compId: ComponentId): void {
  for (const conn of appState.connections.filter(
    (c) => c.from.id === compId || c.to.id === compId,
  )) {
    removeConnection(conn.id);
  }
  appState.removeComponent(compId);
}

export function setWireDashed(connId: number, dashed: boolean): void {
  const conn = appState.connections.find((c) => c.id === connId);
  if (!conn) return;
  conn.dashed = dashed;
  conn.pathEl.classList.toggle('dashed', dashed);
  appState.markDirty();
}

export function resetToAutoRoute(connId: number): void {
  const conn = appState.connections.find((c) => c.id === connId);
  if (!conn) return;
  conn.guides = [];
  conn.stubStartLen = null;
  conn.stubEndLen = null;
  redrawConnection(conn);
  appState.markDirty();
}

/**
 * Splits whichever segment of the wire passes nearest `worldPoint` into two, inserting a new
 * bend through that point (a perpendicular jog, the same shape a hand-drawn schematic would
 * use), while keeping every other segment untouched. Works on any wire regardless of how many
 * bends it already has - if it's still on auto-route, guides are seeded from its current shape
 * first so there's something to splice into.
 */
function addBendAtWorldPoint(conn: Connection, worldPoint: Point): void {
  if (!viewportRef || !workspaceRef) return;
  const anchors = computeConnectionAnchors(viewportRef, workspaceRef, conn);
  if (!anchors) return;
  const { fromAnchor, toAnchor } = anchors;
  const stubOut = stubPoint(fromAnchor, toAnchor.pos, conn.stubStartLen ?? WIRE_STUB);
  const stubIn = stubPoint(toAnchor, fromAnchor.pos, conn.stubEndLen ?? WIRE_STUB);

  if (conn.guides.length === 0) {
    const points = computeConnectionGeometry(viewportRef, workspaceRef, conn);
    conn.guides = seedGuidesFromPoints(points, stubOut, stubIn);
  }
  // Include the bend the renderer adds when the last guide doesn't line up with the end stub.
  conn.guides = completeGuides(
    fromAnchor,
    toAnchor,
    conn.guides,
    conn.stubStartLen,
    conn.stubEndLen,
  );

  const corners = guideCorners(fromAnchor, toAnchor, conn.guides, conn.stubStartLen);
  const allPoints: Point[] = [...corners, stubIn];

  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < allPoints.length - 1; i++) {
    const a = allPoints[i] as Point;
    const b = allPoints[i + 1] as Point;
    const d = distPointToSegment(worldPoint, a, b);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestIdx === -1 || bestDist > 60) return;

  const a = allPoints[bestIdx] as Point;
  const b = allPoints[bestIdx + 1] as Point;
  const horizontal = a.y === b.y;
  const newGuides: WireGuide[] = horizontal
    ? [
        { type: 'H', pos: snap(worldPoint.y) },
        { type: 'V', pos: b.x },
      ]
    : [
        { type: 'V', pos: snap(worldPoint.x) },
        { type: 'H', pos: b.y },
      ];

  conn.guides.splice(bestIdx, 0, ...newGuides);
  redrawConnection(conn);
  appState.markDirty();
}

export function redrawConnection(conn: Connection): void {
  if (!viewportRef || !workspaceRef) return;
  const points = computeConnectionGeometry(viewportRef, workspaceRef, conn);
  const d = pathFromPoints(points);
  if (conn.pathEl.getAttribute('d') !== d) {
    conn.pathEl.setAttribute('d', d);
    conn.hitEl.setAttribute('d', d);
    routeEpoch++;
  }
  routes.set(conn.id, points);
  conn.pathEl.classList.toggle('dashed', !!conn.dashed);

  // Until layoutWireLabels() finds it a clear spot: the middle of the wire, just above it.
  if (!conn.labelEl.hasAttribute('x')) {
    const mid = polylineMidpoint(points);
    conn.labelEl.setAttribute('x', String(mid.x));
    conn.labelEl.setAttribute('y', String(mid.y - 4));
  }

  geometryChangeListener?.();
}

export function redrawAllConnections(): void {
  for (const c of appState.connections) redrawConnection(c);
}

let lastLabelLayout = '';
let framesSinceLayout = 0;

/** The world box of every non-empty live readout beside a symbol (they sit over the wires). */
function readoutRects(): Rect[] {
  if (!viewportRef) return [];
  const rects: Rect[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('.hydInfo')) {
    if (!el.textContent) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const a = viewportRef.clientToWorld(r.left, r.top);
    const b = viewportRef.clientToWorld(r.right, r.bottom);
    rects.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
  }
  return rects;
}

/**
 * Moves every wire label with text to the clearest spot along its wire - off other wires,
 * symbols, readouts and the other labels (see labelPlacement.ts). Cheap to call every frame:
 * it only works again when the routes, the labels or their lengths changed, or about twice a
 * second for readouts that grew or shrank.
 */
export function layoutWireLabels(): void {
  const requests: LabelRequest[] = [];
  let key = `${routeEpoch}|`;
  for (const conn of appState.connections) {
    const text = conn.labelEl.textContent ?? '';
    if (!text) continue;
    const points = routes.get(conn.id);
    if (!points || points.length < 2) continue;
    let width: number;
    try {
      width = conn.labelEl.getComputedTextLength();
    } catch {
      width = 0;
    }
    if (!width) width = text.length * 5.6;
    width = Math.ceil(width);
    requests.push({ conn, points, width });
    key += `${conn.id}:${width},`;
  }
  framesSinceLayout++;
  if (key === lastLabelLayout && framesSinceLayout < 30) return;
  lastLabelLayout = key;
  framesSinceLayout = 0;
  if (requests.length === 0) return;

  const obstacles: Rect[] = appState.components.map((c) => {
    const b = c.getBounds();
    return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
  });
  obstacles.push(...readoutRects());
  const placement = placeLabels(requests, [...routes.values()], obstacles);
  for (const { conn } of requests) {
    const at = placement.get(conn.id);
    if (!at) continue;
    conn.labelEl.setAttribute('x', String(at.x));
    conn.labelEl.setAttribute('y', String(at.y));
    // A style, not the attribute: .wireLabel's own text-anchor in the stylesheet would win.
    conn.labelEl.style.textAnchor = at.anchor;
  }
}
