/**
 * The desktop app updating itself (Windows installer, Linux AppImage): whether it can, checking at start while the
 * "Check for updates" setting is on, and offering to install a downloaded update. Nothing here
 * goes online by itself - the check is the desktop shell's (desktop/main.cjs), and it only runs
 * when asked from here.
 */
import { desktopBridge, type UpdateStatus } from './desktopBridge';
import { getSettings } from './settings';

/** Seconds after start before looking for an update - the app first, then the check. */
const CHECK_DELAY_MS = 5000;

let supported = false;
let status: UpdateStatus | null = null;
const listeners: Array<() => void> = [];
let readyListener: ((version: string | undefined) => void) | null = null;

/** Whether this install can update itself (the Windows installer, the Linux AppImage; not the
 * browser, nor the Flatpak, which updates through Flatpak). Known once initUpdates has run. */
export function updatesSupported(): boolean {
  return supported;
}

export function getUpdateStatus(): UpdateStatus | null {
  return status;
}

export function onUpdateStatus(cb: () => void): void {
  listeners.push(cb);
}

/** Looks for an update now (the Settings dialog's Check now). */
export function checkForUpdatesNow(): void {
  if (supported) void desktopBridge()?.updates?.check();
}

/** Restarts into the downloaded update. */
export function installUpdate(): void {
  desktopBridge()?.updates?.install();
}

/**
 * Sets up updating: finds out whether this install can, follows its progress, and - if the
 * setting allows - checks once shortly after start. `onReady` is called when an update has been
 * downloaded and can be installed.
 */
export async function initUpdates(onReady: (version: string | undefined) => void): Promise<void> {
  const updates = desktopBridge()?.updates;
  if (!updates) return;
  readyListener = onReady;
  try {
    supported = await updates.supported();
  } catch {
    supported = false;
  }
  if (!supported) return;
  updates.onStatus((s) => {
    status = { ...status, ...s };
    for (const cb of listeners) cb();
    if (s.state === 'ready') readyListener?.(s.version);
  });
  if (getSettings().checkUpdates) setTimeout(() => void updates.check(), CHECK_DELAY_MS);
}
