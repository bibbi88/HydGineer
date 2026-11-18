/**
 * The desktop app (desktop/, Electron) gives the page a small bridge to the computer's own file
 * dialogs and files - see desktop/preload.cjs. In the browser there is none, and the app keeps
 * its browser behaviour (downloads, the browser's file pickers, circuits kept in the browser).
 */

export interface DesktopFile {
  /** Full path on disk. */
  path: string;
  text: string;
}

/** Where an update stands (desktop/main.cjs): checking, none newer, downloading, downloaded and
 * ready to install, or a failure. */
export interface UpdateStatus {
  state: 'checking' | 'none' | 'downloading' | 'ready' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

export interface DesktopBridge {
  /** Self-update (the Windows installer): whether this install can, checking, progress, and
   * installing a downloaded update. */
  updates?: {
    supported(): Promise<boolean>;
    check(): Promise<void>;
    install(): void;
    onStatus(cb: (status: UpdateStatus) => void): void;
  };
  /** Shows an Open dialog for a project file; null if cancelled. */
  openFile(): Promise<DesktopFile | null>;
  /** Reads the project file at `path` - a recent file; null if it's no longer there. */
  openPath(path: string): Promise<DesktopFile | null>;
  /** The path on disk of a file dropped on the window. */
  pathForFile(file: File): string;
  /** Writes `text` to `path`; whether it worked. */
  saveFile(path: string, text: string): Promise<boolean>;
  /** Shows a Save As dialog starting at `suggestedName` and returns the chosen path (allowed
   * for saveFile from then on) without writing anything; null if cancelled. Backs the page's
   * showSaveFilePicker stand-in (persistence/save.ts). */
  pickSavePath?(suggestedName: string): Promise<string | null>;
  /** Shows a Save As dialog starting at `suggestedName` and writes `text` there; the chosen
   * path, or null if cancelled. */
  saveFileAs(suggestedName: string, text: string): Promise<string | null>;
  /** Project files handed to the app from outside - double-clicked, or given on the command
   * line - including any it was started with. */
  onOpenFile(cb: (file: DesktopFile) => void): void;
  /** The window is about to close. 'list': the names of the circuits with unsaved changes;
   * 'save': save those (the user chose Save) and say whether all of them were. */
  onCloseRequest(cb: (step: 'list' | 'save') => Promise<string[] | boolean>): void;
}

export function desktopBridge(): DesktopBridge | null {
  return (window as unknown as { hydgineerDesktop?: DesktopBridge }).hydgineerDesktop ?? null;
}

/** A path's file name without its folder or extension: "C:\\x\\Valve test.hgcl" -> "Valve test". */
export function fileBaseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.(hgcl|json)$/i, '') || file;
}
