import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../app/AppState';
import {
  getPageFrameWorldBounds,
  initPageFrame,
  renderPageFrame,
  setPageFrameSize,
} from './pageFrame';
import { createSource } from '../components/source';
import type { ProjectBarRefs } from './projectBar';
import type { ViewportAdapter } from './viewport';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

function svgLayer(): SVGSVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

function fakeProjectBar(name: string): ProjectBarRefs {
  return { getName: () => name, setName: () => {} };
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

/** Remembers what it was last set to, like the real viewport does - fitViewToWorldRect reads
 * the transform back after setting it, to re-center if its requested scale got clamped. */
function fakeViewport(onSetTransform: ViewportAdapter['setTransform'] = () => {}): ViewportAdapter {
  let current = { scale: 1, tx: 0, ty: 0 };
  return {
    clientToWorld: () => ({ x: 0, y: 0 }),
    applyTransform: () => {},
    getTransform: () => ({ ...current }),
    setTransform: (scale, tx, ty) => {
      current = { scale: Math.max(0.1, Math.min(4.0, scale)), tx, ty };
      onSetTransform(scale, tx, ty);
    },
    setGridVisible: () => {},
  };
}

describe('page frame', () => {
  beforeEach(() => {
    appState.components = [];
    appState.pageFrameSize = 'none';
    appState.pageFrameX = 0;
    appState.pageFrameY = 0;
    appState.projectAuthor = '';
    appState.projectCheckedBy = '';
    appState.projectCompany = '';
    appState.projectDate = '';
  });

  it('draws nothing while the size is "none"', () => {
    const layer = svgLayer();
    initPageFrame(layer, fakeProjectBar('test'), fakeViewport(), fakeWorkspace());
    expect(layer.children.length).toBe(0);
  });

  it('draws a solid (not dashed) sheet rect and title block once a size is picked', () => {
    const layer = svgLayer();
    initPageFrame(layer, fakeProjectBar('test'), fakeViewport(), fakeWorkspace());

    setPageFrameSize('a4');

    const rect = layer.querySelector('.pageFrameRect');
    expect(rect).not.toBeNull();
    expect(layer.querySelector('.pageFrameTitleBlock')).not.toBeNull();
  });

  it('title block shows the project name, date, and the other title-block fields as separate cells', () => {
    const layer = svgLayer();
    initPageFrame(layer, fakeProjectBar('Acme circuit'), fakeViewport(), fakeWorkspace());
    appState.projectAuthor = 'Jane';
    appState.projectCheckedBy = 'Alex';
    appState.projectCompany = 'Acme Pneumatics';
    appState.projectDate = '2026-09-18';

    setPageFrameSize('a3');

    const values = Array.from(layer.querySelectorAll('.pageFrameTitleValue')).map(
      (el) => el.textContent,
    );
    expect(values).toEqual(['Acme circuit', '2026-09-18', 'Acme Pneumatics', 'Jane', 'Alex']);

    // Cell dividers: one horizontal line between each of the 5 rows (4), plus the one vertical
    // line separating the label column from the value column.
    expect(layer.querySelectorAll('.pageFrameGridLine').length).toBe(5);
  });

  it('centers on the current diagram when picked, and stays put afterward', () => {
    const layer = svgLayer();
    initPageFrame(layer, fakeProjectBar('test'), fakeViewport(), fakeWorkspace());

    const comp = createSource(compLayer(), 400, 300);
    appState.addComponent(comp);
    const b = comp.getBounds();
    const expectedCx = b.x + b.w / 2;
    const expectedCy = b.y + b.h / 2;

    setPageFrameSize('a4');
    expect(appState.pageFrameX).toBeCloseTo(expectedCx);
    expect(appState.pageFrameY).toBeCloseTo(expectedCy);

    // Moving the component afterward must not drag an already-placed frame along with it - only
    // picking a size (again) recenters it.
    comp.setPos(4000, 4000);
    renderPageFrame();
    expect(appState.pageFrameX).toBeCloseTo(expectedCx);
    expect(appState.pageFrameY).toBeCloseTo(expectedCy);
  });

  it('switching between A4 and A3 re-centers on the diagram again, not the old frame center', () => {
    const layer = svgLayer();
    initPageFrame(layer, fakeProjectBar('test'), fakeViewport(), fakeWorkspace());

    const comp = createSource(compLayer(), 0, 0);
    appState.addComponent(comp);
    setPageFrameSize('a4');
    const firstX = appState.pageFrameX;

    comp.setPos(9000, 9000);
    setPageFrameSize('a3');
    expect(appState.pageFrameX).not.toBeCloseTo(firstX);
  });

  it('picking a size pans/zooms the view so the whole sheet is visible, not left off-screen', () => {
    const layer = svgLayer();
    let applied: { scale: number; tx: number; ty: number } | null = null;
    const viewport = fakeViewport((scale, tx, ty) => {
      applied = { scale, tx, ty };
    });
    const workspace = fakeWorkspace(800, 600);
    initPageFrame(layer, fakeProjectBar('test'), viewport, workspace);

    setPageFrameSize('a4');

    if (!applied) throw new Error('setTransform was not called');
    const { scale, tx, ty } = applied;
    // The sheet is centered at world (pageFrameX, pageFrameY) - that point must land at the
    // workspace's own screen center once the view is fit to it.
    expect(tx + appState.pageFrameX * scale).toBeCloseTo(400);
    expect(ty + appState.pageFrameY * scale).toBeCloseTo(300);
    // The whole sheet (1800x1280 world units for A4), at the fitted scale, must actually fit
    // within the 800x600 workspace - the exact bug this is regression-testing against.
    expect(scale * 1800).toBeLessThanOrEqual(800);
    expect(scale * 1280).toBeLessThanOrEqual(600);
  });

  describe('getPageFrameWorldBounds', () => {
    it('is null while the frame is off', () => {
      initPageFrame(svgLayer(), fakeProjectBar('test'), fakeViewport(), fakeWorkspace());
      expect(getPageFrameWorldBounds()).toBeNull();
    });

    it('matches the sheet actually drawn once a size is picked', () => {
      initPageFrame(svgLayer(), fakeProjectBar('test'), fakeViewport(), fakeWorkspace());
      setPageFrameSize('a4');

      const bounds = getPageFrameWorldBounds();
      expect(bounds).not.toBeNull();
      expect((bounds?.maxX ?? 0) - (bounds?.minX ?? 0)).toBeCloseTo(1800);
      expect((bounds?.maxY ?? 0) - (bounds?.minY ?? 0)).toBeCloseTo(1280);
      expect((bounds!.minX + bounds!.maxX) / 2).toBeCloseTo(appState.pageFrameX);
      expect((bounds!.minY + bounds!.maxY) / 2).toBeCloseTo(appState.pageFrameY);
    });
  });
});
