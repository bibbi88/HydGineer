/** Saving a document by id (ui/fileActions.ts registers how) - for places that offer Save
 * without owning the file actions, such as closing a tab with unsaved changes. */
let saver: ((id: string) => Promise<boolean>) | null = null;

export function setDocumentSaver(fn: (id: string) => Promise<boolean>): void {
  saver = fn;
}

/** Saves document `id` as Save does; whether it was saved. */
export function saveDocumentById(id: string): Promise<boolean> {
  return saver ? saver(id) : Promise.resolve(false);
}
