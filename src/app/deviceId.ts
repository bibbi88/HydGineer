const STORAGE_KEY = 'pneugineer.deviceId';

/** A random ID generated once per browser (localStorage-backed, so it survives reloads on this
 * same browser but not a cleared profile, a different browser, or incognito mode) - not a real
 * hardware/device identifier, since browsers deliberately don't expose one to a web app. Used
 * only to stamp which browser a project was *first* saved from (see AppState's own
 * projectOriginDeviceId doc) - a weak, easily-bypassed trace for flagging redistributed files in
 * a classroom setting, not a real prevention mechanism, and worth disclosing to students since
 * it's still a form of tracking. */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;

    const id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // Storage blocked (private browsing in some browsers, disabled site data, etc.) - fall back
    // to a per-load-only id rather than throwing; it just won't persist across reloads.
    return crypto.randomUUID();
  }
}
