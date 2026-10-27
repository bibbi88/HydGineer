import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from './AppState';
import { Modes } from './modes';
import {
  activeDocumentId,
  closeDocument,
  duplicateDocument,
  initDocuments,
  isDocumentEmpty,
  listDocuments,
  moveDocument,
  newDocument,
  prepareToOpen,
  renameDocument,
  resetDocuments,
  switchDocument,
} from './documents';
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
});
