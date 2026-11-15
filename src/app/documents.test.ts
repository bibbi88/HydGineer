import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from './AppState';
import { Modes } from './modes';
import {
  activeDocumentId,
  closeDocument,
  duplicateDocument,
  initDocuments,
  isDocumentEmpty,
  listDocuments,
  markDocumentSaved,
  moveDocument,
  newDocument,
  prepareToOpen,
  renameDocument,
  resetDocuments,
  switchDocument,
  unsavedDocuments,
} from './documents';
import { serializeProject } from '../persistence/project';
import { resetSettings, updateSettings } from './settings';
import { canUndo, pushHistory, resetHistory } from '../history/historyStore';
import { createHydTank } from '../components/hyd/supply';
import type { ViewportAdapter } from '../ui/viewport';

let transform = { scale: 1, tx: 0, ty: 0 };
const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ ...transform }),
  setTransform: (scale, tx, ty) => {
    transform = { scale, tx, ty };
  },
  setGridVisible: () => {},
};

let name = 'project';
const ctx = { compLayer: document.createElement('div') };

function start(): boolean {
  return initDocuments({
    ctx,
    viewport,
    getName: () => name,
    setName: (n) => {
      name = n;
    },
  });
}

/** A tank on the canvas, recorded as an edit like the app's own change listener does. */
function addTank(): void {
  appState.addComponent(createHydTank(ctx.compLayer, 100, 100));
  pushHistory(name);
}

describe('open documents', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDocuments();
    resetSettings();
    resetHistory();
    appState.components = [];
    appState.connections = [];
    appState.setMode(Modes.STOP);
    name = 'project';
    transform = { scale: 1, tx: 0, ty: 0 };
  });

  it('starts with the canvas as the one document', () => {
    expect(start()).toBe(false);
    expect(listDocuments().map((d) => d.name)).toEqual(['project']);
  });

  it('keeps each document on its own: circuit, name, view and undo history', () => {
    start();
    addTank();
    addTank();
    const first = activeDocumentId();
    transform = { scale: 2, tx: 10, ty: 20 };

    newDocument();
    expect(name).toBe('Circuit 2');
    expect(appState.components).toHaveLength(0);
    expect(canUndo()).toBe(false);

    switchDocument(first);
    expect(name).toBe('project');
    expect(appState.components).toHaveLength(2);
    expect(transform).toEqual({ scale: 2, tx: 10, ty: 20 });
    expect(canUndo()).toBe(true);
  });

  it('stops the simulation when switching', () => {
    start();
    const first = activeDocumentId();
    newDocument();
    appState.setMode(Modes.PLAY);
    switchDocument(first);
    expect(appState.mode).toBe(Modes.STOP);
  });

  it('opens an example or file in a new document unless the current one is empty or the setting is off', () => {
    start();
    expect(prepareToOpen()).toBe('current'); // empty: used as it is
    addTank();
    expect(prepareToOpen()).toBe('new');
    expect(listDocuments()).toHaveLength(2);

    addTank();
    updateSettings({ openInNewDoc: false });
    expect(prepareToOpen()).toBe('current');
    expect(listDocuments()).toHaveLength(2);
  });

  it('closes a document, switching to its neighbour; the last one is emptied instead', () => {
    start();
    addTank();
    const first = activeDocumentId();
    newDocument();
    closeDocument(activeDocumentId());
    expect(listDocuments()).toHaveLength(1);
    expect(activeDocumentId()).toBe(first);
    expect(appState.components).toHaveLength(1);

    closeDocument(first);
    expect(listDocuments()).toHaveLength(1);
    expect(isDocumentEmpty(activeDocumentId())).toBe(true);
    expect(name).toBe('Circuit 1');
  });

  it('renames, duplicates and reorders', () => {
    start();
    addTank();
    const first = activeDocumentId();
    renameDocument(first, '  Lift  ');
    expect(name).toBe('Lift');
    duplicateDocument(first);
    expect(listDocuments().map((d) => d.name)).toEqual(['Lift', 'Lift (copy)']);
    expect(appState.components).toHaveLength(1);
    moveDocument(activeDocumentId(), -1);
    expect(listDocuments().map((d) => d.name)).toEqual(['Lift (copy)', 'Lift']);
  });

  it('keeps every document in the browser and opens them again after a reload', async () => {
    start();
    addTank();
    newDocument('Second');
    addTank();
    addTank();
    switchDocument(listDocuments()[0]!.id);
    await new Promise((r) => setTimeout(r, 450)); // the debounced store

    resetDocuments();
    appState.components = [];
    name = 'project';
    expect(start()).toBe(true);
    expect(listDocuments().map((d) => d.name)).toEqual(['project', 'Second']);
    expect(appState.components).toHaveLength(1);
    switchDocument(listDocuments()[1]!.id);
    expect(appState.components).toHaveLength(2);
  });

  it('knows which documents have unsaved changes, whatever ids their parts get', () => {
    start();
    // An untouched empty document has nothing to lose.
    expect(unsavedDocuments()).toEqual([]);
    addTank();
    expect(unsavedDocuments().map((d) => d.name)).toEqual(['project']);

    const first = activeDocumentId();
    markDocumentSaved(first, serializeProject(name));
    expect(unsavedDocuments()).toEqual([]);

    // Away and back: the parts are loaded again with new ids - still saved.
    newDocument();
    switchDocument(first);
    expect(unsavedDocuments()).toEqual([]);

    appState.components[0]!.setPos(300, 300);
    expect(unsavedDocuments().map((d) => d.id)).toEqual([first]);
  });

  it('starts even when a kept document can no longer be read, emptying just that one', () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const bad = {
      schemaVersion: 1,
      name: 'Broken',
      comps: [{ id: 1, type: 'hyperValve9000', x: 0, y: 0, data: {} }],
      conns: [],
    };
    const good = {
      schemaVersion: 1,
      name: 'Fine',
      comps: [{ id: 1, type: 'hydTank', x: 50, y: 50, data: {} }],
      conns: [],
    };
    localStorage.setItem(
      'hydgineer:docs:v1',
      JSON.stringify({
        active: 'a',
        list: [
          { id: 'a', name: 'Broken', file: bad },
          { id: 'b', name: 'Fine', file: good },
        ],
      }),
    );
    expect(start()).toBe(true);
    expect(appState.components).toHaveLength(0);
    switchDocument('b');
    expect(appState.components.map((c) => c.type)).toEqual(['hydTank']);
  });

  it('says once, not at every change, when the circuits cannot be kept in the browser', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      start();
      for (let i = 0; i < 3; i++) {
        addTank();
        newDocument(); // stores at once
      }
      await Promise.resolve();
      expect(alert).toHaveBeenCalledTimes(1);
      expect(String(alert.mock.calls[0]![0])).toMatch(/couldn't keep your circuits/);
    } finally {
      setItem.mockRestore();
      alert.mockRestore();
    }
  });
});
