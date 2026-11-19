/**
 * Open documents: several circuits open at once, one on the canvas at a time - shown as tabs
 * above the canvas or as a list in the inspector (see ui/documentTabs.ts and app/settings.ts).
 *
 * Only the active document lives on the canvas (appState). Every other one is kept here as its
 * saved project file, with its own undo history and view, and goes back on the canvas when
 * switched to. All of them are kept in the browser, so they come back after a reload.
 */
import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';
import { CURRENT_SCHEMA_VERSION, type ProjectFileV1 } from '../persistence/schema';
import { loadProject, projectSignature, serializeProject, unixNow } from '../persistence/project';
import {
  getHistoryState,
  seedHistory,
  setHistoryState,
  withoutHistory,
  type HistoryState,
} from '../history/historyStore';
import { appState } from './AppState';
import { stopSimulation } from '../sim/stopSimulation';
import { getSettings } from './settings';
import { readDocuments, writeDocuments } from '../persistence/docStore';
import { migrate } from '../persistence/migrations';

export interface DocumentView {
  scale: number;
  tx: number;
  ty: number;
}

export interface ProjectDocument {
  id: string;
  name: string;
  /** The document as last saved - for the active one, as it was when it was last switched
   * away from or stored (the canvas itself is the live copy). */
  file: ProjectFileV1;
  view?: DocumentView;
  /** Undo/redo while another document is open; not kept across reloads. */
  history?: HistoryState;
  /** The desktop app: the file on disk this document was opened from or last saved to, which
   * Save writes back to. Never set in the browser, which has no file paths. */
  path?: string;
  /** How it looked when last opened from or saved to a file (projectSignature) - for telling
   * whether closing the desktop app would lose anything. */
  savedSignature?: string;
}

interface StoredDocuments {
  active: string;
  list: Array<Pick<ProjectDocument, 'id' | 'name' | 'file' | 'view'>>;
}

export interface DocumentsDeps {
  ctx: ComponentFactoryContext;
  viewport: ViewportAdapter;
  getName(): string;
  setName(name: string): void;
}

const STORAGE_KEY = 'hydgineer:docs:v1';
const SAVE_DEBOUNCE_MS = 400;

let deps: DocumentsDeps | null = null;
let docs: ProjectDocument[] = [];
let activeId = '';
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners: Array<() => void> = [];

function notify(): void {
  for (const cb of listeners) cb();
}

export function onDocumentsChange(cb: () => void): void {
  listeners.push(cb);
}

function newId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function emptyFile(name: string): ProjectFileV1 {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, name, comps: [], conns: [] };
}

/** "Circuit 2", "Circuit 3"... - the first number no open document is named with yet. */
function nextName(): string {
  let n = docs.length + 1;
  while (docs.some((d) => d.name === `Circuit ${n}`)) n++;
  return `Circuit ${n}`;
}

function active(): ProjectDocument | undefined {
  return docs.find((d) => d.id === activeId);
}

export function listDocuments(): readonly ProjectDocument[] {
  return docs;
}

export function activeDocumentId(): string {
  return activeId;
}

/** Whether there's anything in it to lose. */
export function isDocumentEmpty(id: string): boolean {
  if (id === activeId) return appState.components.length === 0;
  const doc = docs.find((d) => d.id === id);
  return !doc || doc.file.comps.length === 0;
}

/** Copies the canvas (and its history and view) into the active document's record. */
function captureActive(): void {
  const doc = active();
  if (!doc || !deps) return;
  doc.name = deps.getName();
  doc.file = serializeProject(doc.name);
  doc.view = { ...deps.viewport.getTransform() };
  doc.history = getHistoryState();
}

/** Puts `doc` on the canvas, with its own history and view. */
function showDocument(doc: ProjectDocument): void {
  if (!deps) return;
  const { ctx, viewport } = deps;
  try {
    const file = migrate(doc.file);
    withoutHistory(() => loadProject(file, ctx, viewport));
  } catch (err) {
    // Kept from an earlier visit but no longer readable - say, a part this version doesn't
    // have. It mustn't stop the app from starting: its contents are saved as a file so nothing
    // is lost, and the tab starts empty.
    rescueUnreadable(doc, err);
    doc.file = emptyFile(doc.name);
    doc.history = undefined;
    withoutHistory(() => loadProject(doc.file, ctx, viewport));
  }
  deps.setName(doc.name);
  setHistoryState(doc.history ?? { history: [], future: [] });
  seedHistory(doc.name);
  if (doc.view) viewport.setTransform(doc.view.scale, doc.view.tx, doc.view.ty);
}

