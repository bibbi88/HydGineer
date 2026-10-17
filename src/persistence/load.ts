import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';
import { migrate } from './migrations';
import { loadProject } from './project';
import { setLastProjectFile } from './fileHandle';

interface FileSystemFileHandleLike {
  getFile(): Promise<File>;
}
interface OpenFilePickerOptions {
  types?: { description: string; accept: Record<string, string[]> }[];
}
type ShowOpenFilePicker = (opts: OpenFilePickerOptions) => Promise<FileSystemFileHandleLike[]>;

function getShowOpenFilePicker(): ShowOpenFilePicker | undefined {
  return (window as unknown as { showOpenFilePicker?: ShowOpenFilePicker }).showOpenFilePicker;
}

/** Parses and applies a loaded project's JSON text, returning its saved name. */
function applyLoadedText(
  text: string,
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
  onBeforeApply?: () => void,
): string {
  const raw = JSON.parse(text);
  const file = migrate(raw);
  onBeforeApply?.();
  loadProject(file, ctx, viewport);
  return file.name;
}

function loadViaFileInput(
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
  onBeforeApply?: () => void,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pgcl,.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(undefined);
        return;
      }
      void file.text().then((text) => {
        const name = applyLoadedText(text, ctx, viewport, onBeforeApply);
        // A plain file input gives no handle to reopen its folder with.
        setLastProjectFile(null);
        resolve(name);
      });
    });
    input.click();
  });
}

/**
 * Returns the loaded project's saved name, or undefined if the user cancelled.
 * `onBeforeApply` runs only once a file was actually selected, right before the current
 * project is cleared and replaced - so a cancelled picker leaves everything untouched.
 */
export async function loadProjectFromPicker(
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
  onBeforeApply?: () => void,
): Promise<string | undefined> {
  const showOpenFilePicker = getShowOpenFilePicker();
  if (showOpenFilePicker) {
    let handle: FileSystemFileHandleLike | undefined;
    try {
      [handle] = await showOpenFilePicker({
        types: [
          { description: 'PneuGineer project', accept: { 'application/json': ['.pgcl', '.json'] } },
        ],
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return undefined;
      // The picker itself never handed back a file handle here, so nothing's been read yet - a
      // silent fallback to the plain <input type=file> picker is safe (same "API present but
      // blocked" case persistence/save.ts's own picker falls back for).
      return loadViaFileInput(ctx, viewport, onBeforeApply);
    }
    if (!handle) return undefined;

    try {
      const file = await handle.getFile();
      const name = applyLoadedText(await file.text(), ctx, viewport, onBeforeApply);
      setLastProjectFile(handle);
      return name;
    } catch (err) {
      // A file *was* picked here - reading it, parsing its JSON, or applying it then failed for
      // some other reason (not valid JSON, a project this build doesn't understand, etc).
      // Silently reopening a second, unrelated picker used to look like "nothing happened, try
      // again" with zero explanation - including "it looks like it didn't open the file the
      // first time." Surface the actual reason instead of retrying blind.
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      window.alert(`Couldn't open that file (${detail}).`);
      return undefined;
    }
  }

  return loadViaFileInput(ctx, viewport, onBeforeApply);
}
