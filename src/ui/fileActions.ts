import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from './viewport';
import type { ProjectFileV1 } from '../persistence/schema';
import { appState } from '../app/AppState';
import { stopSimulation } from '../sim/stopSimulation';
import { getDeviceId } from '../app/deviceId';
import { desktopBridge, fileBaseName, type DesktopFile } from '../app/desktopBridge';
import {
  activeDocumentId,
  forEachDocumentOnCanvas,
  listDocuments,
  markDocumentSaved,
  onDocumentsChange,
  prepareToOpen,
  setActiveDocumentPath,
  renameDocument,
  setDocumentPath,
  snapshotDocuments,
  switchDocument,
  unsavedDocuments,
  updateDocumentFile,
} from '../app/documents';
import { resetHistory } from '../history/historyStore';
import { loadProject, serializeProject, unixNow } from '../persistence/project';
import { migrate } from '../persistence/migrations';
import {
  documentNameFor,
  fileHandles,
  handleForPath,
  installDesktopSavePicker,
  saveDocument,
} from '../persistence/save';
import { getLastProjectFile } from '../persistence/fileHandle';
import type { FileHandleLike } from '../persistence/save';
import { showToast } from './toast';
import { setDocumentSaver } from '../app/saveCommand';
import { loadProjectFromPicker } from '../persistence/load';
import { downloadPdf, renderPdfPage, type PdfPaper } from '../persistence/exportImage';
import { getPageFrameWorldBounds } from './pageFrame';
import { forgetRecentFile, listRecentFiles, rememberRecentFile } from '../app/recentFiles';
import {
  forgetRecentHandle,
  listRecentHandles,
  rememberRecentHandle,
  type FileHandleRef,
} from '../app/recentHandles';
import { closeStartScreen } from './startScreen';
import { computeContentBounds } from '../geometry/contentBounds';

/** A recently opened or saved file: its name, where it is (if known), when, and how to open it. */
export interface RecentEntry {
  name: string;
  detail: string;
  at: number;
  open(): Promise<boolean>;
}

export interface FileActionDeps {
  ctx: ComponentFactoryContext;
  viewport: ViewportAdapter;
  connLayer: SVGSVGElement;
  frameLayer: SVGSVGElement;
  getName(): string;
  setName(name: string): void;
}

export interface FileActions {
  /** Save: back to the circuit's file without asking, once it has one (else as Save as).
   * Whether it was saved. */
  save(): Promise<boolean>;
  /** Save as: a new file, picked now - later Saves go there. */
  saveAs(): Promise<boolean>;
  /** Saves document `id` (Save), e.g. before closing it. */
  saveDocumentById(id: string): Promise<boolean>;
  saveAll(): Promise<void>;
  open(): Promise<void>;
  /** Desktop only: a recent file by its path; whether it opened. */
  openRecent(path: string): Promise<boolean>;
  /** The most recently opened or saved files, for the Open button's menu. */
  recentFiles(max?: number): Promise<RecentEntry[]>;
  exportAllSheets(): Promise<void>;
  isDesktop: boolean;
}

/** Margin round a page frame's sheet in an exported page - as the export dialog's. */
const FRAME_EXPORT_PADDING = 40;

function safeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\p{Cc}/gu, '')
      .trim() || 'project'
  );
}

/** `file` as saved by this browser, now. */
function stamped(file: ProjectFileV1): ProjectFileV1 {
  return { ...file, LS: getDeviceId(), lst: unixNow() };
}

function json(file: ProjectFileV1): string {
  return JSON.stringify(file, null, 2);
}

function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The active document has just been saved as `file`: what's on the canvas carries the stamps. */
function commitActiveSaved(file: ProjectFileV1): void {
  appState.projectLastSavedDeviceId = file.LS ?? null;
  appState.projectLastSavedAt = file.lst ?? null;
}

interface DirectoryHandleLike {
  getFileHandle(
    name: string,
    opts: { create: boolean },
  ): Promise<{
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  }>;
}
type ShowDirectoryPicker = (opts?: { mode?: 'readwrite' }) => Promise<DirectoryHandleLike>;

/**
 * Save, Save as, Save all, Open and Export all sheets - for the toolbar's buttons and their ▾
 * menus, and Ctrl+S / Ctrl+Shift+S / Ctrl+O. In the desktop app they work on files on disk, as
 * a desktop program does: Open uses the computer's own dialog, Save writes back to the file a
 * circuit came from. In the browser, Save downloads (or uses the browser's save dialog), as
 * before.
 */
