import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = { lastLoaded: null as unknown };

vi.mock('../persistence/project', () => ({
  serializeProject: (name: string) => ({ schemaVersion: 1, name, comps: [], conns: [] }),
  loadProject: (file: unknown) => {
    mockState.lastLoaded = file;
  },
}));

import { initKeyboard } from './keyboard';
import { initHistory, pushHistory, resetHistory, canRedo, canUndo } from '../history/historyStore';
import { appState } from '../app/AppState';
import { createSource } from '../components/source';
import { selectOnly, clearSelection } from './selection';
import { initLinking, isLinking, wireUpPortLinking } from './linking';

function dispatchKeydown(key: string, opts: { ctrlKey?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, ctrlKey: opts.ctrlKey ?? false, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe('Ctrl+Z / Ctrl+R keyboard shortcuts', () => {
  beforeEach(() => {
    resetHistory();
    initHistory(
      { compLayer: document.createElement('div') },
      {
        clientToWorld: () => ({ x: 0, y: 0 }),
        applyTransform: () => {},
        getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
        setTransform: () => {},
        setGridVisible: () => {},
      },
    );
    initKeyboard();
  });

  it('Ctrl+Z undoes, and prevents the browser default', () => {
    pushHistory('a');
    pushHistory('b');
    expect(canUndo()).toBe(true);

    const event = dispatchKeydown('z', { ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);
    expect((mockState.lastLoaded as { name: string }).name).toBe('a');
  });

  it('Ctrl+R redoes instead of reloading the page', () => {
    pushHistory('a');
    pushHistory('b');
    dispatchKeydown('z', { ctrlKey: true });
    expect(canRedo()).toBe(true);

    const event = dispatchKeydown('r', { ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(canRedo()).toBe(false);
    expect((mockState.lastLoaded as { name: string }).name).toBe('b');
  });

  it('plain Ctrl+Z/Ctrl+R while typing in a field is left alone (no preventDefault)', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    pushHistory('a');
    pushHistory('b');
    const event = dispatchKeydown('z', { ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(canUndo()).toBe(true);
    input.remove();
  });
});

describe('Escape key', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    clearSelection();
    initKeyboard();
  });

  it('clears the current component selection when nothing is being linked', () => {
    const comp = createSource(document.createElement('div'), 0, 0);
    appState.addComponent(comp);
    selectOnly(comp.id);
    expect(appState.selectedComponents.has(comp.id)).toBe(true);

    dispatchKeydown('Escape');

    expect(appState.selectedComponents.size).toBe(0);
  });

  it('cancels an in-progress wire drag instead of touching the selection', () => {
    const a = createSource(document.createElement('div'), 0, 0);
    const b = createSource(document.createElement('div'), 200, 0);
    appState.addComponent(a);
    appState.addComponent(b);
    selectOnly(a.id);
    wireUpPortLinking(b);
    initLinking(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement,
      {
        clientToWorld: (x, y) => ({ x, y }),
        applyTransform: () => {},
        getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
        setTransform: () => {},
        setGridVisible: () => {},
      },
      document.createElement('div'),
    );
    b.ports.OUT?.el.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    expect(isLinking()).toBe(true);

    dispatchKeydown('Escape');

    expect(isLinking()).toBe(false);
    // The selection made before the drag started is left untouched - only the drag itself was
    // cancelled, matching "cancel whichever's actually in progress" in keyboard.ts's own doc.
    expect(appState.selectedComponents.has(a.id)).toBe(true);
  });
});
