import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { makeDraggable } from './drag';
import { clearSelection } from './selection';
import { createElecContact } from '../components/electrical';
import type { Component } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';

const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

function place(x: number): Component {
  const c = createElecContact(document.createElement('div'), x, 100);
  appState.addComponent(c);
  makeDraggable(c, viewport);
  return c;
}

/** A left-button press on the component's center (inside its drawn bounds). */
function press(c: Component, ctrlKey = false): void {
  c.el.dispatchEvent(
    new MouseEvent('mousedown', { button: 0, clientX: c.x, clientY: c.y, ctrlKey, bubbles: true }),
  );
  window.dispatchEvent(new MouseEvent('mouseup'));
}

describe('Ctrl+click selection', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    appState.mode = Modes.STOP;
    clearSelection();
  });

  it('adds to the selection, and takes an already selected component back out', () => {
    const a = place(100);
    const b = place(300);

    press(a);
    press(b, true);
    expect([...appState.selectedComponents].sort()).toEqual([a.id, b.id].sort());

    press(a, true);
    expect([...appState.selectedComponents]).toEqual([b.id]);
  });
});
