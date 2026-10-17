import type { Connection } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { onSelectionChange } from '../interaction/selection';
import {
  computeConnectionAnchors,
  computeConnectionGeometry,
} from '../geometry/connectionGeometry';
import {
  completeGuides,
  guideCorners,
  seedGuidesFromPoints,
  stubLenFromPoint,
  stubPoint,
  type Point,
  type PortAnchor,
} from '../geometry/routing';
import { createSvgEl } from '../components/shared/svgHelpers';
import { redrawConnection, setGeometryChangeListener } from './connection';
import { showContextMenu } from '../interaction/contextMenu';
import { snap } from '../core/grid';
import { Modes } from '../app/modes';
import { WIRE_STUB } from '../sim/constants';

const HANDLE_SIZE = 8;

let handleLayerEl: SVGSVGElement | null = null;
let viewportRef: ViewportAdapter | null = null;
let workspaceRef: HTMLElement | null = null;
let handleEls: SVGRectElement[] = [];
type DragState =
  | { kind: 'guide'; conn: Connection; guideIndex: number; handleEl: SVGRectElement }
  | { kind: 'stub'; conn: Connection; end: 'start' | 'end'; handleEl: SVGRectElement };
let dragState: DragState | null = null;

export function initWireHandles(
  handleLayer: SVGSVGElement,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): void {
  handleLayerEl = handleLayer;
  viewportRef = viewport;
  workspaceRef = workspaceEl;

  onSelectionChange(refreshHandlesForSelection);
  setGeometryChangeListener(refreshHandlesForSelection);
  appState.onModeChange(refreshHandlesForSelection);

  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
}

function clearHandles(): void {
  for (const el of handleEls) el.remove();
  handleEls = [];
}

export function refreshHandlesForSelection(): void {
  clearHandles();
  if (dragState) return; // don't rebuild mid-drag; onDragMove keeps the dragged handle in place

  const connId = appState.selectedConnectionId;
  if (connId == null || !viewportRef || !workspaceRef || !handleLayerEl) return;
  if (appState.mode !== Modes.STOP) return; // editing only makes sense while stopped

  const conn = appState.connections.find((c) => c.id === connId);
  if (!conn) return;

  const anchors = computeConnectionAnchors(viewportRef, workspaceRef, conn);
  if (!anchors) return;
  const { fromAnchor, toAnchor } = anchors;
  const stubOutPoint = stubPoint(fromAnchor, toAnchor.pos, conn.stubStartLen ?? WIRE_STUB);
  const stubInPoint = stubPoint(toAnchor, fromAnchor.pos, conn.stubEndLen ?? WIRE_STUB);

  // Seed editable guides from the current auto-routed shape so there's something to grab the
  // first time a still-auto-routed wire is dragged.
  if (conn.guides.length === 0) {
    const points = computeConnectionGeometry(viewportRef, workspaceRef, conn);
    const seeded = seedGuidesFromPoints(points, stubOutPoint, stubInPoint);
    if (seeded.length > 0) conn.guides = seeded;
  }
  // Include the bend the renderer adds when the last guide doesn't line up with the end stub,
  // so every drawn segment gets a handle in the right place (that bend becomes draggable too).
  if (conn.guides.length > 0) {
    conn.guides = completeGuides(
      fromAnchor,
      toAnchor,
      conn.guides,
      conn.stubStartLen,
      conn.stubEndLen,
    );
  }

  const corners = guideCorners(fromAnchor, toAnchor, conn.guides, conn.stubStartLen);
  const allPoints: Point[] = [...corners, stubInPoint];

  for (let i = 0; i < conn.guides.length; i++) {
    const a = allPoints[i + 1] as Point;
    const b = allPoints[i + 2] as Point;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    handleEls.push(createGuideHandle(conn, i, mid));
  }

  // The stubs at each end (the segment attaching directly to the component's port) are always
  // draggable, independent of whether the wire has any bends, so the run right at the port can
  // be lengthened or shortened to keep wiring clean around a crowded component.
  handleEls.push(createStubHandle(conn, 'start', fromAnchor, stubOutPoint));
  handleEls.push(createStubHandle(conn, 'end', toAnchor, stubInPoint));
}

