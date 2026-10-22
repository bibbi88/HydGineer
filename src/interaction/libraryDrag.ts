import type { Component } from '../core/types';
import { createComponent, type ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { canEdit } from '../app/modes';
import { snap } from '../core/grid';
import { withoutConsumingLetters } from '../components/shared/letters';
import { getComponentRotation, setComponentRotation } from './componentContextMenu';
import { placeComponent } from './spawn';
import { dropSwapTarget, swapComponentType } from './valveActuatorSwap';
import {
  findNearestWireHit,
  isWireInsertableType,
  setWireInsertHighlight,
  trySpliceOntoWire,
} from './wireInsertion';

/** What the sidebar drives while a library tile is dragged (see ui/sidebar.ts). Positions are
 * client (screen) coordinates. */
export interface LibraryDragHandler {
  start(type: string): void;
  move(clientX: number, clientY: number): void;
  /** Places the component if the pointer is over the canvas, then ends the drag. */
  drop(clientX: number, clientY: number): void;
  cancel(): void;
}

interface ActiveDrag {
  type: string;
  /** The component as it will be placed, drawn see-through under the pointer while it's over
   * the canvas - built through the real factory, so it's the actual symbol, rotation and all. */
  ghost: Component | null;
  rotation: number;
  /** Whether the user turned it during this drag - only then does a wire splice keep the
   * rotation instead of choosing its own (see trySpliceOntoWire). */
  rotated: boolean;
}

let active: ActiveDrag | null = null;
let handler: LibraryDragHandler | null = null;

/** The component a drop here would replace (see dropSwapTarget), marked while hovered. */
let replaceTarget: Component | null = null;

function setReplaceTarget(c: Component | null): void {
  if (replaceTarget === c) return;
  replaceTarget?.el.classList.remove('replaceTarget');
  c?.el.classList.add('replaceTarget');
  replaceTarget = c;
}

export function isLibraryDragActive(): boolean {
  return active !== null;
}

/** Turns the component being dragged out of the library by `deltaDeg` (the R key, or a
 * right-click while dragging), so it can be dropped already the right way round. */
export function rotateLibraryDrag(deltaDeg: number): void {
  if (!active) return;
  active.rotation = (((active.rotation + deltaDeg) % 360) + 360) % 360;
  active.rotated = true;
  if (active.ghost) setComponentRotation(active.ghost, active.rotation);
}

export function cancelLibraryDrag(): void {
  handler?.cancel();
}

/** A right-click while the left button drags turns the component instead of opening a menu. */
function onRightMouseDown(e: MouseEvent): void {
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  window.addEventListener('contextmenu', swallowContextMenu, true);
  rotateLibraryDrag(e.shiftKey ? -90 : 90);
}

/** Browsers send the context menu event on the right button's press or on its release - the
 * latter possibly after the drop - so it's swallowed once whenever it comes. */
function swallowContextMenu(e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
  window.removeEventListener('contextmenu', swallowContextMenu, true);
}

export function initLibraryDrag(
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): LibraryDragHandler {
  function overCanvas(clientX: number, clientY: number): boolean {
    const r = workspaceEl.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function removeGhost(): void {
    if (!active?.ghost) return;
    active.ghost.el.remove();
    active.ghost.destroy?.();
    active.ghost = null;
  }

  function finish(): void {
    removeGhost();
    setWireInsertHighlight(null);
    setReplaceTarget(null);
    active = null;
    document.body.classList.remove('libraryDragging');
    window.removeEventListener('mousedown', onRightMouseDown, true);
  }

  handler = {
    start(type) {
      if (active) finish();
      if (!canEdit(appState.mode)) return;
      active = { type, ghost: null, rotation: 0, rotated: false };
      document.body.classList.add('libraryDragging');
      window.addEventListener('mousedown', onRightMouseDown, true);
    },

    move(clientX, clientY) {
      if (!active) return;
      if (!overCanvas(clientX, clientY)) {
        if (active.ghost) active.ghost.el.style.display = 'none';
        setWireInsertHighlight(null);
        setReplaceTarget(null);
        return;
      }
      const world = viewport.clientToWorld(clientX, clientY);
      if (!active.ghost) {
        const { type } = active;
        const ghost = withoutConsumingLetters(() =>
          createComponent(type, ctx, snap(world.x), snap(world.y)),
        );
        ghost.el.classList.add('dragGhost');
        setComponentRotation(ghost, active.rotation);
        active.ghost = ghost;
      }
      active.ghost.el.style.display = '';
      active.ghost.setPos(snap(world.x), snap(world.y));

      const replacing = dropSwapTarget(active.type, world);
      setReplaceTarget(replacing);
      if (!replacing && isWireInsertableType(active.type)) {
        const hit = findNearestWireHit(viewport, workspaceEl, world);
        setWireInsertHighlight(hit?.conn ?? null);
      } else {
        setWireInsertHighlight(null);
      }
    },

    drop(clientX, clientY) {
      if (!active) return;
      const { type, rotation, rotated } = active;
      finish();
      if (!overCanvas(clientX, clientY) || !canEdit(appState.mode)) return;
      const world = viewport.clientToWorld(clientX, clientY);
      // Dropped onto an interchangeable component (a 4/2 valve on a 4/3 one, say): that one
      // becomes this type, in place, wires and all.
      const target = dropSwapTarget(type, world);
      if (target) {
        swapComponentType(target, type);
        return;
      }
      // Dropping a check/throttle/one-way-flow valve (etc.) close enough to an existing wire
      // splices it into that wire instead of landing unconnected on top of it - see
      // interaction/wireInsertion.ts for which types support this and why.
      const spliced = trySpliceOntoWire(
        type,
        ctx,
        viewport,
        workspaceEl,
        world,
        rotated ? rotation : undefined,
      );
      if (spliced) return;
      // One history step for the placement and its rotation together.
      appState.runSuppressed(() => {
        const comp = placeComponent(type, ctx, viewport, snap(world.x), snap(world.y));
        if (comp && rotation !== getComponentRotation(comp)) setComponentRotation(comp, rotation);
      });
    },

    cancel() {
      finish();
    },
  };
  return handler;
}
