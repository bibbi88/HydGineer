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
import { loadProject, serializeProject } from '../persistence/project';
import {
  getHistoryState,
  setHistoryState,
  withoutHistory,
  type HistoryState,
} from '../history/historyStore';
import { appState } from './AppState';
import { Modes } from './modes';
import { getSettings } from './settings';

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
  withoutHistory(() => loadProject(doc.file, ctx, viewport));
  deps.setName(doc.name);
  setHistoryState(doc.history ?? { history: [], future: [] });
  if (doc.view) viewport.setTransform(doc.view.scale, doc.view.tx, doc.view.ty);
}

function store(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Best effort only (storage full or unavailable, e.g. private browsing).
  }
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
export function initDocuments(d: DocumentsDeps): boolean {
  deps = d;
  let stored: StoredDocuments | null = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as StoredDocuments | null;
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
  notify();
  return false;
}

export function switchDocument(id: string): void {
  if (id === activeId || !docs.some((d) => d.id === id)) return;
  // Each document's simulation starts from rest; it doesn't carry over to another circuit.
  if (appState.mode !== Modes.STOP) appState.setMode(Modes.STOP);
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
  if (appState.mode !== Modes.STOP) appState.setMode(Modes.STOP);
  return 'current';
}

export function closeDocument(id: string): void {
  const i = docs.findIndex((d) => d.id === id);
  if (i < 0) return;
  if (docs.length === 1) {
    // The last one: it's emptied rather than removed - there's always a document open.
    const only = docs[0]!;
    if (appState.mode !== Modes.STOP) appState.setMode(Modes.STOP);
    only.name = 'Circuit 1';
    only.file = emptyFile(only.name);
    only.view = undefined;
    only.history = undefined;
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
  newDocument(name, { ...copy, name });
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
