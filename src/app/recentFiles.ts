/**
 * The desktop app's recently opened and saved project files, newest first - for the start
 * screen. Kept in the app's own storage; only paths and when, never the circuits themselves.
 */

export interface RecentFile {
  path: string;
  /** Unix time, ms, it was last opened or saved. */
  at: number;
}

const KEY = 'hydgineer.recentFiles';
const MAX = 10;

export function listRecentFiles(): RecentFile[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (f): f is RecentFile =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as RecentFile).path === 'string' &&
        typeof (f as RecentFile).at === 'number',
    );
  } catch {
    return [];
  }
}

function store(list: RecentFile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Best effort.
  }
}

/** `path` was just opened or saved: to the top of the list. */
export function rememberRecentFile(path: string, at = Date.now()): void {
  store([{ path, at }, ...listRecentFiles().filter((f) => f.path !== path)]);
}

/** `path` is gone (moved or deleted): off the list. */
export function forgetRecentFile(path: string): void {
  store(listRecentFiles().filter((f) => f.path !== path));
}