/** Downloads an unreadable document's contents as they are, and says so. */
function rescueUnreadable(doc: ProjectDocument, err: unknown): void {
  const name = `${doc.name || 'circuit'} (unreadable).hgcl`;
  try {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(doc.file, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    // Nowhere to put it (a test, say): the message still goes out.
  }
  const reason = err instanceof Error ? err.message : String(err);
  setTimeout(() =>
    window.alert(
      `The circuit "${doc.name}" kept in this browser couldn't be opened (${reason}). ` +
        `It has been saved as "${name}" so nothing is lost, and its tab starts empty.`,
    ),
  );
}

function store(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // Not before the documents are set up: an early change mustn't overwrite the ones being read
  // back from the browser with an empty list.
  if (!deps) return;
  const doc = active();
  if (doc && deps) {
    doc.name = deps.getName();
    doc.file = serializeProject(doc.name);
    doc.view = { ...deps.viewport.getTransform() };
  }
  const stored: StoredDocuments = {
    active: activeId,
    list: docs.map(({ id, name, file, view }) => ({ id, name, file, ...(view ? { view } : {}) })),
  };
  writeDocuments(stored, STORAGE_KEY).catch((err: unknown) => warnNotKept(err));
}

let warnedNotKept = false;

/** Keeping the documents in the browser failed (storage full, or not allowed - private
 * browsing): said once, so work isn't lost unnoticed at the next visit. */
function warnNotKept(err: unknown): void {
  if (warnedNotKept) return;
  warnedNotKept = true;
  const reason = err instanceof Error ? err.message : String(err);
  window.alert(
    `HydGineer couldn't keep your circuits in this browser (${reason}). ` +
      'Save them to a file (Save, or Save all) so nothing is lost when this page is closed.',
  );
}

/** Keeps the documents now, not after the usual short wait - the page is being hidden or
 * closed. */
export function storeDocumentsNow(): void {
  if (saveTimer) store();
}

/** The documents kept in this browser, read back for initDocuments (null if none). */
export async function readStoredDocuments(): Promise<StoredDocuments | null> {
  const value = await readDocuments(STORAGE_KEY);
  return (value as StoredDocuments | null) ?? null;
}

/** Keeps the documents in the browser shortly after the last change. */
export function storeDocumentsSoon(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(store, SAVE_DEBOUNCE_MS);
}

/** The active document's name changed (the project name field). */
export function activeNameChanged(): void {
  const doc = active();
  if (!doc || !deps) return;
  doc.name = deps.getName();
  notify();
  storeDocumentsSoon();
}

/**
 * Sets up the documents. If the browser kept documents from last time, they're opened again -
 * the active one on the canvas - and true is returned; otherwise whatever is on the canvas
 * becomes the one open document.
 */
export function initDocuments(
  d: DocumentsDeps,
  opts: { fresh?: boolean; stored?: StoredDocuments | null } = {},
): boolean {
  deps = d;
  let stored: StoredDocuments | null = null;
  try {
    // The desktop app starts with one empty circuit, as desktop programs do: its circuits are
    // files, opened when wanted. Otherwise what readStoredDocuments() read back - or, if none
    // was passed, what localStorage holds.
    if (opts.fresh) stored = null;
    else if (opts.stored !== undefined) stored = opts.stored;
    else stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as StoredDocuments | null;
  } catch {
    stored = null;
  }
  if (stored && Array.isArray(stored.list) && stored.list.length > 0) {
    docs = stored.list.map((s) => ({ ...s }));
    activeId = docs.some((x) => x.id === stored.active) ? stored.active : docs[0]!.id;
    showDocument(active()!);
    notify();
    return true;
  }
  docs = [{ id: newId(), name: d.getName(), file: serializeProject(d.getName()) }];
  activeId = docs[0]!.id;
  seedHistory(d.getName());
  notify();
  return false;
}

export function switchDocument(id: string): void {
  if (id === activeId || !docs.some((d) => d.id === id)) return;
  // Each document's simulation starts from rest; it doesn't carry over to another circuit.
  stopSimulation();
  captureActive();
  activeId = id;
  showDocument(active()!);
  notify();
  store();
}

/** Opens a new document right after the active one - empty, or holding `file` - and switches
 * to it. */
export function newDocument(name?: string, file?: ProjectFileV1): ProjectDocument {
  const docName = name ?? nextName();
  const doc: ProjectDocument = { id: newId(), name: docName, file: file ?? emptyFile(docName) };
  const i = docs.findIndex((d) => d.id === activeId);
  docs.splice(i + 1, 0, doc);
  switchDocument(doc.id);
  return doc;
}

/**
 * Makes room for a project about to be opened (an example or a file): a new document, if the
 * setting says so and the active one has something in it - otherwise the active one. Returns
 * which.
 */
export function prepareToOpen(): 'new' | 'current' {
  if (getSettings().openInNewDoc && !isDocumentEmpty(activeId)) {
    newDocument();
    return 'new';
  }
  stopSimulation();
  return 'current';
}

export function closeDocument(id: string): void {
  const i = docs.findIndex((d) => d.id === id);
  if (i < 0) return;
  if (docs.length === 1) {
    // The last one: it's emptied rather than removed - there's always a document open.
    const only = docs[0]!;
    stopSimulation();
    only.name = 'Circuit 1';
    only.file = emptyFile(only.name);
    only.view = undefined;
    only.history = undefined;
    only.path = undefined;
    showDocument(only);
    notify();
    store();
    return;
  }
  if (id === activeId) switchDocument((docs[i + 1] ?? docs[i - 1])!.id);
  docs.splice(
    docs.findIndex((d) => d.id === id),
    1,
  );
  notify();
  store();
}

export function closeOtherDocuments(id: string): void {
  if (!docs.some((d) => d.id === id)) return;
  switchDocument(id);
  docs = docs.filter((d) => d.id === id);
  notify();
  store();
}

export function renameDocument(id: string, name: string): void {
  const doc = docs.find((d) => d.id === id);
  const trimmed = name.trim().slice(0, 80);
  if (!doc || !trimmed) return;
  doc.name = trimmed;
  doc.file = { ...doc.file, name: trimmed };
  if (id === activeId) deps?.setName(trimmed);
  notify();
  store();
}

export function duplicateDocument(id: string): void {
  const doc = docs.find((d) => d.id === id);
  if (!doc) return;
  if (id === activeId) captureActive();
  const copy = JSON.parse(JSON.stringify(doc.file)) as ProjectFileV1;
  const name = `${doc.name} (copy)`;
  // A copy is a new project: created now, not saved yet.
  delete copy.lst;
  delete copy.LS;
  delete copy.lastSaved;
  newDocument(name, { ...copy, name, ct: unixNow() });
}

/** The desktop app: the file the active document belongs to, if any. */
export function activeDocumentPath(): string | undefined {
  return active()?.path;
}

/** The desktop app: the active document now belongs to `path` (opened from it, or saved to it). */
export function setActiveDocumentPath(path: string | undefined): void {
  const doc = active();
  if (doc) doc.path = path;
}

/** Every open document as it is now - the active one fresh from the canvas - for Save all. */
export function snapshotDocuments(): Array<{
  id: string;
  name: string;
  file: ProjectFileV1;
  path?: string;
}> {
  captureActive();
  return docs.map(({ id, name, file, path }) => ({ id, name, file, ...(path ? { path } : {}) }));
}

/** Replaces the kept copy of a document that isn't on the canvas - Save all stamping the time it
 * was saved into it. The active one lives on the canvas and isn't touched. */
export function updateDocumentFile(id: string, file: ProjectFileV1): void {
  const doc = docs.find((d) => d.id === id);
  if (doc && id !== activeId) doc.file = file;
  storeDocumentsSoon();
}

/** Document `id` now matches what's in its file - just opened from it, or saved to it. */
export function markDocumentSaved(id: string, file: ProjectFileV1): void {
  const doc = docs.find((d) => d.id === id);
  if (doc) doc.savedSignature = projectSignature(file);
}

/** The open documents with changes no file has: anything on them that differs from when they
 * were last opened or saved (an untouched empty one doesn't count). */
export function unsavedDocuments(): Array<{ id: string; name: string }> {
  captureActive();
  return docs
    .filter((d) => {
      const empty = d.file.comps.length === 0;
      if (d.savedSignature === undefined) return !empty;
      return projectSignature(d.file) !== d.savedSignature;
    })
    .map(({ id, name }) => ({ id, name }));
}

/** The desktop app: document `id` now belongs to `path`. */
export function setDocumentPath(id: string, path: string): void {
  const doc = docs.find((d) => d.id === id);
  if (doc) doc.path = path;
}

/** Puts each document on the canvas in turn, tab order, and runs `fn` on it - then goes back to
 * the one that was open. For Export several circuits, which draws each from the canvas; `only`: just those. */
export async function forEachDocumentOnCanvas(
  fn: (doc: { id: string; name: string }) => Promise<void>,
  only?: ReadonlySet<string>,
): Promise<void> {
  const startId = activeId;
  try {
    for (const doc of [...docs]) {
      if (only && !only.has(doc.id)) continue;
      switchDocument(doc.id);
      // Let wires and labels settle into place before drawing.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await fn({ id: doc.id, name: doc.name });
    }
  } finally {
    switchDocument(startId);
  }
}

/** Moves a document one place left (-1) or right (+1). */
export function moveDocument(id: string, delta: -1 | 1): void {
  const i = docs.findIndex((d) => d.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= docs.length) return;
  const [doc] = docs.splice(i, 1);
  docs.splice(j, 0, doc!);
  notify();
  store();
}

/** Forgets every document - for tests. */
export function resetDocuments(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  deps = null;
  docs = [];
  activeId = '';
}
