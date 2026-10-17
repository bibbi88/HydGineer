import type { ProjectFileV1 } from './schema';

/** Turns arbitrary parsed JSON into a current-schema project, throwing on anything unrecognized. */
export function migrate(raw: unknown): ProjectFileV1 {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Not a valid PneuGineer project file');
  }
  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion === 1) {
    return obj as unknown as ProjectFileV1;
  }

  throw new Error(`Unsupported project file schema version: ${String(obj.schemaVersion)}`);
}
