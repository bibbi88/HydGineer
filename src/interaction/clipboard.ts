import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';
import type { ComponentId, ConnectionEndpoint, WireGuide } from '../core/types';
import { appState } from '../app/AppState';
import { canEdit } from '../app/modes';
import { spawnComponent } from './spawn';
import { createConnection, redrawAllConnections } from '../wires/connection';
import { getSelectedComponents, clearSelection, addToSelection } from './selection';
import { showContextMenu, type ContextMenuItem } from './contextMenu';
import { zoomToFit } from './zoomToFit';

interface ClipboardComp {
  origId: ComponentId;
  type: string;
  x: number;
  y: number;
  data: Record<string, unknown>;
}

interface ClipboardConn {
  from: ConnectionEndpoint;
  to: ConnectionEndpoint;
  guides: WireGuide[];
  stubStartLen: number | null;
  stubEndLen: number | null;
}

let clipboard: { comps: ClipboardComp[]; conns: ClipboardConn[] } | null = null;
/** Each successive Ctrl+V paste (without an intervening copy) lands further offset from the
 * original, so repeated pastes fan copies out instead of stacking them exactly on top of each
 * other. A cursor-anchored paste (right-click "Paste") ignores this and always lands exactly
 * where clicked. */
let pasteGeneration = 0;

let ctxRef: ComponentFactoryContext | null = null;
let viewportRef: ViewportAdapter | null = null;

export function initClipboard(
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): void {
  ctxRef = ctx;
  viewportRef = viewport;

  // Only reaches here for a right-click that wasn't already claimed (and stopPropagation'd) by
  // a component, wire, or handle - i.e. genuinely empty canvas.
  window.addEventListener('contextmenu', (e) => {
    const rect = workspaceEl.getBoundingClientRect();
    const overWorkspace =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    if (!overWorkspace) return;

    // Paste is an edit, gated the same as everywhere else; Zoom to fit only ever moves the
    // camera, so it's offered regardless of mode - including mid-simulation, where re-framing
    // the view is exactly when you'd want it most.
    const items: ContextMenuItem[] = [];
    if (canEdit(appState.mode) && hasClipboardContent()) {
      const world = viewport.clientToWorld(e.clientX, e.clientY);
      items.push({ label: 'Paste', onClick: () => pasteClipboardAt(world.x, world.y) });
    }
    items.push({ label: 'Zoom to fit', onClick: () => zoomToFit(viewport, workspaceEl) });

    showContextMenu(e.clientX, e.clientY, items);
  });
}

export function hasClipboardContent(): boolean {
  return clipboard !== null && clipboard.comps.length > 0;
}

export function copySelection(): void {
  if (!canEdit(appState.mode)) return;
  const selected = getSelectedComponents();
  if (selected.length === 0) return;

  const ids = new Set(selected.map((c) => c.id));
  clipboard = {
    comps: selected.map((c) => ({
      origId: c.id,
      type: c.type,
      x: c.x,
      y: c.y,
      data: c.snapshot(),
    })),
    // Only wires with both ends inside the copied group come along - a wire to something
    // outside the selection has nothing sensible to reattach to in the pasted copy.
    conns: appState.connections
      .filter((c) => ids.has(c.from.id) && ids.has(c.to.id))
      .map((c) => ({
        from: c.from,
        to: c.to,
        guides: c.guides,
        stubStartLen: c.stubStartLen,
        stubEndLen: c.stubEndLen,
      })),
  };
  pasteGeneration = 0;
}

/** Shared paste path - `offsetFor` decides where the group lands relative to where it was
 * copied from, given the clipboard's own components (e.g. "24px further each time" for Ctrl+V,
 * or "wherever the cursor is" for a right-click paste). */
function pasteWithOffset(offsetFor: (comps: ClipboardComp[]) => { dx: number; dy: number }): void {
  if (!ctxRef || !viewportRef || !clipboard || clipboard.comps.length === 0) return;
  if (!canEdit(appState.mode)) return;

  const { dx, dy } = offsetFor(clipboard.comps);
  const idMap = new Map<ComponentId, ComponentId>();
  const pastedIds: ComponentId[] = [];

  appState.runSuppressed(() => {
    for (const c of clipboard!.comps) {
      const comp = spawnComponent(c.type, ctxRef!, viewportRef!, c.x + dx, c.y + dy);
      comp.restore(c.data);
      // A pasted cylinder gets its own fresh letter (and so its own sensor signal names) rather
      // than colliding with the one it was copied from.
      comp.relabel?.();
      idMap.set(c.origId, comp.id);
      pastedIds.push(comp.id);
    }

    for (const conn of clipboard!.conns) {
      const fromId = idMap.get(conn.from.id);
      const toId = idMap.get(conn.to.id);
      if (fromId === undefined || toId === undefined) continue;
      const newConn = createConnection(
        { id: fromId, port: conn.from.port },
        { id: toId, port: conn.to.port },
      );
      newConn.guides = conn.guides;
      newConn.stubStartLen = conn.stubStartLen;
      newConn.stubEndLen = conn.stubEndLen;
    }
  });

  redrawAllConnections();

  clearSelection();
  for (const id of pastedIds) addToSelection(id);
}

export function pasteClipboard(): void {
  pasteGeneration++;
  const offset = 24 * pasteGeneration;
  pasteWithOffset(() => ({ dx: offset, dy: offset }));
}

/** Pastes anchored at a world-space point - the first copied component lands exactly there,
 * with the rest of the group keeping its layout relative to it. */
export function pasteClipboardAt(worldX: number, worldY: number): void {
  pasteWithOffset((comps) => ({ dx: worldX - comps[0]!.x, dy: worldY - comps[0]!.y }));
}
