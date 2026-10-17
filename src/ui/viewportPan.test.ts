import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initViewport, type ViewportAdapter } from './viewport';

function fixedRect(el: HTMLElement, width = 800, height = 600): void {
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
}

let viewport: ViewportAdapter;

/** initViewport binds to window, and nothing unbinds it - so one instance is built for the whole
 * file and simply reset between tests, rather than stacking up live listeners per test. */
function setup(): void {
  const workspace = document.createElement('div');
  const viewportEl = document.createElement('div');
  const gridLayer = document.createElement('div');
  fixedRect(workspace);
  viewport = initViewport(viewportEl, workspace, gridLayer);
}
setup();

function drag(button: number, opts: MouseEventInit, to: { x: number; y: number }): void {
  window.dispatchEvent(
    new MouseEvent('mousedown', { button, clientX: 100, clientY: 100, ...opts }),
  );
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: to.x, clientY: to.y }));
  window.dispatchEvent(new MouseEvent('mouseup'));
}

describe('viewport panning', () => {
  beforeEach(() => {
    viewport.setTransform(1, 0, 0);
  });

  it('pans on a middle drag', () => {
    drag(1, {}, { x: 180, y: 150 });
    expect(viewport.getTransform()).toMatchObject({ tx: 80, ty: 50 });
  });

  it('pans on Alt + left drag', () => {
    drag(0, { altKey: true }, { x: 160, y: 130 });
    expect(viewport.getTransform()).toMatchObject({ tx: 60, ty: 30 });
  });

  it('pans on Alt + right drag', () => {
    drag(2, { altKey: true }, { x: 140, y: 120 });
    expect(viewport.getTransform()).toMatchObject({ tx: 40, ty: 20 });
  });

  it('does not pan on a plain left drag, which belongs to marquee selection', () => {
    drag(0, {}, { x: 400, y: 400 });
    expect(viewport.getTransform()).toMatchObject({ tx: 0, ty: 0 });
  });

  it('does not pan on a plain right drag', () => {
    drag(2, {}, { x: 400, y: 400 });
    expect(viewport.getTransform()).toMatchObject({ tx: 0, ty: 0 });
  });

  it('keeps the zoom level while panning', () => {
    viewport.setTransform(2, 0, 0);
    drag(1, {}, { x: 150, y: 100 });
    expect(viewport.getTransform().scale).toBe(2);
    expect(viewport.getTransform().tx).toBe(50);
  });
});
