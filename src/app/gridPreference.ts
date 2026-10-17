const STORAGE_KEY = 'pneugineer.gridEnabled';

/** Whether the grid (both the visual pattern and snap-to-grid) is on - a personal viewing/editing
 * preference, not part of any one project, so it lives in localStorage rather than the project
 * file and defaults to on for a first-time visitor. */
export function loadGridPreference(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export function saveGridPreference(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Private browsing / storage disabled - the preference just won't survive a reload.
  }
}