function createGuideHandle(conn: Connection, guideIndex: number, pos: Point): SVGRectElement {
  const el = createSvgEl('rect', {
    class: 'wireHandle',
    x: pos.x - HANDLE_SIZE / 2,
    y: pos.y - HANDLE_SIZE / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  });
  const guide = conn.guides[guideIndex];
  el.style.cursor = guide?.type === 'H' ? 'ns-resize' : 'ew-resize';
  el.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    dragState = { kind: 'guide', conn, guideIndex, handleEl: el };
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: 'Remove this bend',
        onClick: () => {
          conn.guides.splice(guideIndex, 1);
          redrawConnection(conn);
          appState.markDirty();
        },
      },
    ]);
  });
  handleLayerEl?.appendChild(el);
  return el;
}

/** Handle on the segment directly attaching to a port - dragging it changes that port's
 * `stubStartLen`/`stubEndLen`, i.e. how far the wire runs before it's free to turn. */
function createStubHandle(
  conn: Connection,
  end: 'start' | 'end',
  anchor: PortAnchor,
  stubPos: Point,
): SVGRectElement {
  const mid = { x: (anchor.pos.x + stubPos.x) / 2, y: (anchor.pos.y + stubPos.y) / 2 };
  const el = createSvgEl('rect', {
    class: 'wireHandle wireStubHandle',
    x: mid.x - HANDLE_SIZE / 2,
    y: mid.y - HANDLE_SIZE / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    rx: 3,
    ry: 3,
  });
  el.style.cursor = anchor.entryOrientation === 'H' ? 'ew-resize' : 'ns-resize';
  el.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    dragState = { kind: 'stub', conn, end, handleEl: el };
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: 'Reset to default length',
        onClick: () => {
          if (end === 'start') conn.stubStartLen = null;
          else conn.stubEndLen = null;
          redrawConnection(conn);
          appState.markDirty();
        },
      },
    ]);
  });
  handleLayerEl?.appendChild(el);
  return el;
}

function onDragMove(e: MouseEvent): void {
  if (!dragState || !viewportRef || !workspaceRef) return;
  const world = viewportRef.clientToWorld(e.clientX, e.clientY);

  if (dragState.kind === 'guide') {
    const { conn, guideIndex, handleEl } = dragState;
    const guide = conn.guides[guideIndex];
    if (!guide) return;

    guide.pos = snap(guide.type === 'H' ? world.y : world.x);
    redrawConnection(conn);

    if (guide.type === 'H') {
      handleEl.setAttribute('y', String(guide.pos - HANDLE_SIZE / 2));
    } else {
      handleEl.setAttribute('x', String(guide.pos - HANDLE_SIZE / 2));
    }
    return;
  }

  const { conn, end, handleEl } = dragState;
  const anchors = computeConnectionAnchors(viewportRef, workspaceRef, conn);
  if (!anchors) return;
  const anchor = end === 'start' ? anchors.fromAnchor : anchors.toAnchor;
  const towardPos = end === 'start' ? anchors.toAnchor.pos : anchors.fromAnchor.pos;

  const len = snap(stubLenFromPoint(anchor, towardPos, world));
  if (end === 'start') conn.stubStartLen = len;
  else conn.stubEndLen = len;
  redrawConnection(conn);

  const stubPos = stubPoint(anchor, towardPos, len);
  const mid = { x: (anchor.pos.x + stubPos.x) / 2, y: (anchor.pos.y + stubPos.y) / 2 };
  handleEl.setAttribute('x', String(mid.x - HANDLE_SIZE / 2));
  handleEl.setAttribute('y', String(mid.y - HANDLE_SIZE / 2));
}

function onDragEnd(): void {
  if (!dragState) return;
  dragState = null;
  appState.markDirty();
  refreshHandlesForSelection();
}
