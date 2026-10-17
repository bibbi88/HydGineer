import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../app/AppState';
import { openExportDialog } from './exportDialog';
import { getPageFrameWorldBounds } from './pageFrame';
import type { ViewportAdapter } from './viewport';

function svgLayer(): SVGSVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
}

function fakeWorkspace(width = 800, height = 600): HTMLElement {
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

const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

function previewViewBox(): number[] {
  const svg = document.querySelector('.exportPreviewSvg');
  return svg?.getAttribute('viewBox')?.split(' ').map(Number) ?? [];
}

describe('openExportDialog - "Page frame" region', () => {
  beforeEach(() => {
    appState.components = [];
    appState.pageFrameSize = 'a4';
    appState.pageFrameX = 500;
    appState.pageFrameY = 300;
  });

  afterEach(() => {
    document.body.replaceChildren();
    appState.pageFrameSize = 'none';
  });

  it('crops with a margin around the frame’s own bounds, not flush against it', () => {
    const bounds = getPageFrameWorldBounds();
    if (!bounds) throw new Error('expected a page frame to be active');

    openExportDialog('test', svgLayer(), svgLayer(), viewport, fakeWorkspace());

    // "Page frame" is auto-selected as the default region whenever a frame is active.
    const [x, y, w, h] = previewViewBox();
    expect(x).toBeLessThan(bounds.minX);
    expect(y).toBeLessThan(bounds.minY);
    expect(w).toBeGreaterThan(bounds.maxX - bounds.minX);
    expect(h).toBeGreaterThan(bounds.maxY - bounds.minY);
  });

  it('"Current view" gets no extra padding beyond whatever is actually on screen', () => {
    openExportDialog('test', svgLayer(), svgLayer(), viewport, fakeWorkspace(800, 600));

    const viewBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.exportRegionBtn')).find(
      (b) => b.textContent === 'Current view',
    );
    viewBtn?.click();

    expect(previewViewBox()).toEqual([0, 0, 800, 600]);
  });
});
