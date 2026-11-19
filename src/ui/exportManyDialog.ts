/**
 * Export several circuits at once (the ▾ beside Export): which of the open circuits, in which
 * format - one PDF with a page each, a PDF each, PNG or SVG images - what part of each (its page
 * frame or all its content), the zoom (fit to the page, or a fixed 25-400 %), the paper and the
 * file name. Several files go into a folder picked once where the browser can (Chrome, Edge, the
 * desktop app), else they're downloaded one after another.
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

export interface ManyOptions {
  ids: string[];
  format: ManyFormat;
  part: ManyPart;
  /** Fit to the page (images: 100 %), or a fixed zoom. */
  zoom: ExportZoomState;
  paper: ManyPaper;
  /** The combined PDF's name (without .pdf). */
  fileName: string;
  /** Several files: into a folder picked now, or as separate downloads. */
  target: 'folder' | 'downloads';
}

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
      const region: ExportRegion =
        opts.part === 'frameOrContent' && frame
          ? {
              minX: frame.minX - FRAME_PADDING,
              minY: frame.minY - FRAME_PADDING,
              maxX: frame.maxX + FRAME_PADDING,
              maxY: frame.maxY + FRAME_PADDING,
            }
          : 'auto';
      const isImage = opts.format === 'png' || opts.format === 'svg';
      const zoom = exportZoom(opts.zoom, isImage);
      if (opts.format === 'pdfOne' || opts.format === 'pdfEach') {
        const paper: PdfPaper =
          opts.paper === 'frame' ? (appState.pageFrameSize === 'a3' ? 'a3' : 'a4') : opts.paper;
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

export function openExportManyDialog(connLayer: SVGSVGElement, frameLayer: SVGSVGElement): void {
  const docs = listDocuments();
  const activeId = activeDocumentId();
  const chosen = new Set(docs.filter((d) => !isDocumentEmpty(d.id)).map((d) => d.id));
  const opts: ManyOptions = {
    ids: [],
    format: 'pdfOne',
    part: 'frameOrContent',
    zoom: { fit: true, percent: 100 },
    paper: 'frame',
    fileName: `${docs[0]?.name ?? 'circuits'} - all sheets`,
    target: directoryPicker() ? 'folder' : 'downloads',
  };

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
  dialog.append(header, body, status, buttons);

  let busy = false;

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
      tag.textContent = empty ? ' (empty)' : d.id === activeId ? ' (open now)' : '';
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

    // Area, zoom, paper.
    const pdf = opts.format === 'pdfOne' || opts.format === 'pdfEach';
    body.appendChild(heading('Area'));
    const areas = document.createElement('div');
    areas.className = 'exportRegionRow';
    for (const a of [
      { value: 'frameOrContent' as const, label: 'Page frame', hint: 'all content without one' },
      { value: 'content' as const, label: 'Whole diagram', hint: 'ignore page frames' },
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'exportRegionBtn';
      b.classList.toggle('selected', opts.part === a.value);
      b.textContent = a.label;
      b.title = a.hint;
      b.addEventListener('click', () => {
        opts.part = a.value;
        render();
      });
      areas.appendChild(b);
    }
    body.appendChild(areas);
    body.appendChild(heading('Zoom'));
    body.appendChild(
      renderExportZoom(
        opts.zoom,
        pdf
          ? opts.part === 'content'
            ? 'Fit the diagram to the page'
            : 'Fit the frame to the page'
          : 'Actual size (100 %)',
      ),
    );
    if (pdf) {
      body.appendChild(
        selectRow<ManyPaper>(
          'Paper',
          [
            { value: 'frame', label: "Each circuit's page frame size (A4 without one)" },
            { value: 'a4', label: 'A4' },
            { value: 'a3', label: 'A3' },
          ],
          opts.paper,
          (v) => (opts.paper = v),
        ),
      );
    }

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

    const n = chosen.size;
    exportBtn.textContent = n === 1 ? 'Export 1 circuit' : `Export ${n} circuits`;
    exportBtn.disabled = n === 0 || busy;
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
    if (busy) return;
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
