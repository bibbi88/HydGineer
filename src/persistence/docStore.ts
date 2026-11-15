/**
 * Where the open documents are kept between visits (app/documents.ts): IndexedDB, which holds
 * far more than localStorage's few megabytes - pasted pictures fill those quickly - and takes
 * the documents as they are, without turning them into one big string first. Where IndexedDB
 * isn't there (some browsers refuse it for a page opened from a file on disk), localStorage, as
 * before. Documents kept in localStorage by an earlier version are moved over on first read.
 */

const DB_NAME = 'hydgineer';
const STORE = 'kv';
const KEY = 'docs';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function readLegacy(legacyKey: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(legacyKey) ?? 'null');
  } catch {
    return null;
  }
}

/** The kept documents, or null if there are none. */
export async function readDocuments(legacyKey: string): Promise<unknown> {
  const db = await openDb();
  if (db) {
    try {
      const value = await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY));
      if (value !== undefined && value !== null) return value;
    } catch {
      // Unreadable: fall through to what localStorage may still hold.
    }
  }
  const legacy = readLegacy(legacyKey);
  if (legacy !== null && db) {
    // Moved over from an earlier version's localStorage - then freed there, once it's safe.
    try {
      await writeTo(db, legacy);
      localStorage.removeItem(legacyKey);
    } catch {
      // Stays in localStorage; read from there again next time.
    }
  }
  return legacy;
}

async function writeTo(db: IDBDatabase, value: unknown): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(value, KEY);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write was aborted'));
  });
}

/** Keeps the documents. Rejects if they couldn't be kept (storage full or unavailable). */
export function writeDocuments(value: unknown, legacyKey: string): Promise<void> {
  // No IndexedDB at all: straight into localStorage, as before - synchronously, so it has
  // happened by the time this returns.
  if (typeof indexedDB === 'undefined') {
    try {
      localStorage.setItem(legacyKey, JSON.stringify(value));
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
  return openDb().then((db) => {
    if (db) return writeTo(db, value);
    localStorage.setItem(legacyKey, JSON.stringify(value));
    return undefined;
  });
}
