import { appState } from '../app/AppState';
import { createSvgEl } from '../components/shared/svgHelpers';
import { computeContentBounds, type WorldBounds } from '../geometry/contentBounds';
import { fitViewToWorldRect } from '../interaction/fitViewToBounds';
import type { ProjectBarRefs } from './projectBar';
import type { ViewportAdapter } from './viewport';

export type PageFrameSize = 'none' | 'a4' | 'a3';

/** World-space sheet sizes - this app has no other notion of a physical unit (component
 * dimensions are just arbitrary SVG px), so these are chosen to comfortably frame a typical
 * small-to-medium circuit rather than to convert real A4/A3 millimeters exactly. A3 is close to
 * (not exactly) root-2 bigger than A4 in both dimensions, same as the real sheet sizes are. 2x
 * their original size (900x640 / 1270x900) - those were sized just for A3 to fit on-screen at
 * the viewport's minimum zoom, but a real diagram (several valves/cylinders plus wiring) needs
 * more room than that inside the sheet; doubling still leaves plenty of margin against
 * MIN_SCALE (ui/viewport.ts) fitting A3 on a modest window, just zoomed further out. */
const PAGE_FRAME_SIZES: Record<Exclude<PageFrameSize, 'none'>, { w: number; h: number; label: string }> = {
  a4: { w: 1800, h: 1280, label: 'A4 · 297 × 210 mm' },
  a3: { w: 2540, h: 1800, label: 'A3 · 420 × 297 mm' },
};

// Tighter than zoomToFit's own default (60px) - the sheet itself is already a generous margin
// around the diagram, so it doesn't need as much extra breathing room again around *it*.
const FRAME_FIT_PADDING_PX = 30;

const TITLE_BLOCK_W = 320;
const TITLE_LABEL_COL_W = 96;
const TITLE_ROW_H = 26;
const TITLE_ROWS = 5;
const TITLE_BLOCK_H = TITLE_ROW_H * TITLE_ROWS;

let frameLayerEl: SVGElement | null = null;
let projectBarRef: ProjectBarRefs | null = null;
let viewportRef: ViewportAdapter | null = null;
let workspaceElRef: HTMLElement | null = null;

/** Wires up the layer this module draws into, the project-bar accessor it reads the project name
 * from (see ui/projectBar.ts - the name lives there, not on AppState, since the sidebar shows it
 * directly), and the viewport it re-frames when a sheet size is picked. Call once at startup,
 * then `renderPageFrame()` on any later change. */
export function initPageFrame(
  frameLayer: SVGElement,
  projectBar: ProjectBarRefs,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): void {
  frameLayerEl = frameLayer;
  projectBarRef = projectBar;
  viewportRef = viewport;
  workspaceElRef = workspaceEl;
  renderPageFrame();
}

/** The current sheet's own world-space rect, or null while the frame is off ('none') - the same
 * rect `renderPageFrame` draws and `setPageFrameSize` fits the view to, exposed for
 * persistence/exportImage.ts's "export the page frame" crop option. */
export function getPageFrameWorldBounds(): WorldBounds | null {
  const size = appState.pageFrameSize;
  if (size === 'none') return null;
  const dims = PAGE_FRAME_SIZES[size];
  return {
    minX: appState.pageFrameX - dims.w / 2,
    minY: appState.pageFrameY - dims.h / 2,
    maxX: appState.pageFrameX + dims.w / 2,
    maxY: appState.pageFrameY + dims.h / 2,
  };
}

function textEl(x: number, y: number, text: string, cls: string): SVGTextElement {
  const t = createSvgEl('text', { x, y, class: cls });
  t.textContent = text;
  return t;
}

/** Redraws the sheet outline + title block from the current AppState - call after anything that
 * could change what it shows (the size picker, any project-info field, or a project load). Draws
 * nothing at all for 'none', same as the grid does for "show grid" off. */
export function renderPageFrame(): void {
  if (!frameLayerEl) return;
  frameLayerEl.replaceChildren();

  const size = appState.pageFrameSize;
  if (size === 'none') return;
  const dims = PAGE_FRAME_SIZES[size];
  const x = appState.pageFrameX - dims.w / 2;
  const y = appState.pageFrameY - dims.h / 2;

  frameLayerEl.append(
    createSvgEl('rect', { x, y, width: dims.w, height: dims.h, class: 'pageFrameRect' }),
    textEl(x + 16, y + 28, dims.label, 'pageFrameLabel'),
  );

  // Title block: the classic bottom-right corner box, same fields as the inspector's own
  // "Project info" section (ui/inspector.ts) so this is always exactly what that panel shows -
  // drawn as an actual grid of cells (a label column, a value column, one row per field) rather
  // than just floating text, matching a real drawing's title block.
  const bx = x + dims.w - TITLE_BLOCK_W;
  const by = y + dims.h - TITLE_BLOCK_H;
  frameLayerEl.appendChild(
    createSvgEl('rect', {
      x: bx,
      y: by,
      width: TITLE_BLOCK_W,
      height: TITLE_BLOCK_H,
      class: 'pageFrameTitleBlock',
    }),
  );

  const rows: Array<[string, string]> = [
    ['Project', projectBarRef?.getName() ?? ''],
    ['Date', appState.projectDate],
    ['Company', appState.projectCompany],
    ['Author', appState.projectAuthor],
    ['Checked by', appState.projectCheckedBy],
  ];
  rows.forEach(([label, value], i) => {
    const rowTop = by + i * TITLE_ROW_H;
    const textY = rowTop + TITLE_ROW_H / 2 + 4;
    if (i > 0) {
      frameLayerEl?.appendChild(
        createSvgEl('line', {
          x1: bx,
          y1: rowTop,
          x2: bx + TITLE_BLOCK_W,
          y2: rowTop,
          class: 'pageFrameGridLine',
        }),
      );
    }
    frameLayerEl?.append(
      textEl(bx + 10, textY, `${label}:`, 'pageFrameTitleLabel'),
      textEl(bx + TITLE_LABEL_COL_W + 10, textY, value, 'pageFrameTitleValue'),
    );
  });
  frameLayerEl.appendChild(
    createSvgEl('line', {
      x1: bx + TITLE_LABEL_COL_W,
      y1: by,
      x2: bx + TITLE_LABEL_COL_W,
      y2: by + TITLE_BLOCK_H,
      class: 'pageFrameGridLine',
    }),
  );
}

/** Sets the sheet size and, for an actual sheet (not 'none'), recenters it on the current
 * diagram's own content bounds - then it stays put from there, rather than continuously
 * following the diagram around like a camera would (see PageFrame's own schema doc). Switching
 * between A4 and A3 re-centers the same way, so the sheet always wraps whatever's on the canvas
 * right now rather than keeping some earlier, possibly stale, center. Also pans/zooms the view to
 * the new sheet, same as "Zoom to fit" does for content - otherwise a sheet this much bigger than
 * the current view would land mostly (or entirely) off-screen the moment it's picked. */
export function setPageFrameSize(size: PageFrameSize): void {
  appState.pageFrameSize = size;
  if (size !== 'none') {
    const bounds = computeContentBounds();
    const cx = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
    const cy = bounds ? (bounds.minY + bounds.maxY) / 2 : 0;
    appState.pageFrameX = cx;
    appState.pageFrameY = cy;

    if (viewportRef && workspaceElRef) {
      const bounds = getPageFrameWorldBounds();
      if (bounds) fitViewToWorldRect(viewportRef, workspaceElRef, bounds, FRAME_FIT_PADDING_PX);
    }
  }
  renderPageFrame();
}
