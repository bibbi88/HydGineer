import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = { serializeCallCount: 0, lastLoaded: null as unknown };

vi.mock('../persistence/project', () => ({
  serializeProject: (name: string) => {
    mockState.serializeCallCount++;
    return { schemaVersion: 1, name, comps: [{ id: mockState.serializeCallCount }], conns: [] };
  },
  loadProject: (file: unknown) => {
    mockState.lastLoaded = file;
  },
}));

import {
  pushHistory,
  undo,
  redo,
  canUndo,
  canRedo,
  resetHistory,
  initHistory,
} from './historyStore';

describe('historyStore as a pure stack reducer', () => {
  beforeEach(() => {
    resetHistory();
    mockState.serializeCallCount = 0;
    mockState.lastLoaded = null;
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
  });

  it('cannot undo/redo with no history', () => {
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });

  it('cannot undo with only one entry (nothing to go back to)', () => {
    pushHistory('a');
    expect(canUndo()).toBe(false);
  });

  it('undo moves back one entry and enables redo', () => {
    pushHistory('a');
    pushHistory('b');
    expect(canUndo()).toBe(true);

    undo();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);
    expect((mockState.lastLoaded as { name: string }).name).toBe('a');
  });

  it('redo replays the undone entry', () => {
    pushHistory('a');
    pushHistory('b');
    undo();
    redo();
    expect(canRedo()).toBe(false);
    expect((mockState.lastLoaded as { name: string }).name).toBe('b');
  });

  it('a new push after undo discards the redo stack', () => {
    pushHistory('a');
    pushHistory('b');
    undo();
    expect(canRedo()).toBe(true);

    pushHistory('c');
    expect(canRedo()).toBe(false);
  });

  it('resetHistory clears both stacks', () => {
    pushHistory('a');
    pushHistory('b');
    resetHistory();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });
});
