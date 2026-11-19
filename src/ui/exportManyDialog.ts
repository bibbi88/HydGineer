/**
 * Export several circuits at once (the ▾ beside Export): which of the open circuits, in which
 * format - one PDF with a page each, a PDF each, PNG or SVG images - what part of each (its page
 * frame or its whole diagram), the zoom (fit to the page, or a fixed 25-400 %), the paper and the
 * file name. A preview shows each page as it will come out; any circuit can be given its own
 * area, zoom and paper there. Several files go into a folder picked once where the browser can
 * (Chrome, Edge, the desktop app), else they're downloaded one after another.
 */
import { appState } from '../app/AppState';
import {
  forEachDocumentOnCanvas,
  isDocumentEmpty,
  listDocuments,
  activeDocumentId,
} from '../app/documents';
import { computeContentBounds } from '../geometry/contentBounds';
import {
  buildExportSvg,
  layoutPdfPage,
  downloadBlob,
  pdfBlob,
  pngBlob,
  renderPdfPage,
  svgBlob,
  type ExportRegion,
  type PdfPaper,
} from '../persistence/exportImage';
import { getPageFrameWorldBounds } from './pageFrame';
import { exportZoom, renderExportZoom, type ExportZoomState } from './exportZoom';

export type ManyFormat = 'pdfOne' | 'pdfEach' | 'png' | 'svg';
/** The area of each circuit: its page frame (all content without one), or all content. */
export type ManyPart = 'frameOrContent' | 'content';
export type ManyPaper = 'frame' | PdfPaper;

/** How one circuit comes out: its area, zoom and paper. */
export interface PageSettings {
  part: ManyPart;
  /** Fit to the page (images: 100 %), or a fixed zoom. */
  zoom: ExportZoomState;
  paper: ManyPaper;
}

export interface ManyOptions {
  ids: string[];
  format: ManyFormat;
  /** The settings every circuit gets... */
  common: PageSettings;
  /** ...except those given their own. */
  custom: Map<string, PageSettings>;
  /** The combined PDF's name (without .pdf). */
  fileName: string;
  /** Several files: into a folder picked now, or as separate downloads. */
  target: 'folder' | 'downloads';
}

export function settingsFor(opts: ManyOptions, id: string): PageSettings {
  return opts.custom.get(id) ?? opts.common;
}

const isPdf = (f: ManyFormat): boolean => f === 'pdfOne' || f === 'pdfEach';

/** Margin kept round a page frame's sheet - as the single export's. */
const FRAME_PADDING = 40;

function safeName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\p{Cc}/gu, '')
      .trim() || 'circuit'
  );
}

interface DirectoryHandleLike {
  getFileHandle(
    name: string,
    opts: { create: boolean },
  ): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}
type ShowDirectoryPicker = (opts?: {
  mode?: 'readwrite';
  id?: string;
}) => Promise<DirectoryHandleLike>;

function directoryPicker(): ShowDirectoryPicker | undefined {
  const pick = (window as unknown as { showDirectoryPicker?: ShowDirectoryPicker })
    .showDirectoryPicker;
  return pick?.bind(window);
}

export interface ExportResult {
  files: Array<{ name: string; blob: Blob }>;
  /** Circuits left out: nothing on them. */
  skipped: string[];
  /** Circuits whose zoom didn't fit the paper and were fitted instead. */
  shrunk: string[];
}

