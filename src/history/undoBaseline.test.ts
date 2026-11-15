import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { canUndo, initHistory, pushHistory, resetHistory, seedHistory, undo } from './historyStore';
import { initWires } from '../wires/connection';
import { createHydTank as createSource } from '../components/hyd/supply';
import { makeDraggable } from '../interaction/drag';
import { initKeyboard } from '../interaction/keyboard';
import { selectOnly, clearSelection } from '../interaction/selection';
import type { ViewportAdapter } from '../ui/viewport';

const viewport: ViewportAdapter = {
  clientToWorld: (x, y) => ({ x, y }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};
const layer = (): HTMLElement => document.createElement('div');

beforeEach(() => {
  appState.components = [];
  appState.connections = [];
  appState.setMode(Modes.STOP);
  clearSelection();
  initWires(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), viewport, layer());
  initHistory({ compLayer: layer() }, viewport);
  resetHistory();
});

describe('undo', () => {
  it("can undo a fresh document's very first edit", () => {
    seedHistory('p');
    appState.addComponent(createSource(layer(), 100, 100));
    pushHistory('p');
    expect(canUndo()).toBe(true);
    undo();
    expect(appState.components).toHaveLength(0);
  });
});

describe('moving components', () => {
  it('records a drag as one change', () => {
    const comp = createSource(layer(), 100, 100);
    appState.addComponent(comp);
    makeDraggable(comp, viewport);
    let changes = 0;
    appState.onChange(() => changes++);
    const mouse = (type: string, target: EventTarget, x: number, y: number): void => {
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
        }),
      );
    };
    mouse('mousedown', comp.el, 100, 100);
    mouse('mousemove', window, 160, 140);
    mouse('mouseup', window, 160, 140);
    expect(comp.x).not.toBe(100);
    expect(changes).toBe(1);
  });

  it('records a run of arrow-key nudges as one change, once the keys rest', () => {
    vi.useFakeTimers();
    try {
      initKeyboard();
      const comp = createSource(layer(), 100, 100);
      appState.addComponent(comp);
      selectOnly(comp.id);
      let changes = 0;
      appState.onChange(() => changes++);
      for (let i = 0; i < 3; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
      }
      expect(changes).toBe(0);
      vi.advanceTimersByTime(1000);
      expect(changes).toBe(1);
      expect(comp.x).toBeGreaterThan(100);
    } finally {
      vi.useRealTimers();
    }
  });
});
