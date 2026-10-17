import { describe, expect, it, vi } from 'vitest';
import { computeVisibleWorldBounds, fitViewToWorldRect } from './fitViewToBounds';
import type { ViewportAdapter } from '../ui/viewport';

function fakeWorkspace(width: number, height: number, left = 0, top = 0): HTMLElement {
  const el = document.createElement('div');
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  });
  return el;
}

describe('computeVisibleWorldBounds', () => {
  it('is the inverse of fitViewToWorldRect: fitting a rect then reading it back returns that rect', () => {
    const workspace = fakeWorkspace(800, 600);
    let scale = 1;
    let tx = 0;
    let ty = 0;
    const viewport: ViewportAdapter = {
      clientToWorld: (cx, cy) => ({
        x: (cx - workspace.getBoundingClientRect().left - tx) / scale,
        y: (cy - workspace.getBoundingClientRect().top - ty) / scale,
      }),
      applyTransform: () => {},
      getTransform: () => ({ scale, tx, ty }),
      setTransform: (s, x, y) => {
        scale = s;
        tx = x;
        ty = y;
      },
      setGridVisible: () => {},
    };

    // Same 4:3 aspect ratio as the 800x600 workspace, so the fit scale is unambiguous and the
    // visible bounds land exactly on the target with no letterboxing on either axis.
    const target = { minX: 100, minY: 200, maxX: 900, maxY: 800 };
    fitViewToWorldRect(viewport, workspace, target, 0);

    const visible = computeVisibleWorldBounds(viewport, workspace);
    expect(visible.minX).toBeCloseTo(target.minX);
    expect(visible.minY).toBeCloseTo(target.minY);
    expect(visible.maxX).toBeCloseTo(target.maxX);
    expect(visible.maxY).toBeCloseTo(target.maxY);
  });

  it('reads the visible world rect straight off an identity transform', () => {
    const workspace = fakeWorkspace(800, 600);
    const viewport: ViewportAdapter = {
      clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
      applyTransform: () => {},
      getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
      setTransform: () => {},
      setGridVisible: () => {},
    };

    expect(computeVisibleWorldBounds(viewport, workspace)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 800,
      maxY: 600,
    });
  });
});
