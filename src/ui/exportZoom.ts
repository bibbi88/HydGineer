/**
 * The exports' zoom: fit the chosen area to the page, or a fixed zoom set with a slider between
 * − and + buttons, its value shown beside it (25-400 %). For an image there's no page: "fit"
 * then means the drawing at 100 %.
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
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(ZOOM_MIN);
  slider.max = String(ZOOM_MAX);
  slider.step = String(STEP);
  slider.className = 'exportZoomSlider';
  slider.setAttribute('aria-label', 'Zoom level');
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'exportZoomStep';
  plus.textContent = '+';
  plus.setAttribute('aria-label', 'Zoom in');
  const value = document.createElement('span');
  value.className = 'exportZoomValue';
  zoomRow.append(zoomInput, minus, slider, plus, value);
  wrap.append(fitRow, zoomRow);

  function show(): void {
    fitInput.checked = state.fit;
    zoomInput.checked = !state.fit;
    slider.value = String(state.percent);
    value.textContent = `${state.percent} %`;
    wrap.classList.toggle('exportZoom--fit', state.fit);
  }
  function set(percent: number): void {
    state.percent = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(percent / STEP) * STEP));
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
  slider.addEventListener('input', () => set(Number(slider.value)));
  minus.addEventListener('click', () => set(state.percent - STEP));
  plus.addEventListener('click', () => set(state.percent + STEP));
  show();
  return wrap;
}
