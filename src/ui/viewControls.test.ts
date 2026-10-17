import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../app/AppState';
import { renderViewControls } from './viewControls';
import { createSource } from '../components/source';
import { selectOnly, clearSelection } from '../interaction/selection';
import type { ViewportAdapter } from './viewport';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

function fakeWorkspace(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  });
  return el;
}

/** Clamps exactly like the real viewport does, so the button behavior at the zoom limits is
 * what's under test rather than an idealized adapter that never refuses a scale. */
function fakeViewport(initial = { scale: 1, tx: 0, ty: 0 }): ViewportAdapter & {
  current(): { scale: number; tx: number; ty: number };
} {
  let { scale, tx, ty } = initial;
  const listeners: Array<() => void> = [];
  return {
    clientToWorld: (cx, cy) => ({ x: (cx - tx) / scale, y: (cy - ty) / scale }),
    applyTransform: () => {},
    getTransform: () => ({ scale, tx, ty }),
    setTransform: (s, x, y) => {
      scale = Math.max(0.1, Math.min(4.0, s));
      tx = x;
      ty = y;
      for (const cb of listeners) cb();
    },
    setGridVisible: () => {},
    onTransformChange: (cb) => {
      listeners.push(cb);
    },
    current: () => ({ scale, tx, ty }),
  };
}

function buttons(container: HTMLElement): Record<string, HTMLButtonElement> {
  const out: Record<string, HTMLButtonElement> = {};
  for (const btn of container.querySelectorAll('button')) {
    out[btn.getAttribute('aria-label') ?? ''] = btn as HTMLButtonElement;
  }
  return out;
}

describe('renderViewControls', () => {
  beforeEach(() => {
    appState.components = [];
    clearSelection();
  });

  it('zooming in keeps whatever is at the middle of the workspace in the middle', () => {
    const viewport = fakeViewport();
    const workspace = fakeWorkspace(800, 600);
    const container = document.createElement('div');
    renderViewControls(container, viewport, workspace);

    // The world point currently under the center of the view.
    const before = viewport.clientToWorld(400, 300);
    buttons(container)['Zoom in']?.click();

    expect(viewport.current().scale).toBeCloseTo(1.25);
    const after = viewport.clientToWorld(400, 300);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zooming out past the minimum leaves the view centered rather than drifting sideways', () => {
    // Starting at the floor: the scale can't change, so the pan offset must not either -
    // recomputing it from the requested (rejected) scale is what would slide the view.
    const viewport = fakeViewport({ scale: 0.1, tx: -120, ty: -45 });
    const workspace = fakeWorkspace(800, 600);
    const container = document.createElement('div');
    renderViewControls(container, viewport, workspace);

    const before = viewport.clientToWorld(400, 300);
    buttons(container)['Zoom out']?.click();

    expect(viewport.current().scale).toBeCloseTo(0.1);
    const after = viewport.clientToWorld(400, 300);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('the readout shows the current zoom and follows changes it did not make itself', () => {
    const viewport = fakeViewport();
    const container = document.createElement('div');
    renderViewControls(container, viewport, fakeWorkspace(800, 600));
    const readout = container.querySelector('.zoomReadout') as HTMLButtonElement;
    expect(readout.textContent).toBe('100%');

    // Stands in for a wheel zoom: the viewport moved without the toolbar being involved.
    viewport.setTransform(2, 0, 0);
    expect(readout.textContent).toBe('200%');

    readout.click();
    expect(viewport.current().scale).toBeCloseTo(1);
    expect(readout.textContent).toBe('100%');
  });

  it('zoom to selection is disabled with nothing selected, and frames the selection otherwise', () => {
    const viewport = fakeViewport();
    const workspace = fakeWorkspace(800, 600);
    const container = document.createElement('div');
    renderViewControls(container, viewport, workspace);
    const selectionBtn = buttons(container)['Zoom to selection'] as HTMLButtonElement;
    expect(selectionBtn.disabled).toBe(true);

    const near = createSource(compLayer(), 100, 100);
    const far = createSource(compLayer(), 2000, 1500);
    appState.addComponent(near);
    appState.addComponent(far);
    selectOnly(near.id);
    expect(selectionBtn.disabled).toBe(false);

    selectionBtn.click();
    // Framing one small component means zooming in, and centering on it - not on the pair.
    const bounds = near.getBounds();
    const center = viewport.clientToWorld(400, 300);
    expect(center.x).toBeCloseTo(bounds.x + bounds.w / 2);
    expect(center.y).toBeCloseTo(bounds.y + bounds.h / 2);
    expect(viewport.current().scale).toBeGreaterThan(1);
  });
});
