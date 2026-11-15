/**
 * The component library (left) and the inspector (right) can be made wider or narrower by
 * dragging their inner edge; double-clicking the edge puts the default back. The widths are a
 * personal preference, kept in this browser rather than in any project.
 */

const STORAGE_KEY = 'hydgineer.panelWidths';
const MIN_WIDTH = 180;
const MAX_WIDTH = 560;

type Side = 'library' | 'inspector';

const DEFAULTS: Record<Side, number> = { library: 244, inspector: 260 };
const CSS_VAR: Record<Side, string> = { library: '--library-w', inspector: '--inspector-w' };

function load(): Partial<Record<Side, number>> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<Side, number>>;
  } catch {
    return {};
  }
}

function clamp(w: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));
}

export function initPanelResize(app: HTMLElement): void {
  const widths: Record<Side, number> = { ...DEFAULTS };
  const saved = load();
  for (const side of ['library', 'inspector'] as const) {
    const w = saved[side];
    if (typeof w === 'number' && Number.isFinite(w)) widths[side] = clamp(w);
  }

  function apply(): void {
    for (const side of ['library', 'inspector'] as const) {
      app.style.setProperty(CSS_VAR[side], `${widths[side]}px`);
    }
  }
  function store(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
    } catch {
      // Storage unavailable: the widths still hold for this visit.
    }
  }
  apply();

  for (const side of ['library', 'inspector'] as const) {
    const handle = document.createElement('div');
    handle.className = `panelResizer panelResizer--${side}`;
    handle.title = 'Drag to resize - double-click for the default width';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', side === 'library' ? 'Library width' : 'Inspector width');

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = widths[side];
      document.body.classList.add('panelResizing');
      function onMove(ev: MouseEvent): void {
        // The library grows to the right, the inspector to the left.
        const dx = ev.clientX - startX;
        widths[side] = clamp(side === 'library' ? startW + dx : startW - dx);
        apply();
      }
      function onUp(): void {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.classList.remove('panelResizing');
        store();
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    handle.addEventListener('dblclick', () => {
      widths[side] = DEFAULTS[side];
      apply();
      store();
    });
    app.appendChild(handle);
  }
}
