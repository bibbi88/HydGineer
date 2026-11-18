/**
 * Saving a document to a file, the way a desktop program does: once a document has a file, Save
 * writes back to it without asking; Save as picks a new file, and later Saves go there.
 *
 * Where a page can write back to a file - Chrome and Edge (the File System Access API's
 * `showSaveFilePicker`), and the desktop app, which lends the page a stand-in for it (see
 * installDesktopSavePicker) - the file picked is kept as a handle per document. Elsewhere
 * (Firefox, Safari, a sandboxed or cross-origin frame) every save is a download.
 *
 * Handles live in memory only: after a reload the first Save asks again (the desktop app is the
 * exception - a document there remembers its file's path, see handleForPath).
 */
import { desktopBridge, fileBaseName } from '../app/desktopBridge';

export const PROJECT_EXT = '.hgcl';
const PICKER_ID = 'hydgineer-files';
const PICKER_TYPES = [
  { description: 'HydGineer project', accept: { 'application/json': [PROJECT_EXT] } },
];

export interface WritableLike {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
}
export interface FileHandleLike {
  name: string;
  createWritable(): Promise<WritableLike>;
  queryPermission?(opts: { mode: 'readwrite' }): Promise<string>;
  requestPermission?(opts: { mode: 'readwrite' }): Promise<string>;
  /** The desktop app's handles: the file's full path. */
  path?: string;
}
interface SaveFilePickerOptions {
  suggestedName?: string;
  id?: string;
  types?: typeof PICKER_TYPES;
}
type ShowSaveFilePicker = (opts: SaveFilePickerOptions) => Promise<FileHandleLike>;

// ---------------------------------------------------------------------------------------------
// The handles, per document id - watched, so the Save button's label follows them.

const handleListeners: Array<() => void> = [];

class WatchedMap extends Map<string, FileHandleLike> {
  override set(key: string, value: FileHandleLike): this {
    super.set(key, value);
    for (const cb of handleListeners) cb();
    return this;
  }
  override delete(key: string): boolean {
    const had = super.delete(key);
    if (had) for (const cb of handleListeners) cb();
    return had;
  }
}

/** The file each document saves to (document id -> handle). */
export const fileHandles: Map<string, FileHandleLike> = new WatchedMap();

export function onFileHandlesChange(cb: () => void): void {
  handleListeners.push(cb);
}

// ---------------------------------------------------------------------------------------------
// Where the page can write back to a file.

/** In a frame the File System Access pickers throw: a sandboxed one (its origin is "null") or a
 * cross-origin one (its parent can't be looked into). */
function inRestrictedFrame(): boolean {
  // A page of its own - including the standalone file, whose origin is also "null" - is fine.
  if (window.self === window.top) return false;
  if (window.origin === 'null') return true;
  try {
    void window.top?.location.href;
    return false;
  } catch {
    return true;
  }
}

function savePicker(): ShowSaveFilePicker | undefined {
  const pick = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker })
    .showSaveFilePicker;
  if (!pick || inRestrictedFrame()) return undefined;
  return pick.bind(window);
}

/** Whether Save can write back to a file (else every save is a download). */
export function canWriteBack(): boolean {
  return savePicker() !== undefined;
}

// ---------------------------------------------------------------------------------------------
// The desktop app: a showSaveFilePicker of its own.

/** A handle-like object writing to `path` on disk through the desktop app. */
export function handleForPath(path: string): FileHandleLike {
  const bridge = desktopBridge();
  const name = path.split(/[\\/]/).pop() ?? path;
  return {
    name,
    path,
    async createWritable() {
      const parts: Array<Blob | string> = [];
      return {
        async write(data) {
          parts.push(data);
        },
        async close() {
          const texts = await Promise.all(parts.map((p) => (typeof p === 'string' ? p : p.text())));
          if (!bridge || !(await bridge.saveFile(path, texts.join('')))) {
            throw new Error(`Couldn't write to ${path}`);
          }
        },
      };
    },
  };
}

/** In the desktop app, gives the page a `showSaveFilePicker` that opens the computer's own Save
 * dialog and hands back a handle writing to the chosen file - so one code path serves the
 * browser and the desktop app. */
