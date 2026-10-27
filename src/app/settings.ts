/**
 * The viewer's own settings (Settings dialog, ui/settingsDialog.ts) - how the app looks and
 * behaves for them in this browser, not part of any project.
 */

export interface Settings {
  /** Where the open documents are shown: as tabs above the canvas, or listed in the inspector. */
  docsPlace: 'tabs' | 'inspector';
  /** Show the tabs (or list) even while only one document is open. */
  docsAlways: boolean;
  /** Examples and loaded files open in a new document rather than replacing the current one
   * (an empty current document is used either way). */
  openInNewDoc: boolean;
}

const STORAGE_KEY = 'hydgineer.settings';

const DEFAULTS: Settings = { docsPlace: 'tabs', docsAlways: true, openInNewDoc: true };

let settings: Settings = load();
const listeners: Array<() => void> = [];

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
    return {
      docsPlace: saved.docsPlace === 'inspector' ? 'inspector' : 'tabs',
      docsAlways: typeof saved.docsAlways === 'boolean' ? saved.docsAlways : DEFAULTS.docsAlways,
      openInNewDoc:
        typeof saved.openInNewDoc === 'boolean' ? saved.openInNewDoc : DEFAULTS.openInNewDoc,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSettings(): Readonly<Settings> {
  return settings;
}

export function updateSettings(change: Partial<Settings>): void {
  settings = { ...settings, ...change };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the setting still holds for this visit.
  }
  for (const cb of listeners) cb();
}

export function onSettingsChange(cb: () => void): void {
  listeners.push(cb);
}

/** Back to the defaults - for tests. */
export function resetSettings(): void {
  settings = { ...DEFAULTS };
}
