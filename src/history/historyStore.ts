import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';
import { serializeProject, loadProject } from '../persistence/project';
import type { ProjectFileV1 } from '../persistence/schema';

const HISTORY_LIMIT = 50;

/** history[history.length - 1] is always the current live state; undo/redo move the cursor. */
let history: ProjectFileV1[] = [];
let future: ProjectFileV1[] = [];

let ctxRef: ComponentFactoryContext | null = null;
let viewportRef: ViewportAdapter | null = null;
const listeners: Array<() => void> = [];
/** True while undo/redo is applying a snapshot, so that load's own change notification
 * doesn't get recorded as a brand new history entry (which would wipe the redo stack). */
let suppressPush = false;

function notify(): void {
  for (const cb of listeners) cb();
}

export function initHistory(ctx: ComponentFactoryContext, viewport: ViewportAdapter): void {
  ctxRef = ctx;
  viewportRef = viewport;
}

export function onHistoryChange(cb: () => void): void {
  listeners.push(cb);
}

export function pushHistory(name: string): void {
  if (suppressPush) return;
  history.push(serializeProject(name));
  if (history.length > HISTORY_LIMIT) history.shift();
  future = [];
  notify();
}

export function canUndo(): boolean {
  return history.length > 1;
}

export function canRedo(): boolean {
  return future.length > 0;
}

export function undo(): void {
  if (!canUndo() || !ctxRef || !viewportRef) return;
  const current = history.pop();
  if (current) future.push(current);
  const previous = history[history.length - 1];
  if (previous) {
    suppressPush = true;
    try {
      loadProject(previous, ctxRef, viewportRef);
    } finally {
      suppressPush = false;
    }
  }
  notify();
}

export function redo(): void {
  if (!canRedo() || !ctxRef || !viewportRef) return;
  const next = future.pop();
  if (!next) return;
  history.push(next);
  suppressPush = true;
  try {
    loadProject(next, ctxRef, viewportRef);
  } finally {
    suppressPush = false;
  }
  notify();
}

export function resetHistory(): void {
  history = [];
  future = [];
  notify();
}
