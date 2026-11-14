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

export interface DesktopBridge {
  /** Shows an Open dialog for a project file; null if cancelled. */
  openFile(): Promise<DesktopFile | null>;
  /** Writes `text` to `path`; whether it worked. */
  saveFile(path: string, text: string): Promise<boolean>;
  /** Shows a Save As dialog starting at `suggestedName` and writes `text` there; the chosen
   * path, or null if cancelled. */
  saveFileAs(suggestedName: string, text: string): Promise<string | null>;
  /** Project files handed to the app from outside - double-clicked, or given on the command
   * line - including any it was started with. */
  onOpenFile(cb: (file: DesktopFile) => void): void;
}

export function desktopBridge(): DesktopBridge | null {
  return (window as unknown as { hydgineerDesktop?: DesktopBridge }).hydgineerDesktop ?? null;
}

/** A path's file name without its folder or extension: "C:\\x\\Valve test.hgcl" -> "Valve test". */
export function fileBaseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.(hgcl|json)$/i, '') || file;
}
