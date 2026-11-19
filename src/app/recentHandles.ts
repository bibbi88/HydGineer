/**
 * The browser's recently opened and saved project files (Chrome, Edge: the File System Access
 * API), newest first - for the Open button's menu. Kept as file handles in IndexedDB, so they're
 * there after a reload too; opening one again asks the browser for permission to read it. The
 * desktop app keeps paths instead (app/recentFiles.ts); Firefox and Safari have no handles, so
 * no list.
 */
import { readKept, writeKept } from '../persistence/docStore';

export interface FileHandleRef {
  name: string;
  kind?: string;
  getFile?(): Promise<File>;
  isSameEntry?(other: unknown): Promise<boolean>;
  queryPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<string>;
  requestPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<string>;
}

export interface RecentHandle {
  name: string;
  /** Unix time, ms, it was last opened or saved. */
  at: number;
  handle: FileHandleRef;
}

const KEY = 'recentHandles';
const MAX = 10;
let list: RecentHandle[] = [];
let loaded: Promise<void> | null = null;

function load(): Promise<void> {
  loaded ??= readKept(KEY).then((v) => {
    if (Array.isArray(v)) {
      list = v.filter(
        (e): e is RecentHandle =>
          typeof e === 'object' && e !== null && typeof e.name === 'string' && !!e.handle,
      );
    }
  });
  return loaded;
}

/** The recent files, newest first. */
export async function listRecentHandles(): Promise<RecentHandle[]> {
  await load();
  return list.slice();
}

async function same(a: FileHandleRef, b: FileHandleRef): Promise<boolean> {
  if (a === b) return true;
  try {
    if (a.isSameEntry) return await a.isSameEntry(b);
  } catch {
    // Fall back to the name.
  }
  return a.name === b.name;
}

/** `handle` was just opened or saved: to the top of the list. */
export async function rememberRecentHandle(handle: FileHandleRef, at = Date.now()): Promise<void> {
  if (!handle || typeof handle.name !== 'string') return;
  await load();
  const rest: RecentHandle[] = [];
  for (const e of list) if (!(await same(e.handle, handle))) rest.push(e);
  list = [{ name: handle.name, at, handle }, ...rest].slice(0, MAX);
  await writeKept(KEY, list);
}

/** `handle` can't be opened any more (moved, deleted, permission refused): off the list. */
export async function forgetRecentHandle(handle: FileHandleRef): Promise<void> {
  await load();
  list = list.filter((e) => e.handle !== handle);
  await writeKept(KEY, list);
}

/** For tests: forget everything held in memory. */
export function resetRecentHandles(): void {
  list = [];
  loaded = null;
}
