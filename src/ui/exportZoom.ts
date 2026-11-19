/**
 * The exports' zoom: fit the chosen area to the page, or a fixed zoom - typed in, or stepped with
 * the − and + beside it (25-400 %). For an image there's no page: "fit" then means the drawing at
 * 100 %.
 */
export interface ExportZoomState {
  fit: boolean;
  /** Percent, 25-400. */
  percent: number;
}

export const ZOOM_MIN = 25;
export const ZOOM_MAX = 400;
const STEP = 25;

/** The zoom to export at: undefined = fit to the page, else the scale (1 = 100 %). */
export function exportZoom(s: ExportZoomState, forImage = false): number | undefined {
  if (s.fit) return forImage ? 1 : undefined;
  return s.percent / 100;
}

export function renderExportZoom(
  state: ExportZoomState,
  fitLabel: string,
  onChange: () => void = () => {},
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'exportZoom';
  const name = `exportZoom${Math.random().toString(36).slice(2, 7)}`;

  const fitRow = document.createElement('label');
  fitRow.className = 'exportManyChoice';
  const fitInput = document.createElement('input');
  fitInput.type = 'radio';
  fitInput.name = name;
  fitInput.checked = state.fit;
  fitRow.append(fitInput, document.createTextNode(` ${fitLabel}`));

  const zoomRow = document.createElement('div');
  zoomRow.className = 'exportManyChoice exportZoomRow';
  const zoomInput = document.createElement('input');
  zoomInput.type = 'radio';
  zoomInput.name = name;
  zoomInput.checked = !state.fit;
  zoomInput.setAttribute('aria-label', 'Zoom');
  const minus = document.createElement('button');
  minus.type = 'button';
  minus.className = 'exportZoomStep';
  minus.textContent = '−';
  minus.setAttribute('aria-label', 'Zoom out');
  const field = document.createElement('input');
  field.type = 'number';
  field.min = String(ZOOM_MIN);
  field.max = String(ZOOM_MAX);
  field.step = '5';
  field.className = 'exportZoomField';
  field.setAttribute('aria-label', 'Zoom, %');
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'exportZoomStep';
  plus.textContent = '+';
  plus.setAttribute('aria-label', 'Zoom in');
  const unit = document.createElement('span');
  unit.className = 'exportZoomUnit';
  unit.textContent = '%';
  const zoomLabel = document.createElement('span');
  zoomLabel.textContent = 'Zoom';
  zoomRow.append(zoomInput, zoomLabel, minus, field, unit, plus);
  wrap.append(fitRow, zoomRow);

  function show(): void {
    fitInput.checked = state.fit;
    zoomInput.checked = !state.fit;
    if (document.activeElement !== field) field.value = String(state.percent);
    wrap.classList.toggle('exportZoom--fit', state.fit);
  }
  function set(percent: number, snap = true): void {
    if (!Number.isFinite(percent)) return;
    const p = snap ? Math.round(percent / STEP) * STEP : Math.round(percent);
    state.percent = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, p));
    state.fit = false;
    show();
    onChange();
  }
  fitInput.addEventListener('change', () => {
    state.fit = true;
    show();
    onChange();
  });
  zoomInput.addEventListener('change', () => set(state.percent));
  // Typed: any whole percent; tidied to the allowed range when the field is left.
  field.addEventListener('input', () => set(Number(field.value), false));
  field.addEventListener('change', () => {
    set(Number(field.value), false);
    field.value = String(state.percent);
  });
  minus.addEventListener('click', () => set(state.percent - STEP));
  plus.addEventListener('click', () => set(state.percent + STEP));
  minus.addEventListener('mousedown', (e) => e.preventDefault());
  plus.addEventListener('mousedown', (e) => e.preventDefault());
  show();
  return wrap;
}
