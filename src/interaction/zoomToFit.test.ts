import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../app/AppState';
import { zoomToFit } from './zoomToFit';
import { createSource } from '../components/source';
import { initPageFrame, setPageFrameSize, getPageFrameWorldBounds } from '../ui/pageFrame';
import type { ProjectBarRefs } from '../ui/projectBar';
import type { ViewportAdapter } from '../ui/viewport';

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

/** Tracks what it was set to, like the real viewport - fitViewToWorldRect reads the transform
 * back to re-center if its requested scale hit a zoom limit. */
function trackingViewport(): ViewportAdapter & {
  current(): { scale: number; tx: number; ty: number };
} {
  let current = { scale: 1, tx: 0, ty: 0 };
  return {
    clientToWorld: (cx, cy) => ({
      x: (cx - current.tx) / current.scale,
      y: (cy - current.ty) / current.scale,
    }),
    applyTransform: () => {},
    getTransform: () => ({ ...current }),
    setTransform: (scale, tx, ty) => {
      current = { scale: Math.max(0.1, Math.min(4.0, scale)), tx, ty };
    },
    setGridVisible: () => {},
    current: () => ({ ...current }),
  };
}

function svgLayer(): SVGSVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

const fakeProjectBar: ProjectBarRefs = { getName: () => 'test', setName: () => {} };

describe('zoomToFit', () => {
  beforeEach(() => {
    appState.components = [];
    appState.pageFrameSize = 'none';
    appState.pageFrameX = 0;
    appState.pageFrameY = 0;
  });

  it('does nothing on an empty canvas', () => {
    const setTransform = vi.fn();
    const viewport: ViewportAdapter = {
      clientToWorld: () => ({ x: 0, y: 0 }),
      applyTransform: () => {},
      getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
      setTransform,
      setGridVisible: () => {},
    };

    zoomToFit(viewport, fakeWorkspace(800, 600));
    expect(setTransform).not.toHaveBeenCalled();
  });

  it('centers the content bounds in the middle of the workspace', () => {
    const comp = createSource(compLayer(), 500, 500);
    appState.addComponent(comp);
    const b = comp.getBounds();
    const expectedCx = b.x + b.w / 2;
    const expectedCy = b.y + b.h / 2;

    let applied: { scale: number; tx: number; ty: number } | null = null;
    const viewport: ViewportAdapter = {
      clientToWorld: () => ({ x: 0, y: 0 }),
      applyTransform: () => {},
      getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
      setTransform: (scale, tx, ty) => {
        applied = { scale, tx, ty };
      },
      setGridVisible: () => {},
    };

    zoomToFit(viewport, fakeWorkspace(800, 600));

    if (!applied) throw new Error('setTransform was not called');
    const { scale, tx, ty } = applied;
    // The world point that should land at screen center (400, 300) is the content's own center.
    expect(tx + expectedCx * scale).toBeCloseTo(400);
    expect(ty + expectedCy * scale).toBeCloseTo(300);
  });
});

describe('zoomToFit with a page frame', () => {
  beforeEach(() => {
    appState.components = [];
    appState.pageFrameSize = 'none';
    appState.pageFrameX = 0;
    appState.pageFrameY = 0;
  });

  it('fits the whole sheet, not just the components sitting on it', () => {
    const workspace = fakeWorkspace(800, 600);
    const viewport = trackingViewport();
    initPageFrame(svgLayer(), fakeProjectBar, viewport, workspace);

    appState.addComponent(createSource(compLayer(), 0, 0));
    setPageFrameSize('a4');

    zoomToFit(viewport, workspace);

    // Every corner of the sheet has to land inside the workspace once fitted - the whole point
    // of taking the frame into account rather than fitting the lone component and leaving the
    // sheet running off all four edges.
    const frame = getPageFrameWorldBounds();
    if (!frame) throw new Error('page frame should be on');
    const { scale, tx, ty } = viewport.current();
    expect(frame.minX * scale + tx).toBeGreaterThanOrEqual(0);
    expect(frame.minY * scale + ty).toBeGreaterThanOrEqual(0);
    expect(frame.maxX * scale + tx).toBeLessThanOrEqual(800);
    expect(frame.maxY * scale + ty).toBeLessThanOrEqual(600);
  });

  it('still fits a component that sits outside the sheet', () => {
    const workspace = fakeWorkspace(800, 600);
    const viewport = trackingViewport();
    initPageFrame(svgLayer(), fakeProjectBar, viewport, workspace);

    setPageFrameSize('a4');
    // Placed well clear of the sheet: the fit is the union of the two, not either alone.
    const stray = createSource(compLayer(), 6000, 4000);
    appState.addComponent(stray);

    zoomToFit(viewport, workspace);

    const b = stray.getBounds();
    const { scale, tx, ty } = viewport.current();
    expect((b.x + b.w) * scale + tx).toBeLessThanOrEqual(800);
    expect((b.y + b.h) * scale + ty).toBeLessThanOrEqual(600);
    const frame = getPageFrameWorldBounds();
    if (!frame) throw new Error('page frame should be on');
    expect(frame.minX * scale + tx).toBeGreaterThanOrEqual(0);
    expect(frame.minY * scale + ty).toBeGreaterThanOrEqual(0);
  });

  it('fits the sheet alone when the canvas has no components at all', () => {
    const workspace = fakeWorkspace(800, 600);
    const viewport = trackingViewport();
    initPageFrame(svgLayer(), fakeProjectBar, viewport, workspace);
    setPageFrameSize('a3');

    viewport.setTransform(1, 0, 0);
    zoomToFit(viewport, workspace);

    // Previously a no-op: content bounds are null with nothing placed, so the button did
    // nothing even though there was plainly a sheet on screen to fit.
    expect(viewport.current().scale).not.toBeCloseTo(1);
    const frame = getPageFrameWorldBounds();
    if (!frame) throw new Error('page frame should be on');
    const { scale, tx, ty } = viewport.current();
    expect(frame.maxX * scale + tx).toBeLessThanOrEqual(800);
    expect(frame.maxY * scale + ty).toBeLessThanOrEqual(600);
  });
});
