import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../../app/AppState';
import { Modes } from '../../app/modes';
import { spawnComponent } from '../../interaction/spawn';
import { initClipboard, copySelection, pasteClipboard } from '../../interaction/clipboard';
import { addToSelection, clearSelection, selectOnly } from '../../interaction/selection';
import { initWires } from '../../wires/connection';
import { HYD_CYLINDER_DOUBLE_TYPE as CYLINDER_DOUBLE_TYPE } from '../hyd/actuators';
import { HYD_CYLINDER_SINGLE_TYPE as CYLINDER_SINGLE_TYPE } from '../hyd/actuators';
import type { Component } from '../../core/types';
import type { ViewportAdapter } from '../../ui/viewport';

const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};
const ctx = { compLayer: document.createElement('div') };
const workspaceEl = document.createElement('div');

function place(type = CYLINDER_DOUBLE_TYPE): Component {
  return spawnComponent(type, ctx, viewport, 100, 100);
}

function letters(): string[] {
  return appState.components.map((c) => c.snapshot().letter as string);
}

describe('cylinder letters', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    appState.setMode(Modes.STOP);
    clearSelection();
    initWires(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement,
      viewport,
      workspaceEl,
    );
    initClipboard(ctx, viewport, workspaceEl);
  });

  it('gives the next new cylinder B when A is in the circuit, single- or double-acting', () => {
    place();
    place(CYLINDER_SINGLE_TYPE);
    expect(letters()).toEqual(['A', 'B']);
  });

  it('gives a pasted copy of A the letter B, not C', () => {
    const a = place();
    selectOnly(a.id);
    copySelection();
    pasteClipboard();
    expect(letters()).toEqual(['A', 'B']);
  });

  it('pastes a copy of A and B as C and D', () => {
    const a = place();
    const b = place();
    selectOnly(a.id);
    addToSelection(b.id);
    copySelection();
    pasteClipboard();
    expect(letters()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('fills the gap a deleted cylinder left', () => {
    place();
    const b = place();
    place();
    appState.removeComponent(b.id);
    place();
    expect(letters().sort()).toEqual(['A', 'B', 'C']);
  });
});
