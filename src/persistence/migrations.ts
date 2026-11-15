import type { ProjectFileV1 } from './schema';
import { componentRegistry } from '../components/registry';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Turns arbitrary parsed JSON into a current-schema project, throwing on anything unrecognized -
 * checked through before anything is loaded, so a damaged or hand-edited file, or one from a
 * newer version with parts this one doesn't have, is refused with a reason instead of leaving a
 * half-loaded canvas behind. A wire to a part that isn't in the file is dropped, as loading
 * always has.
 */
export function migrate(raw: unknown): ProjectFileV1 {
  if (!isObject(raw)) throw new Error('Not a valid HydGineer project file');

  if (raw.schemaVersion !== 1) {
    throw new Error(`Unsupported project file schema version: ${String(raw.schemaVersion)}`);
  }
  if (!Array.isArray(raw.comps) || !Array.isArray(raw.conns)) {
    throw new Error('Not a valid HydGineer project file (no components or wires in it)');
  }

  const unknown = new Set<string>();
  const comps = raw.comps.map((c, i) => {
    if (!isObject(c) || !isNum(c.id) || typeof c.type !== 'string' || !isNum(c.x) || !isNum(c.y)) {
      throw new Error(`Component ${i + 1} in the file is damaged`);
    }
    if (!componentRegistry.has(c.type)) unknown.add(c.type);
    return { ...c, data: isObject(c.data) ? c.data : {} };
  });
  if (unknown.size > 0) {
    throw new Error(
      `The file has parts this version of HydGineer doesn't know (${[...unknown].join(', ')}) - ` +
        'it may be from a newer version',
    );
  }

  const conns = raw.conns.map((w, i) => {
    const end = (e: unknown): boolean => isObject(e) && isNum(e.id) && typeof e.port === 'string';
    if (!isObject(w) || !end(w.from) || !end(w.to)) {
      throw new Error(`Wire ${i + 1} in the file is damaged`);
    }
    const guides = Array.isArray(w.guides)
      ? w.guides.filter((g) => isObject(g) && (g.type === 'H' || g.type === 'V') && isNum(g.pos))
      : [];
    return {
      ...w,
      guides,
      stubStartLen: isNum(w.stubStartLen) ? w.stubStartLen : null,
      stubEndLen: isNum(w.stubEndLen) ? w.stubEndLen : null,
    };
  });

  return {
    ...(raw as unknown as ProjectFileV1),
    name: typeof raw.name === 'string' ? raw.name : 'project',
    comps: comps as unknown as ProjectFileV1['comps'],
    conns: conns as unknown as ProjectFileV1['conns'],
  };
}