export function createFileActions(deps: FileActionDeps): FileActions {
  const bridge = desktopBridge();

  function openText(text: string, path?: string): void {
    // Already open: just show it.
    if (path) {
      const open = listDocuments().find((d) => d.path === path);
      if (open) {
        switchDocument(open.id);
        return;
      }
    }
    const file = migrate(JSON.parse(text));
    if (prepareToOpen() === 'current') resetHistory();
    loadProject(file, deps.ctx, deps.viewport);
    deps.setName(path ? fileBaseName(path) : file.name || 'project');
    setActiveDocumentPath(path);
    if (path) fileHandles.set(activeDocumentId(), handleForPath(path));
    else fileHandles.delete(activeDocumentId());
    // Just as in its file: nothing to save yet.
    markDocumentSaved(activeDocumentId(), serializeProject(deps.getName()));
  }

  function openFromOutside(f: DesktopFile): void {
    closeStartScreen();
    try {
      openText(f.text, f.path);
      rememberRecentFile(f.path);
    } catch (err) {
      window.alert(`Couldn't open ${f.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Saves document `id` - the circuit on the canvas, or one in another tab - through
   * persistence/save.ts: back to its file, or to one picked now (`asNew`: always picked), or as
   * a download where the page can't write files. Whether it was saved.
   */
  async function saveDoc(id: string, asNew = false): Promise<boolean> {
    // A file holds the circuit at rest, never mid-run.
    stopSimulation();
    syncHandles();
    // One never saved is shown before asking where - so it's clear which one.
    if (id !== activeDocumentId() && (asNew || !fileHandles.has(id))) switchDocument(id);
    const isActive = id === activeDocumentId();
    const kept = isActive ? null : snapshotDocuments().find((d) => d.id === id);
    if (!isActive && !kept) return false;
    const name = isActive ? deps.getName() : kept!.name;
    const hadFile = fileHandles.has(id) && !asNew;
    let file: ProjectFileV1 | null = null;
    const outcome = await saveDocument({
      docId: id,
      name: safeFileName(name),
      asNew,
      text: () => {
        file = stamped(isActive ? serializeProject(deps.getName()) : kept!.file);
        return json(file);
      },
    });
    if (outcome.kind === 'cancelled' || !file) return false;
    const saved: ProjectFileV1 = file;
    markDocumentSaved(id, saved);
    if (id === activeDocumentId()) commitActiveSaved(saved);
    else updateDocumentFile(id, saved);
    if (outcome.kind === 'written') {
      const path = outcome.handle.path;
      if (path) {
        setDocumentPath(id, path);
        rememberRecentFile(path);
      } else void rememberRecentHandle(outcome.handle);
      // A newly picked file names the circuit, as in a desktop program.
      if (!hadFile) {
        const base = documentNameFor(outcome.fileName);
        if (base && base !== name) renameDocument(id, base);
      }
      showToast(`Saved ${outcome.fileName}`);
    } else showToast(`Downloaded ${outcome.fileName}`);
    return true;
  }

  const save = (): Promise<boolean> => saveDoc(activeDocumentId());
  const saveAs = (): Promise<boolean> => saveDoc(activeDocumentId(), true);

  /**
   * Keeps the file handles in step with the documents: a closed document's handle goes; in the
   * desktop app a document's file is its path (kept across restarts), so one with a path gets a
   * handle writing there, and one whose path was cleared (an example opened into it) loses it.
   */
  function syncHandles(): void {
    const docs = listDocuments();
    for (const id of [...fileHandles.keys()]) {
      if (!docs.some((d) => d.id === id)) fileHandles.delete(id);
    }
    if (!bridge) return;
    for (const d of docs) {
      const h = fileHandles.get(d.id);
      if (d.path && h?.path !== d.path) fileHandles.set(d.id, handleForPath(d.path));
      else if (!d.path && h?.path) fileHandles.delete(d.id);
    }
  }
  if (bridge) installDesktopSavePicker();
  setDocumentSaver((id) => saveDoc(id));
  onDocumentsChange(syncHandles);
  syncHandles();

  async function saveAll(): Promise<void> {
    // A file holds the circuit at rest, never mid-run.
    stopSimulation();
    if (bridge) {
      await saveDocumentsDesktop();
      return;
    }
    const docs = snapshotDocuments();
    const activeId = activeDocumentId();

    // Browser: into a folder chosen once, where the browser can (Chrome, Edge); else each one
    // downloaded.
    const files = docs.map((d) => ({ doc: d, file: stamped(d.file) }));
    const names = new Set<string>();
    const nameFor = (name: string): string => {
      let n = `${safeFileName(name)}.hgcl`;
      for (let i = 2; names.has(n.toLowerCase()); i++) n = `${safeFileName(name)} (${i}).hgcl`;
      names.add(n.toLowerCase());
      return n;
    };
    const pickDir = (window as unknown as { showDirectoryPicker?: ShowDirectoryPicker })
      .showDirectoryPicker;
    if (pickDir) {
      let dir: DirectoryHandleLike;
      try {
        dir = await pickDir({ mode: 'readwrite' });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        dir = null as unknown as DirectoryHandleLike;
      }
      if (dir) {
        for (const { file } of files) {
          const handle = await dir.getFileHandle(nameFor(file.name), { create: true });
          const w = await handle.createWritable();
          await w.write(json(file));
          await w.close();
        }
        markSaved(files, activeId);
        return;
      }
    }
    for (const { file } of files) downloadText(json(file), nameFor(file.name));
    markSaved(files, activeId);
  }

  /** Desktop: saves the open documents - only those in `only`, if given - each back to its own
   * file, asking where for one never saved. Whether every one of them got saved. */
  async function saveDocumentsDesktop(only?: Set<string>): Promise<boolean> {
    const activeId = activeDocumentId();
    let all = true;
    for (const doc of listDocuments().slice()) {
      if (only && !only.has(doc.id)) continue;
      if (!(await saveDoc(doc.id))) all = false;
    }
    if (listDocuments().some((d) => d.id === activeId)) switchDocument(activeId);
    return all;
  }

  function markSaved(files: Array<{ doc: { id: string }; file: ProjectFileV1 }>, activeId: string) {
    for (const { doc, file } of files) {
      if (doc.id === activeId) commitActiveSaved(file);
      else updateDocumentFile(doc.id, file);
    }
  }

  async function open(): Promise<void> {
    if (!bridge) {
      const loadedName = await loadProjectFromPicker(deps.ctx, deps.viewport, () => {
        if (prepareToOpen() === 'current') resetHistory();
      });
      if (loadedName === undefined) return;
      deps.setName(loadedName);
      // Opened through the browser's picker: Save writes back to that file (Chrome asks for
      // permission on the first save). A plain file input gives no handle: Save asks.
      const handle = getLastProjectFile() as FileHandleLike | null;
      if (handle && typeof handle.createWritable === 'function') {
        fileHandles.set(activeDocumentId(), handle);
        void rememberRecentHandle(handle);
      } else fileHandles.delete(activeDocumentId());
      markDocumentSaved(activeDocumentId(), serializeProject(deps.getName()));
      return;
    }
    const f = await bridge.openFile();
    if (f) openFromOutside(f);
  }

  /** A file from the browser's recent list (Chrome, Edge): read through its kept handle, after
   * the browser's permission prompt; Save then writes back to it. One that can't be read any
   * more is taken off the list. */
  async function openRecentHandle(handle: FileHandleRef): Promise<boolean> {
    try {
      if (handle.queryPermission && handle.requestPermission) {
        const opts = { mode: 'readwrite' } as const;
        if ((await handle.queryPermission(opts)) !== 'granted') {
          await handle.requestPermission(opts);
        }
      }
      const file = await handle.getFile!();
      const text = await file.text();
      closeStartScreen();
      openText(text);
      deps.setName(fileBaseName(handle.name));
      fileHandles.set(activeDocumentId(), handle as unknown as FileHandleLike);
      markDocumentSaved(activeDocumentId(), serializeProject(deps.getName()));
      void rememberRecentHandle(handle);
      return true;
    } catch (err) {
      void forgetRecentHandle(handle);
      const detail = err instanceof Error ? err.message : String(err);
      window.alert(`Couldn't open ${handle.name} (${detail}) - it may have been moved or deleted.`);
      return false;
    }
  }

  /** Up to `max` recently opened or saved files, newest first, each with how to open it: paths
   * in the desktop app, kept file handles in Chrome and Edge, none elsewhere. */
  async function recentFiles(max = 5): Promise<RecentEntry[]> {
    if (bridge) {
      return listRecentFiles()
        .slice(0, max)
        .map((f) => ({
          name: f.path.split(/[\\/]/).pop() ?? f.path,
          detail: f.path.replace(/[\\/][^\\/]*$/, ''),
          at: f.at,
          open: () => openRecent(f.path),
        }));
    }
    return (await listRecentHandles()).slice(0, max).map((e) => ({
      name: e.name,
      detail: '',
      at: e.at,
      open: () => openRecentHandle(e.handle),
    }));
  }

  /** A file from the start screen's recent list. One that's gone is taken off the list. */
  async function openRecent(path: string): Promise<boolean> {
    if (!bridge) return false;
    const f = await bridge.openPath(path);
    if (!f) {
      forgetRecentFile(path);
      window.alert(`${path} isn't there any more - it may have been moved or deleted.`);
      return false;
    }
    openFromOutside(f);
    return true;
  }

  /** Every open circuit as one PDF, a page each: its page frame's sheet on that paper if it has
   * one, else the whole circuit on A4. Empty circuits are left out. */
  async function exportAllSheets(): Promise<void> {
    const pages: NonNullable<Awaited<ReturnType<typeof renderPdfPage>>>[] = [];
    const first = listDocuments()[0]?.name ?? 'circuits';
    await forEachDocumentOnCanvas(async (doc) => {
      if (computeContentBounds() === null && getPageFrameWorldBounds() === null) return;
      const frame = getPageFrameWorldBounds();
      const region = frame
        ? {
            minX: frame.minX - FRAME_EXPORT_PADDING,
            minY: frame.minY - FRAME_EXPORT_PADDING,
            maxX: frame.maxX + FRAME_EXPORT_PADDING,
            maxY: frame.maxY + FRAME_EXPORT_PADDING,
          }
        : 'auto';
      const paper: PdfPaper = appState.pageFrameSize === 'a3' ? 'a3' : 'a4';
      const page = await renderPdfPage(doc.name, deps.connLayer, deps.frameLayer, region, paper);
      if (page) pages.push(page);
    });
    if (pages.length === 0) {
      window.alert('Nothing to export - every open circuit is empty.');
      return;
    }
    downloadPdf(`${safeFileName(first)} - all sheets`, pages);
  }

  if (bridge) {
    bridge.onOpenFile(openFromOutside);
    // Closing the window: the desktop app asks which circuits have unsaved changes, and - if the
    // user chooses Save - has them saved before it closes (desktop/main.cjs).
    bridge.onCloseRequest(async (step) => {
      if (step === 'list') return unsavedDocuments().map((d) => d.name);
      stopSimulation();
      return saveDocumentsDesktop(new Set(unsavedDocuments().map((d) => d.id)));
    });
    // The window's title names the circuit, as a desktop program's does.
    const title = (): void => {
      document.title = `${deps.getName()} - HydGineer`;
    };
    onDocumentsChange(title);
    title();
  }

  // A file dropped on the window never replaces the app (in the desktop app it would navigate
  // away from it): a project file opens, as with Open; pictures dropped on the canvas are
  // handled there (interaction/pictures.ts); anything else is ignored.
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    if (e.defaultPrevented) return;
    e.preventDefault();
    const file = Array.from(e.dataTransfer.files).find((f) => /\.(hgcl|json)$/i.test(f.name));
    if (!file || document.querySelector('.modalBackdrop')) return;
    if (bridge) {
      void bridge.openPath(bridge.pathForFile(file)).then((f) => {
        if (f) openFromOutside(f);
      });
      return;
    }
    void file
      .text()
      .then((text) => {
        closeStartScreen();
        openText(text);
      })
      .catch((err: unknown) => {
        window.alert(`Couldn't open ${file.name}: ${err instanceof Error ? err.message : err}`);
      });
  });

  // The usual file shortcuts. Not while typing in a field or with a dialog open.
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const target = document.activeElement as HTMLElement | null;
    const typing =
      target && (/^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable);
    if (typing || document.querySelector('.modalBackdrop')) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      void (e.shiftKey ? saveAs() : save());
    } else if (key === 'o' && !e.shiftKey) {
      e.preventDefault();
      void open();
    }
  });

  return {
    save,
    saveAs,
    saveDocumentById: (id) => saveDoc(id),
    saveAll,
    open,
    openRecent,
    recentFiles,
    exportAllSheets,
    isDesktop: bridge !== null,
  };
}