export function installDesktopSavePicker(): void {
  const bridge = desktopBridge();
  if (!bridge?.pickSavePath) return;
  const pickSavePath = bridge.pickSavePath.bind(bridge);
  const picker: ShowSaveFilePicker = async (opts) => {
    const path = await pickSavePath(opts.suggestedName ?? `project${PROJECT_EXT}`);
    if (!path) throw new DOMException('Cancelled', 'AbortError');
    return handleForPath(path);
  };
  (window as unknown as { showSaveFilePicker: ShowSaveFilePicker }).showSaveFilePicker = picker;
}

// ---------------------------------------------------------------------------------------------
// Saving.

function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function writeTo(handle: FileHandleLike, text: string): Promise<void> {
  const w = await handle.createWritable();
  await w.write(new Blob([text], { type: 'application/json' }));
  await w.close();
}

/** Asks for write access to a file kept from earlier (Chrome asks the user again after a
 * reload, or for a file opened rather than saved). Not trusted as the last word: some browsers
 * answer "prompt" for a handle that writes fine - createWritable() is what really fails. */
async function askWritePermission(handle: FileHandleLike): Promise<void> {
  if (!handle.requestPermission) return;
  const opts = { mode: 'readwrite' } as const;
  try {
    if (handle.queryPermission && (await handle.queryPermission(opts)) === 'granted') return;
    await handle.requestPermission(opts);
  } catch {
    // Left to createWritable() to decide.
  }
}

/** "Valve test" -> "Valve test.hgcl" (unless it already ends so). */
export function withExtension(name: string): string {
  return name.toLowerCase().endsWith(PROJECT_EXT) ? name : `${name}${PROJECT_EXT}`;
}

export interface SaveRequest {
  docId: string;
  /** The file name to propose (without extension). */
  name: string;
  /** The file's contents - asked for once it's certain something is saved. */
  text(): string;
  /** Save as: always a new file. */
  asNew?: boolean;
}

export type SaveOutcome =
  | { kind: 'written'; fileName: string; handle: FileHandleLike }
  | { kind: 'downloaded'; fileName: string }
  | { kind: 'cancelled' };

/** Saves document `req.docId`: back to its file if it has one (not for Save as), else to a file
 * picked now - remembered for the next Save - or, where the page can't write files, as a
 * download. */
export async function saveDocument(req: SaveRequest): Promise<SaveOutcome> {
  // 1. Back to its file, without asking.
  const known = req.asNew ? undefined : fileHandles.get(req.docId);
  if (known) {
    try {
      await askWritePermission(known);
      await writeTo(known, req.text());
      return { kind: 'written', fileName: known.name, handle: known };
    } catch {
      // Permission lost, the file moved or locked: pick again below.
    }
    fileHandles.delete(req.docId);
  }

  const suggestedName = withExtension(req.name);

  // 2. A file picked now.
  const pick = savePicker();
  if (pick) {
    let handle: FileHandleLike;
    try {
      handle = await pick({ suggestedName, id: PICKER_ID, types: PICKER_TYPES });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return { kind: 'cancelled' };
      // The picker refused before anything was written: a download instead.
      return downloadAs(req, suggestedName);
    }
    const text = req.text();
    try {
      await writeTo(handle, text);
    } catch (err) {
      // createWritable() empties the picked file before anything's written: say so.
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      window.alert(
        `Couldn't finish saving to the file you picked (${detail}) - it may now be empty, ` +
          `safe to delete. Downloading "${suggestedName}" instead.`,
      );
      download(text, suggestedName);
      return { kind: 'downloaded', fileName: suggestedName };
    }
    fileHandles.set(req.docId, handle);
    return { kind: 'written', fileName: handle.name, handle };
  }

  // 3. A download, under a name asked for.
  const asked = window.prompt(
    'Save as (downloaded to your browser’s download folder):',
    suggestedName,
  );
  if (asked === null) return { kind: 'cancelled' };
  return downloadAs(req, withExtension(asked.trim() || suggestedName));
}

function downloadAs(req: SaveRequest, fileName: string): SaveOutcome {
  download(req.text(), fileName);
  return { kind: 'downloaded', fileName };
}

/** The file a document saves to, for labels: its name, or null if it has none yet. */
export function fileNameOf(docId: string): string | null {
  return fileHandles.get(docId)?.name ?? null;
}

/** "Valve test.hgcl" -> "Valve test". */
export function documentNameFor(fileName: string): string {
  return fileBaseName(fileName);
}
