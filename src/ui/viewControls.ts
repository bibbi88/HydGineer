import type { ViewportAdapter } from './viewport';
import { zoomToFit } from '../interaction/zoomToFit';
import { fitViewToWorldRect } from '../interaction/fitViewToBounds';
import { boundsOf } from '../geometry/contentBounds';
import { getSelectedComponents, onSelectionChange } from '../interaction/selection';
import { iconButton } from './iconButton';
import { loadGridPreference, saveGridPreference } from '../app/gridPreference';
import { setGridEnabled } from '../core/grid';

/** One press of zoom in/out. 1.25 gives roughly the same feel per click as a wheel notch does
 * per detent, so the two ways of zooming don't behave noticeably differently. */
const ZOOM_STEP = 1.25;

/** Zooms about the middle of the visible workspace, so whatever is centered stays centered -
 * unlike wheel zoom, which anchors on the pointer, a button press has no pointer to anchor to.
 *
 * setTransform clamps the scale to the viewport's own min/max, so the pan offset is recomputed
 * from the scale that actually landed; otherwise a press at either limit would still shift the
 * view sideways while the zoom itself refused to change.
 */
function zoomAboutCenter(
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
  factor: number,
): void {
  const rect = workspaceEl.getBoundingClientRect();
  const { scale, tx, ty } = viewport.getTransform();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const wx = (cx - tx) / scale;
  const wy = (cy - ty) / scale;

  const wanted = scale * factor;
  viewport.setTransform(wanted, cx - wx * wanted, cy - wy * wanted);
  const applied = viewport.getTransform().scale;
  if (applied !== wanted) viewport.setTransform(applied, cx - wx * applied, cy - wy * applied);
}

/** Frames the current selection the same way "fit to window" frames the whole diagram. */
function zoomToSelection(viewport: ViewportAdapter, workspaceEl: HTMLElement): void {
  const bounds = boundsOf(getSelectedComponents());
  if (!bounds) return;
  fitViewToWorldRect(viewport, workspaceEl, bounds);
}

/** The toolbar's view section: zoom out / zoom level / zoom in, fit the whole diagram to the
 * window, and frame just what's selected. The percentage between the two magnifiers is itself a
 * button that snaps back to 100%, and it tracks every pan/zoom - including wheel zoom, which it
 * hears about through the viewport's own transform notification. */
export function renderViewControls(
  container: HTMLElement,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): void {
  const zoomOutBtn = iconButton('zoomOut', 'Zoom out', () =>
    zoomAboutCenter(viewport, workspaceEl, 1 / ZOOM_STEP),
  );
  const zoomInBtn = iconButton('zoomIn', 'Zoom in', () =>
    zoomAboutCenter(viewport, workspaceEl, ZOOM_STEP),
  );

  const readout = document.createElement('button');
  readout.className = 'zoomReadout';
  readout.title = 'Reset zoom to 100%';
  readout.setAttribute('aria-label', 'Reset zoom to 100%');
  readout.addEventListener('click', () => {
    const { scale } = viewport.getTransform();
    zoomAboutCenter(viewport, workspaceEl, 1 / scale);
  });

  function refreshReadout(): void {
    readout.textContent = `${Math.round(viewport.getTransform().scale * 100)}%`;
  }
  refreshReadout();
  viewport.onTransformChange?.(refreshReadout);

  const fitBtn = iconButton('fit', 'Fit diagram to window', () => zoomToFit(viewport, workspaceEl));
  const selectionBtn = iconButton('zoomSelection', 'Zoom to selection', () =>
    zoomToSelection(viewport, workspaceEl),
  );

  // Nothing selected means nothing to frame, so the button says so rather than doing nothing.
  function refreshSelectionButton(): void {
    selectionBtn.disabled = getSelectedComponents().length === 0;
  }
  onSelectionChange(refreshSelectionButton);
  refreshSelectionButton();

  // A toggle rather than an action, so it stays lit while the grid is on. It turns off both the
  // visible grid and snap-to-grid together - a hidden grid that components still silently snap
  // to is a worse experience than either fully on or fully off. The setting is per person, not
  // per project, so it persists in localStorage (see app/gridPreference.ts).
  let gridOn = loadGridPreference();
  const gridBtn = iconButton('grid', 'Show grid', () => setGrid(!gridOn));

  function setGrid(on: boolean): void {
    gridOn = on;
    setGridEnabled(on);
    viewport.setGridVisible(on);
    saveGridPreference(on);
    gridBtn.classList.toggle('iconBtn--active', on);
    gridBtn.setAttribute('aria-pressed', String(on));
  }
  setGrid(gridOn);

  container.append(zoomOutBtn, readout, zoomInBtn, fitBtn, selectionBtn, gridBtn);
}
