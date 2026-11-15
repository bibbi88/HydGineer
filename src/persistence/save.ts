import { serializeProject, unixNow } from './project';
import { appState } from '../app/AppState';
import { getDeviceId } from '../app/deviceId';
import { getLastProjectFile, setLastProjectFile } from './fileHandle';

interface FileSystemWritableFileStreamLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}
interface SaveFilePickerOptions {
  suggestedName?: string;
  /** A file handle (its folder is used) or a well-known folder name. */
  startIn?: unknown;
  types?: { description: string; accept: Record<string, string[]> }[];
}
type ShowSaveFilePicker = (opts: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;

function getShowSaveFilePicker(): ShowSaveFilePicker | undefined {
  return (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
}

function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function saveProjectToFile(name: string): Promise<void> {
  // Stamped as saved by this browser, now - kept once it's written (not if the save is
  // cancelled).
  const savedBy = getDeviceId();
  const savedAt = unixNow();
  const json = JSON.stringify({ ...serializeProject(name), LS: savedBy, lst: savedAt }, null, 2);
  const commit = (): void => {
    appState.projectLastSavedDeviceId = savedBy;
    appState.projectLastSavedAt = savedAt;
  };
  const filename = `${name}.hgcl`;

  const showSaveFilePicker = getShowSaveFilePicker();
  if (showSaveFilePicker) {
    let handle: FileSystemFileHandleLike;
    try {
      handle = await showSaveFilePicker({
        suggestedName: filename,
        // The folder of the file this project was opened from or last saved to; a new
        // project starts in Downloads.
        startIn: getLastProjectFile() ?? 'downloads',
        types: [{ description: 'HydGineer project', accept: { 'application/json': ['.hgcl'] } }],
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      commit();
      // The picker itself never handed back a file handle here, so nothing's been touched yet -
      // a silent fallback to a plain download is safe (this is the "API present but blocked"
      // case the old comment referred to).
      downloadJson(json, filename);
      return;
    }

    try {
      // showSaveFilePicker()'s own returned handle already carries 'granted' write permission -
      // an earlier version of this code re-checked that explicitly via requestPermission() as a
      // defensive measure, but that turned out to be the actual problem: it consistently came
      // back as something other than 'granted' (most likely because by the time this runs,
      // after an earlier await, the call may no longer count as being made within the original
      // click's transient user activation - so instead of prompting, the browser just resolves
      // it as not-granted), breaking every save outright. createWritable() is the one call that
      // actually needs to succeed; there's no reason to gate it behind a redundant check first.
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      commit();
      setLastProjectFile(handle);
      return;
    } catch (err) {
      // createWritable() truncates the picked file to empty as soon as it opens, before write()
      // ever runs - so if writing/closing fails here, that file is already sitting there empty.
      // Silently falling back to a download used to leave that behind with zero explanation:
      // an apparently-successful save prompt, an empty file at the chosen location, and then a
      // second, unexplained save prompt for the real one. A project is worth a plain alert
      // instead - including the actual error, since "it just failed" isn't enough to diagnose
      // *why* (permission, a locked/cloud-synced file, etc.).
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      window.alert(
        `Couldn't finish saving to the file you picked (${detail}) - it may now be empty, ` +
          `safe to delete. Downloading "${filename}" instead.`,
      );
      commit();
      downloadJson(json, filename);
      return;
    }
  }

  commit();
  downloadJson(json, filename);
}
