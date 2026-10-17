import { appState } from '../app/AppState';
import { canEdit } from '../app/modes';
import { getSelectedComponents, clearSelection } from './selection';
import {
  removeConnection,
  removeComponentAndConnections,
  redrawAllConnections,
} from '../wires/connection';
import { cancelLinking, isLinking } from './linking';
import { copySelection, pasteClipboard } from './clipboard';
import { undo, redo } from '../history/historyStore';
import { GRID_SIZE } from '../core/grid';

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
}

function deleteSelection(): void {
  if (!canEdit(appState.mode)) return;

  for (const c of getSelectedComponents()) {
    removeComponentAndConnections(c.id);
  }
  if (appState.selectedConnectionId !== null) {
    removeConnection(appState.selectedConnectionId);
  }
  clearSelection();
  redrawAllConnections();
}

function nudgeSelection(dx: number, dy: number): void {
  if (!canEdit(appState.mode)) return;
  const selected = getSelectedComponents();
  if (selected.length === 0) return;
  for (const c of selected) c.setPos(c.x + dx, c.y + dy);
  redrawAllConnections();
}

let activeListener: ((e: KeyboardEvent) => void) | null = null;

/** Idempotent: a second call (e.g. a test re-initializing between cases) replaces the previous
 * listener instead of stacking another one alongside it - two listeners both reacting to the
 * same Escape press, for instance, would race each other's isLinking()/clearSelection() check
 * against the first one's own side effect. */
export function initKeyboard(): void {
  if (activeListener) window.removeEventListener('keydown', activeListener);

  activeListener = (e) => {
    if (isTypingTarget(document.activeElement)) return;

    if (e.key === 'Escape') {
      // Cancels whichever's actually in progress, not both at once: a wire drag first (nothing
      // else is usually selected while linking anyway), otherwise the current selection - so a
      // second Escape, or one with nothing in flight, clears the selected component(s)/wire.
      if (isLinking()) cancelLinking();
      else clearSelection();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      copySelection();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      pasteClipboard();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }

    // Ctrl+R is the browser's own page-reload shortcut - preventDefault() here is what stops
    // that instead of redoing and then immediately reloading out from under it.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      redo();
      return;
    }

    const step = (e.shiftKey ? 10 : 1) * GRID_SIZE;
    if (e.key === 'ArrowLeft') nudgeSelection(-step, 0);
    else if (e.key === 'ArrowRight') nudgeSelection(step, 0);
    else if (e.key === 'ArrowUp') nudgeSelection(0, -step);
    else if (e.key === 'ArrowDown') nudgeSelection(0, step);
  };
  window.addEventListener('keydown', activeListener);
}
