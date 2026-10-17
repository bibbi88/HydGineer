import { serializeProject } from './project';
import type { ProjectFileV1 } from './schema';

const AUTOSAVE_KEY = 'pneugineer:autosave';
const DEBOUNCE_MS = 400;

interface AutosaveRecord {
  savedAt: number;
  file: ProjectFileV1;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleAutosave(projectName: string): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    try {
      const record: AutosaveRecord = { savedAt: Date.now(), file: serializeProject(projectName) };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(record));
    } catch {
      // best-effort only (storage full/unavailable, e.g. private browsing) - safe to skip
    }
  }, DEBOUNCE_MS);
}

export function readAutosave(): AutosaveRecord | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? (JSON.parse(raw) as AutosaveRecord) : null;
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // ignore
  }
}
