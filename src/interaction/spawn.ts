import { createComponent, type ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';
import type { Component } from '../core/types';
import { appState } from '../app/AppState';
import { canEdit } from '../app/modes';
import { makeDraggable } from './drag';
import { wireUpPortLinking } from './linking';
import { wireUpComponentContextMenu } from './componentContextMenu';
import { wireUpPortContextMenu } from './portContextMenu';

/** Creates a component of `type` and wires up every interaction hook it needs (drag, port
 * linking, right-click menu), then registers it in AppState. The one place both "add from
 * sidebar" and "load a project" should go through, so neither can forget a wiring step. */
export function spawnComponent(
  type: string,
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
  x: number,
  y: number,
): Component {
  const comp = createComponent(type, ctx, x, y);
  makeDraggable(comp, viewport);
  wireUpPortLinking(comp);
  wireUpComponentContextMenu(comp);
  wireUpPortContextMenu(comp, viewport, (t, sx, sy) => spawnComponent(t, ctx, viewport, sx, sy));
  appState.addComponent(comp);
  return comp;
}

/**
 * `spawnComponent` for the paths a *user* drives - clicking a library tile, or dropping one on
 * the canvas - which are only allowed while the diagram is editable. Returns null when the
 * simulation is running, so the caller places nothing.
 *
 * The guard lives here rather than in `spawnComponent` itself because that one is also how a
 * project load, an undo/redo and a paste rebuild the diagram; those have to work whatever mode
 * the app is in, and blocking them would break loading a file mid-run. Every other editing
 * entry point already refuses the same way - see drag.ts, keyboard.ts, clipboard.ts and the two
 * context menus.
 */
export function placeComponent(
  type: string,
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
  x: number,
  y: number,
): Component | null {
  if (!canEdit(appState.mode)) return null;
  return spawnComponent(type, ctx, viewport, x, y);
}