/** Draws each chosen circuit and makes the files - without saving them. */
export async function buildExports(
  opts: ManyOptions,
  connLayer: SVGSVGElement,
  frameLayer: SVGSVGElement,
  progress?: (done: number, total: number) => void,
): Promise<ExportResult> {
  const result: ExportResult = { files: [], skipped: [], shrunk: [] };
  const pages: NonNullable<Awaited<ReturnType<typeof renderPdfPage>>>[] = [];
  const used = new Set<string>();
  const fileName = (base: string, ext: string): string => {
    let n = `${safeName(base)}.${ext}`;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${safeName(base)} (${i}).${ext}`;
    used.add(n.toLowerCase());
    return n;
  };
  const only = new Set(opts.ids);
  let done = 0;
  await forEachDocumentOnCanvas(async (doc) => {
    const frame = getPageFrameWorldBounds();
    if (computeContentBounds() === null && frame === null) {
      result.skipped.push(doc.name);
    } else {
      const set = settingsFor(opts, doc.id);
      const region: ExportRegion =
        set.part === 'frameOrContent' && frame
          ? {
              minX: frame.minX - FRAME_PADDING,
              minY: frame.minY - FRAME_PADDING,
              maxX: frame.maxX + FRAME_PADDING,
              maxY: frame.maxY + FRAME_PADDING,
            }
          : 'auto';
      const isImage = opts.format === 'png' || opts.format === 'svg';
      const zoom = exportZoom(set.zoom, isImage);
      if (opts.format === 'pdfOne' || opts.format === 'pdfEach') {
        const paper: PdfPaper =
          set.paper === 'frame' ? (appState.pageFrameSize === 'a3' ? 'a3' : 'a4') : set.paper;
        const page = await renderPdfPage(doc.name, connLayer, frameLayer, region, paper, zoom);
        if (page) {
          if (page.shrunk) result.shrunk.push(doc.name);
          if (opts.format === 'pdfOne') pages.push(page);
          else result.files.push({ name: fileName(doc.name, 'pdf'), blob: pdfBlob([page]) });
        }
      } else if (opts.format === 'png') {
        const blob = await pngBlob(connLayer, frameLayer, region, zoom ?? 1);
        if (blob) result.files.push({ name: fileName(doc.name, 'png'), blob });
      } else {
        result.files.push({
          name: fileName(doc.name, 'svg'),
          blob: svgBlob(connLayer, frameLayer, region, zoom ?? 1),
        });
      }
    }
    progress?.(++done, only.size);
  }, only);
  if (opts.format === 'pdfOne' && pages.length > 0) {
    result.files.push({ name: `${safeName(opts.fileName)}.pdf`, blob: pdfBlob(pages) });
  }
  return result;
}

/** Saves the files: a single one (or with `target` 'downloads') as downloads, several into a
 * folder picked now. Whether they were saved (false: the folder picker was cancelled). */
export async function saveExports(
  files: ExportResult['files'],
  target: ManyOptions['target'],
): Promise<boolean> {
  const pick = directoryPicker();
  if (files.length > 1 && target === 'folder' && pick) {
    let dir: DirectoryHandleLike;
    try {
      dir = await pick({ mode: 'readwrite', id: 'hydgineer-export' });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false;
      return saveExports(files, 'downloads');
    }
    for (const f of files) {
      const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable();
      await w.write(f.blob);
      await w.close();
    }
    return true;
  }
  for (const [i, f] of files.entries()) {
    // A short pause between downloads: browsers drop some if they come all at once.
    if (i > 0) await new Promise((r) => setTimeout(r, 250));
    downloadBlob(f.blob, f.name);
  }
  return true;
}

function radio(
  name: string,
  value: string,
  label: string,
  checked: boolean,
  onChange: () => void,
): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'exportManyChoice';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.addEventListener('change', onChange);
  const span = document.createElement('span');
  span.textContent = label;
  row.append(input, span);
  return row;
}

function selectRow<T extends string>(
  label: string,
  options: Array<{ value: T; label: string }>,
  value: T,
  onChange: (v: T) => void,
): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'inspectorRow';
  const span = document.createElement('span');
  span.textContent = label;
  const select = document.createElement('select');
  for (const o of options) select.append(new Option(o.label, o.value));
  select.value = value;
  select.addEventListener('change', () => onChange(select.value as T));
  row.append(span, select);
  return row;
}

function heading(text: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'inspectorSectionHeading';
  h.textContent = text;
  return h;
}

/** A circuit as drawn for the preview: its page frame's area (if it has one) and its whole
 * diagram, and the frame's paper. */
interface Captured {
  id: string;
  name: string;
  frameSvg: SVGSVGElement | null;
  contentSvg: SVGSVGElement | null;
  framePaper: PdfPaper;
}

/** Draws each circuit in `ids` once, for the preview (puts each on the canvas in turn). */
async function capture(
  ids: Set<string>,
  connLayer: SVGSVGElement,
  frameLayer: SVGSVGElement,
): Promise<Map<string, Captured>> {
  const out = new Map<string, Captured>();
  await forEachDocumentOnCanvas(async (doc) => {
    const frame = getPageFrameWorldBounds();
    const content = computeContentBounds() !== null;
    out.set(doc.id, {
      id: doc.id,
      name: doc.name,
      frameSvg: frame
        ? buildExportSvg(connLayer, frameLayer, {
            minX: frame.minX - FRAME_PADDING,
            minY: frame.minY - FRAME_PADDING,
            maxX: frame.maxX + FRAME_PADDING,
            maxY: frame.maxY + FRAME_PADDING,
          })
        : null,
      contentSvg: content ? buildExportSvg(connLayer, frameLayer, 'auto') : null,
      framePaper: appState.pageFrameSize === 'a3' ? 'a3' : 'a4',
    });
  }, ids);
  return out;
}

/** Size of a preview page, px. */
const THUMB = 150;

/** One page of the preview: the paper (PDF) or the image, the drawing placed as it will be,
 * and a line saying how - paper, orientation, zoom. */
export function renderThumb(
  cap: Captured,
  set: PageSettings,
  format: ManyFormat,
): { el: HTMLElement; caption: string } {
  const svg =
    set.part === 'frameOrContent' && cap.frameSvg ? cap.frameSvg : (cap.contentSvg ?? cap.frameSvg);
  const box = document.createElement('div');
  box.className = 'exportThumbPaper';
  if (!svg) return { el: box, caption: 'Empty' };
  const w = Number(svg.getAttribute('width')) || 1;
  const h = Number(svg.getAttribute('height')) || 1;
  const img = svg.cloneNode(true) as SVGSVGElement;
  img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  let caption: string;
  if (isPdf(format)) {
    const paper: PdfPaper = set.paper === 'frame' ? cap.framePaper : set.paper;
    const fit = set.zoom.fit;
    const page = layoutPdfPage(paper, w / h, exportZoom(set.zoom), w);
    const k = THUMB / Math.max(page.width, page.height);
    box.style.width = `${page.width * k}px`;
    box.style.height = `${page.height * k}px`;
    const r = page.imageRect;
    img.setAttribute('width', String(r.w * k));
    img.setAttribute('height', String(r.h * k));
    img.style.left = `${r.x * k}px`;
    img.style.top = `${r.y * k}px`;
    caption =
      `${paper.toUpperCase()} ${page.width > page.height ? 'landscape' : 'portrait'} · ` +
      (fit ? 'fit to page' : `${set.zoom.percent} %`) +
      (page.shrunk ? ' - too large, fitted' : '');
  } else {
    const z = exportZoom(set.zoom, true) ?? 1;
    const k = THUMB / Math.max(w, h);
    box.style.width = `${w * k}px`;
    box.style.height = `${h * k}px`;
    img.setAttribute('width', String(w * k));
    img.setAttribute('height', String(h * k));
    img.style.left = '0';
    img.style.top = '0';
    caption = `${Math.round(w * z)} × ${Math.round(h * z)} px`;
  }
  box.appendChild(img);
  return { el: box, caption };
}

export function openExportManyDialog(connLayer: SVGSVGElement, frameLayer: SVGSVGElement): void {
  const docs = listDocuments();
  const activeId = activeDocumentId();
  const chosen = new Set(docs.filter((d) => !isDocumentEmpty(d.id)).map((d) => d.id));
  const opts: ManyOptions = {
    ids: [],
    format: 'pdfOne',
    // Defaults: each page frame (the whole diagram without one), fitted to its page, on the
    // frame's own paper.
    common: { part: 'frameOrContent', zoom: { fit: true, percent: 100 }, paper: 'frame' },
    custom: new Map(),
    fileName: `${docs[0]?.name ?? 'circuits'} - all sheets`,
    target: directoryPicker() ? 'folder' : 'downloads',
  };
  /** The preview's drawings, once made. */
  let captured: Map<string, Captured> | null = null;
  let previewOpen = false;
  let capturing = false;
  /** The circuit selected in the preview, whose own settings show under it. */
  let selected: string | null = null;

  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && !busy) close();
  });
  const dialog = document.createElement('div');
  dialog.className = 'exportDialog exportManyDialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Export several circuits');
  backdrop.appendChild(dialog);

  const header = document.createElement('div');
  header.className = 'exportDialogHeader';
  const title = document.createElement('h2');
  title.textContent = 'Export several circuits';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'exportDialogClose';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', () => close());
  header.append(title, closeBtn);

  const body = document.createElement('div');
  const previewEl = document.createElement('div');
  previewEl.className = 'exportPreviewSection';
  const status = document.createElement('p');
  status.className = 'exportDialogHint';
  status.setAttribute('role', 'status');

  const buttons = document.createElement('div');
  buttons.className = 'exportDialogButtons';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => close());
  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn btnPrimary';
  buttons.append(cancelBtn, exportBtn);
  dialog.append(header, body, previewEl, status, buttons);

  let busy = false;

  /** Area buttons, zoom and paper for `set` - the common settings or one circuit's own. */
  function settingsControls(set: PageSettings, onChange: () => void): HTMLElement[] {
    const pdf = isPdf(opts.format);
    const areas = document.createElement('div');
    areas.className = 'exportRegionRow';
    for (const a of [
      {
        value: 'frameOrContent' as const,
        label: 'Page frame',
        hint: 'the whole diagram without one',
      },
      { value: 'content' as const, label: 'Whole diagram', hint: 'ignore page frames' },
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'exportRegionBtn';
      b.classList.toggle('selected', set.part === a.value);
      b.textContent = a.label;
      b.title = a.hint;
      b.addEventListener('click', () => {
        set.part = a.value;
        render();
      });
      areas.appendChild(b);
    }
    const out: HTMLElement[] = [heading('Area'), areas, heading('Zoom')];
    out.push(
      renderExportZoom(
        set.zoom,
        pdf
          ? set.part === 'content'
            ? 'Fit the diagram to the page'
            : 'Fit the frame to the page'
          : 'Actual size (100 %)',
        onChange,
      ),
    );
    if (pdf) {
      out.push(
        selectRow<ManyPaper>(
          'Paper',
          [
            { value: 'frame', label: "The page frame's size (A4 without one)" },
            { value: 'a4', label: 'A4' },
            { value: 'a3', label: 'A3' },
          ],
          set.paper,
          (v) => {
            set.paper = v;
            renderPreview();
          },
        ),
      );
    }
    return out;
  }

  function render(): void {
    body.replaceChildren();

    // Which circuits.
    const circuitsHead = heading('Circuits');
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'linkBtn';
    all.textContent = 'All';
    all.addEventListener('click', () => {
      for (const d of docs) if (!isDocumentEmpty(d.id)) chosen.add(d.id);
      render();
    });
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'linkBtn';
    none.textContent = 'None';
    none.addEventListener('click', () => {
      chosen.clear();
      render();
    });
    circuitsHead.append(' ', all, ' · ', none);
    body.appendChild(circuitsHead);
    const list = document.createElement('div');
    list.className = 'exportManyList';
    for (const d of docs) {
      const empty = isDocumentEmpty(d.id);
      const row = document.createElement('label');
      row.className = 'exportManyChoice';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = chosen.has(d.id);
      box.disabled = empty;
      box.addEventListener('change', () => {
        if (box.checked) chosen.add(d.id);
        else chosen.delete(d.id);
        render();
      });
      const span = document.createElement('span');
      span.textContent = d.name;
      const tag = document.createElement('small');
      tag.textContent = empty
        ? ' (empty)'
        : opts.custom.has(d.id)
          ? ' (own settings)'
          : d.id === activeId
            ? ' (open now)'
            : '';
      span.appendChild(tag);
      row.append(box, span);
      list.appendChild(row);
    }
    body.appendChild(list);

    // Format.
    body.appendChild(heading('Format'));
    const formats: Array<{ value: ManyFormat; label: string }> = [
      { value: 'pdfOne', label: 'PDF - one file, a page per circuit' },
      { value: 'pdfEach', label: 'PDF - a file per circuit' },
      { value: 'png', label: 'PNG images - a file per circuit' },
      { value: 'svg', label: 'SVG drawings - a file per circuit' },
    ];
    for (const f of formats) {
      body.appendChild(
        radio('exportManyFormat', f.value, f.label, opts.format === f.value, () => {
          opts.format = f.value;
          render();
        }),
      );
    }

    // The common settings.
    const commonHead = heading(opts.custom.size > 0 ? 'All other circuits' : 'Every circuit');
    commonHead.classList.add('exportManyGroupHead');
    body.append(commonHead, ...settingsControls(opts.common, renderPreview));

    // File name / where.
    if (opts.format === 'pdfOne') {
      const row = document.createElement('label');
      row.className = 'inspectorRow';
      const span = document.createElement('span');
      span.textContent = 'File name';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = opts.fileName;
      input.addEventListener('input', () => (opts.fileName = input.value));
      row.append(span, input);
      body.appendChild(row);
    } else if (directoryPicker()) {
      body.appendChild(heading('Save'));
      body.appendChild(
        radio(
          'exportManyTarget',
          'folder',
          'Into a folder I choose',
          opts.target === 'folder',
          () => {
            opts.target = 'folder';
          },
        ),
      );
      body.appendChild(
        radio(
          'exportManyTarget',
          'downloads',
          'As separate downloads',
          opts.target === 'downloads',
          () => {
            opts.target = 'downloads';
          },
        ),
      );
    } else {
      const note = document.createElement('p');
      note.className = 'inspectorHint';
      note.textContent =
        'Each file is downloaded on its own - the browser may ask once to allow several downloads.';
      body.appendChild(note);
    }

    renderPreview();
    const n = chosen.size;
    exportBtn.textContent = n === 1 ? 'Export 1 circuit' : `Export ${n} circuits`;
    exportBtn.disabled = n === 0 || busy || capturing;
  }

  /** The preview: a page per chosen circuit, as it will come out; click one to give it its own
   * settings. */
  function renderPreview(): void {
    previewEl.replaceChildren();
    const head = heading('Preview');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'linkBtn';
    toggle.textContent = previewOpen ? 'Hide' : 'Show the pages';
    toggle.addEventListener('click', () => {
      previewOpen = !previewOpen;
      if (previewOpen && !captured) void loadPreview();
      else renderPreview();
    });
    head.append(' ', toggle);
    previewEl.appendChild(head);
    if (!previewOpen) {
      const hint = document.createElement('p');
      hint.className = 'inspectorHint';
      hint.textContent =
        'See each page before exporting - and give any circuit its own area, zoom or paper.';
      previewEl.appendChild(hint);
      return;
    }
    if (!captured) {
      const p = document.createElement('p');
      p.className = 'inspectorHint';
      p.textContent = 'Preparing the preview…';
      previewEl.appendChild(p);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'exportThumbs';
    const ids = docs.filter((d) => chosen.has(d.id)).map((d) => d.id);
    for (const id of ids) {
      const cap = captured.get(id);
      if (!cap) continue;
      const own = opts.custom.has(id);
      const { el, caption } = renderThumb(cap, settingsFor(opts, id), opts.format);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'exportThumb';
      item.classList.toggle('selected', selected === id);
      item.title = 'Click to give this circuit its own settings';
      const name = document.createElement('b');
      name.textContent = cap.name;
      const small = document.createElement('small');
      small.textContent = caption + (own ? ' · own settings' : '');
      item.append(el, name, small);
      item.addEventListener('click', () => {
        selected = selected === id ? null : id;
        renderPreview();
      });
      grid.appendChild(item);
    }
    if (ids.length === 0) {
      const p = document.createElement('p');
      p.className = 'inspectorHint';
      p.textContent = 'No circuits chosen.';
      previewEl.appendChild(p);
    }
    previewEl.appendChild(grid);

    // The selected circuit's own settings.
    if (selected && chosen.has(selected)) {
      const id = selected;
      const panel = document.createElement('div');
      panel.className = 'exportOwnSettings';
      const row = document.createElement('label');
      row.className = 'exportManyChoice';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = opts.custom.has(id);
      box.addEventListener('change', () => {
        if (box.checked) {
          const c = opts.common;
          opts.custom.set(id, { part: c.part, zoom: { ...c.zoom }, paper: c.paper });
        } else opts.custom.delete(id);
        render();
      });
      const label = document.createElement('b');
      label.textContent = `Own settings for “${captured.get(id)?.name ?? ''}”`;
      row.append(box, label);
      panel.appendChild(row);
      const own = opts.custom.get(id);
      if (own) panel.append(...settingsControls(own, renderPreview));
      previewEl.appendChild(panel);
    }
  }

  async function loadPreview(): Promise<void> {
    capturing = true;
    render();
    try {
      const all = new Set(docs.filter((d) => !isDocumentEmpty(d.id)).map((d) => d.id));
      captured = await capture(all, connLayer, frameLayer);
    } finally {
      capturing = false;
      if (backdrop.isConnected) render();
    }
  }

  exportBtn.addEventListener('click', () => {
    void (async () => {
      busy = true;
      render();
      opts.ids = docs.filter((d) => chosen.has(d.id)).map((d) => d.id);
      try {
        const result = await buildExports(opts, connLayer, frameLayer, (done, total) => {
          status.textContent = `Exporting ${done} of ${total}…`;
        });
        if (result.files.length === 0) {
          status.textContent = 'Nothing to export - the chosen circuits are empty.';
          return;
        }
        if (!(await saveExports(result.files, opts.target))) {
          status.textContent = '';
          return;
        }
        busy = false;
        close();
      } catch (err) {
        status.textContent = `Export failed: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        busy = false;
        if (backdrop.isConnected) render();
      }
    })();
  });

  function close(): void {
    if (busy || capturing) return;
    backdrop.remove();
    window.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  window.addEventListener('keydown', onKeydown);

  render();
  document.body.appendChild(backdrop);
}
