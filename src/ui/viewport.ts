import { GRID_SIZE } from '../core/grid';

export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

export interface ViewportAdapter {
  clientToWorld(cx: number, cy: number): { x: number; y: number };
  applyTransform(): void;
  getTransform(): Transform;
  setTransform(scale: number, tx: number, ty: number): void;
  setGridVisible(visible: boolean): void;
  /** Notified after every pan/zoom, however it was triggered - wheel, middle-drag or a toolbar
   * button. The toolbar's zoom readout uses it to stay in step with wheel zooming, which it
   * never hears about otherwise. Optional so the hand-written adapters in tests don't all have
   * to implement it. */
  onTransformChange?(cb: () => void): void;
}

// 0.1 (not the original 0.2) so setTransform (see zoomToFit/page-frame fitting) can still zoom
// out far enough to show a whole A3 sheet on a modest window instead of clamping the fit short
// and leaving part of it off-screen.
const MIN_SCALE = 0.1;
const MAX_SCALE = 4.0;

export function initViewport(
  viewportEl: HTMLElement,
  workspaceEl: HTMLElement,
  gridLayerEl: HTMLElement,
): ViewportAdapter {
  let scale = 1.0;
  let tx = 0;
  let ty = 0;
  let panning = false;
  let panStart = { x: 0, y: 0 };
  let originStart = { x: 0, y: 0 };
  const transformListeners: Array<() => void> = [];

  function applyTransform(): void {
    viewportEl.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;

    // #gridLayer itself never moves - it stays pinned to the visible workspace box - so its own
    // background is re-aligned here on every pan/zoom instead: a cell now spans `scale` times
    // its world size in screen pixels, and the pattern's origin is nudged by the pan offset
    // modulo one cell so it lines up with the same world-space grid #viewport's content sits on,
    // however far tx/ty have drifted from zero.
    const cell = GRID_SIZE * scale;
    gridLayerEl.style.backgroundSize = `${cell}px ${cell}px`;
    gridLayerEl.style.backgroundPosition = `${((tx % cell) + cell) % cell}px ${((ty % cell) + cell) % cell}px`;

    for (const cb of transformListeners) cb();
  }

  function clientToWorld(cx: number, cy: number): { x: number; y: number } {
    const rect = workspaceEl.getBoundingClientRect();
    return {
      x: (cx - rect.left - tx) / scale,
      y: (cy - rect.top - ty) / scale,
    };
  }

  function isOverWorkspace(clientX: number, clientY: number): boolean {
    const rect = workspaceEl.getBoundingClientRect();
    return (
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    );
  }

  window.addEventListener(
    'wheel',
    (e) => {
      if (!isOverWorkspace(e.clientX, e.clientY)) return;
      e.preventDefault();
      const rect = workspaceEl.getBoundingClientRect();
      const delta = -Math.sign(e.deltaY) * 0.12;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * (1 + delta)));
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const wx = (mx - tx) / scale;
      const wy = (my - ty) / scale;
      tx = mx - wx * newScale;
      ty = my - wy * newScale;
      scale = newScale;
      applyTransform();
    },
    { passive: false },
  );

  window.addEventListener('mousedown', (e) => {
    if (!isOverWorkspace(e.clientX, e.clientY)) return;
    // Middle drag, or Alt with either outer button. Alt is what keeps the left-button pan out
    // of the way of marquee selection, which owns a plain left drag on empty canvas.
    const panButton = e.button === 1 || ((e.button === 0 || e.button === 2) && e.altKey);
    if (panButton) {
      panning = true;
      panStart = { x: e.clientX, y: e.clientY };
      originStart = { x: tx, y: ty };
      document.body.style.cursor = 'grabbing';
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    tx = originStart.x + (e.clientX - panStart.x);
    ty = originStart.y + (e.clientY - panStart.y);
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    if (panning) {
      panning = false;
      document.body.style.cursor = '';
    }
  });

  window.addEventListener('contextmenu', (e) => {
    if (isOverWorkspace(e.clientX, e.clientY)) e.preventDefault();
  });

  applyTransform();

  return {
    clientToWorld,
    applyTransform,
    getTransform: () => ({ scale, tx, ty }),
    setTransform: (s, x, y) => {
      scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
      tx = x;
      ty = y;
      applyTransform();
    },
    setGridVisible: (visible) => {
      gridLayerEl.style.display = visible ? '' : 'none';
    },
    onTransformChange: (cb) => {
      transformListeners.push(cb);
    },
  };
}
