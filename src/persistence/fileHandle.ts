/** The project file this session last opened or saved through the browser's file pickers, if
 * any. The save dialog opens in that file's folder (the picker's `startIn` accepts a file
 * handle and uses its directory); without one - a new project, one restored from autosave, or
 * a browser without the File System Access API - it opens in Downloads. Held as an opaque
 * value: only the picker itself ever looks inside it. */
let lastProjectFile: unknown = null;

export function getLastProjectFile(): unknown {
  return lastProjectFile;
}

export function setLastProjectFile(handle: unknown): void {
  lastProjectFile = handle;
}
