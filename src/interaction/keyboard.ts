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
import { pastePictureFrom } from './pictures';
import { rotateSelection } from './componentContextMenu';
import { cancelLibraryDrag, isLibraryDragActive, rotateLibraryDrag } from './libraryDrag';

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
}

function deleteSelection(): void {
  if (!canEdit(appState.mode)) return;

  // All of it at once: one undo step brings back everything deleted together.
  appState.runSuppressed(() => {
    for (const c of getSelectedComponents()) {
      removeComponentAndConnections(c.id);
    }
    if (appState.selectedConnectionId !== null) {
      removeConnection(appState.selectedConnectionId);
    }
    clearSelection();
    redrawAllConnections();
  });
}

function nudgeSelection(dx: number, dy: number): void {
  if (!canEdit(appState.mode)) return;
  const selected = getSelectedComponents();
  if (selected.length === 0) return;
  for (const c of selected) c.setPos(c.x + dx, c.y + dy);
  redrawAllConnections();
}

let activeListener: ((e: KeyboardEvent) => void) | null = null;
let pendingPaste: ReturnType<typeof setTimeout> | undefined;

/** Put on the system clipboard when components are copied, in place of whatever was there - so
 * a picture copied earlier (a screenshot, say) isn't what Ctrl+V pastes next. */
const COPIED_COMPONENTS_MARKER = 'PneuGineer components';

function onCopy(e: ClipboardEvent): void {
  if (isTypingTarget(document.activeElement) || document.querySelector('.modalBackdrop')) return;
  if (getSelectedComponents().length === 0) return;
  e.clipboardData?.setData('text/plain', COPIED_COMPONENTS_MARKER);
  e.preventDefault();
}

/** The browser's paste decides what Ctrl+V pastes: a picture it carries, or else the copied
 * components. Deciding here, rather than on the key, means a slow paste - a big screenshot can
 * take a moment to arrive - can't end up pasting both. */
function onPaste(e: ClipboardEvent): void {
  if (isTypingTarget(document.activeElement) || document.querySelector('.modalBackdrop')) return;
  clearTimeout(pendingPaste);
  pendingPaste = undefined;
  if (!canEdit(appState.mode)) return;
  e.preventDefault();
  if (!pastePictureFrom(e.clipboardData)) pasteClipboard();
}

/** How long Ctrl+V waits for the browser's paste before pasting the copied components itself -
 * only for a browser that sends none. */
const PASTE_FALLBACK_MS = 400;

/** Idempotent: a second call (e.g. a test re-initializing between cases) replaces the previous
 * listener instead of stacking another one alongside it - two listeners both reacting to the
 * same Escape press, for instance, would race each other's isLinking()/clearSelection() check
 * against the first one's own side effect. */
export function initKeyboard(): void {
  if (activeListener) window.removeEventListener('keydown', activeListener);
  window.removeEventListener('copy', onCopy);
  window.removeEventListener('paste', onPaste);
  window.addEventListener('copy', onCopy);
  window.addEventListener('paste', onPaste);

  activeListener = (e) => {
    if (isTypingTarget(document.activeElement)) return;
    // A dialog (the PLC editor, export, tips) is open over the canvas: its keys are its own. The
    // PLC editor deletes its own blocks with Delete, and that must never also delete whatever is
    // still selected on the canvas behind it - the PLC itself, typically.
    if (document.querySelector('.modalBackdrop')) return;

    if (e.key === 'Escape') {
      if (isLibraryDragActive()) {
        cancelLibraryDrag();
        return;
      }
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

    // Copy and paste let the browser's own copy/paste happen too (see the listeners below):
    // that's how a paste can bring in a picture from outside.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      copySelection();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      // The browser's paste that follows this key does the pasting (see onPaste); only if it
      // never comes are the copied components pasted from here.
      clearTimeout(pendingPaste);
      pendingPaste = setTimeout(() => {
        pendingPaste = undefined;
        pasteClipboard();
      }, PASTE_FALLBACK_MS);
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

    // R turns a quarter clockwise, Shift+R counter-clockwise: the component being dragged out
    // of the library, otherwise the selection (also mid-drag, so it can be turned on the way).
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      const delta = e.shiftKey ? -90 : 90;
      if (isLibraryDragActive()) rotateLibraryDrag(delta);
      else rotateSelection(delta);
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
