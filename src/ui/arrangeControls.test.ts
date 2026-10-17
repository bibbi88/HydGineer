import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { renderArrangeControls } from './arrangeControls';
import { initWires } from '../wires/connection';
import { createSource } from '../components/source';
import { createCylinderDouble } from '../components/cylinderDouble';
import { selectOnly, addToSelection, clearSelection } from '../interaction/selection';
import { getComponentRotation, isComponentMirrored } from '../interaction/componentContextMenu';
import type { Component } from '../core/types';
import type { ViewportAdapter } from './viewport';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

function buttons(container: HTMLElement): Record<string, HTMLButtonElement> {
  const out: Record<string, HTMLButtonElement> = {};
  for (const btn of container.querySelectorAll('button')) {
    out[btn.getAttribute('aria-label') ?? ''] = btn as HTMLButtonElement;
  }
  return out;
}

function render(): Record<string, HTMLButtonElement> {
  const container = document.createElement('div');
  renderArrangeControls(container);
  return buttons(container);
}

function add(c: Component): Component {
  appState.addComponent(c);
  return c;
}

describe('renderArrangeControls', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    appState.setMode(Modes.STOP);
    clearSelection();
    initWires(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement,
      viewport,
      document.createElement('div'),
    );
  });

  it('rotates every selected component, not just the first', () => {
    const a = add(createSource(compLayer(), 0, 0));
    const b = add(createSource(compLayer(), 200, 0));
    const btns = render();
    selectOnly(a.id);
    addToSelection(b.id);

    btns['Rotate clockwise']?.click();
    expect(getComponentRotation(a)).toBe(90);
    expect(getComponentRotation(b)).toBe(90);

    btns['Rotate counter-clockwise']?.click();
    expect(getComponentRotation(a)).toBe(0);
    expect(getComponentRotation(b)).toBe(0);
  });

  it('rotation wraps rather than growing without bound', () => {
    const a = add(createSource(compLayer(), 0, 0));
    const btns = render();
    selectOnly(a.id);

    for (let i = 0; i < 4; i++) btns['Rotate clockwise']?.click();
    expect(getComponentRotation(a)).toBe(0);

    btns['Rotate counter-clockwise']?.click();
    expect(getComponentRotation(a)).toBe(270);
  });

  it('is disabled with nothing selected, and while the simulation is running', () => {
    const a = add(createSource(compLayer(), 0, 0));
    const btns = render();
    expect(btns['Rotate clockwise']?.disabled).toBe(true);

    selectOnly(a.id);
    expect(btns['Rotate clockwise']?.disabled).toBe(false);

    appState.setMode(Modes.PLAY);
    expect(btns['Rotate clockwise']?.disabled).toBe(true);
  });

  it('flip stays disabled for artwork that would read backwards mirrored', () => {
    const source = add(createSource(compLayer(), 0, 0));
    const btns = render();
    selectOnly(source.id);
    expect(btns['Rotate clockwise']?.disabled).toBe(false);
    expect(btns['Flip horizontally']?.disabled).toBe(true);
  });

  it('flips a mixed selection all the same way rather than toggling each independently', () => {
    const a = add(createCylinderDouble(compLayer(), 0, 0));
    const b = add(createCylinderDouble(compLayer(), 400, 0));
    const btns = render();

    selectOnly(a.id);
    btns['Flip horizontally']?.click();
    expect(isComponentMirrored(a)).toBe(true);
    expect(isComponentMirrored(b)).toBe(false);

    // One of the two is already flipped: the press should bring the other into line, not undo
    // the first, leaving a mixed selection in the same state whichever way round it started.
    addToSelection(b.id);
    btns['Flip horizontally']?.click();
    expect(isComponentMirrored(a)).toBe(true);
    expect(isComponentMirrored(b)).toBe(true);

    // Now that they agree, pressing again flips both back.
    btns['Flip horizontally']?.click();
    expect(isComponentMirrored(a)).toBe(false);
    expect(isComponentMirrored(b)).toBe(false);
  });
});
