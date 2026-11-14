import { JUNCTION_TYPE, readJunctionHost, remapJunctionHost } from '../components/junction';
import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { spawnComponent } from '../interaction/spawn';
import {
  getComponentRotation,
  isComponentMirrored,
  setComponentMirrored,
  setComponentRotation,
} from '../interaction/componentContextMenu';
import { createConnection, forgetAllDrawnRoutes, redrawAllConnections } from '../wires/connection';
import { clearSelection } from '../interaction/selection';
import { renderPageFrame } from '../ui/pageFrame';
import { getDeviceId } from '../app/deviceId';
import { CURRENT_SCHEMA_VERSION, type ProjectFileV1 } from './schema';
import { upgradedCoilType } from '../components/electrical';
import { SOLENOID_KEY_FIELDS, SOLENOID_VALVE_TYPES } from '../components/hyd/valves';

/** Now, as a Unix timestamp in seconds - the unit of a project file's `ct` and `lst`. */
export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** The project's `ct` and `lst` from `file`. A file with no `ct` is new if it's empty and has
 * never been saved (a new tab), or else from before creation times were kept. */
function applyTimestamps(file: ProjectFileV1): void {
  const savedBefore = Boolean(file.os ?? file.origin);
  appState.projectCreatedAt =
    typeof file.ct === 'number' ? file.ct : savedBefore || file.comps.length > 0 ? 'unknown' : null;
  appState.projectLastSavedAt = typeof file.lst === 'number' ? file.lst : null;
}

export function serializeProject(name: string): ProjectFileV1 {
  // os (origin) is only ever set once per project - a fresh one gets stamped with *this*
  // browser's id here, on its first serialization; a project that already has one (loaded from
  // an existing file) keeps that value no matter which browser saves it from here on, so it
  // stays a trace of the original. LS (last saved) and lst, in contrast, are set by every save
  // to a file (persistence/save.ts) - comparing LS with os is what flags a redistributed file.
  // ct is stamped the same once-only way as os, unless the project predates it ('unknown').
  if (!appState.projectOriginDeviceId) appState.projectOriginDeviceId = getDeviceId();
  if (appState.projectCreatedAt === null) appState.projectCreatedAt = unixNow();
  const created = appState.projectCreatedAt;

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name,
    os: appState.projectOriginDeviceId,
    ...(appState.projectLastSavedDeviceId ? { LS: appState.projectLastSavedDeviceId } : {}),
    ...(typeof created === 'number' ? { ct: created } : {}),
    ...(appState.projectLastSavedAt !== null ? { lst: appState.projectLastSavedAt } : {}),
    meta: {
      author: appState.projectAuthor,
      checkedBy: appState.projectCheckedBy,
      company: appState.projectCompany,
      date: appState.projectDate,
    },
    pageFrame: {
      size: appState.pageFrameSize,
      x: appState.pageFrameX,
      y: appState.pageFrameY,
    },
    ...(appState.lineJumps ? {} : { lineJumps: false }),
    comps: appState.components.map((c) => ({
      id: c.id,
      type: c.type,
      x: c.x,
      y: c.y,
      rot: getComponentRotation(c),
      ...(isComponentMirrored(c) ? { mirror: true } : {}),
      data: c.snapshot(),
    })),
    conns: appState.connections.map((c) => ({
      from: c.from,
      to: c.to,
      // Copies, never the live wire's own: a bend dragged later mustn't rewrite this snapshot.
      guides: c.guides.map((g) => ({ ...g })),
      stubStartLen: c.stubStartLen,
      stubEndLen: c.stubEndLen,
      dashed: c.dashed,
    })),
  };
}

export function clearProject(): void {
  for (const conn of [...appState.connections]) {
    conn.pathEl.remove();
    conn.hitEl.remove();
    conn.labelEl.remove();
    appState.removeConnection(conn.id);
  }
  for (const comp of [...appState.components]) {
    appState.removeComponent(comp.id);
  }
  forgetAllDrawnRoutes();
  clearSelection();
}

/** A tap junction names the wire it sits on by its ends' component ids (components/junction.ts)
 * - which a load gives new ids: carried over through `idMap`, or dropped if its wire's ends
 * aren't loaded with it. */
export function retargetTaps(idMap: Map<number, number>): void {
  for (const comp of appState.components) {
    if (comp.type !== JUNCTION_TYPE || ![...idMap.values()].includes(comp.id)) continue;
    const snap = comp.snapshot();
    const host = readJunctionHost(snap);
    if (host) comp.restore({ ...snap, host: remapJunctionHost(host, idMap) });
  }
}

/**
 * Puts `file` on the canvas, replacing what's there. Should it fail partway - a part that won't
 * take its saved settings - what was on the canvas before is put back, and the error passed on:
 * a file that can't be opened never costs the circuit that was open.
 */
export function loadProject(
  file: ProjectFileV1,
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
): void {
  const before = serializeProject(file.name);
  try {
    loadProjectUnchecked(file, ctx, viewport);
  } catch (err) {
    loadProjectUnchecked(before, ctx, viewport);
    throw err;
  }
}

function loadProjectUnchecked(
  file: ProjectFileV1,
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
): void {
  appState.runSuppressed(() => {
    clearProject();
    appState.projectAuthor = file.meta?.author ?? '';
    appState.projectCheckedBy = file.meta?.checkedBy ?? '';
    appState.projectCompany = file.meta?.company ?? '';
    appState.projectDate = file.meta?.date ?? '';
    appState.pageFrameSize = file.pageFrame?.size ?? 'none';
    appState.pageFrameX = file.pageFrame?.x ?? 0;
    appState.pageFrameY = file.pageFrame?.y ?? 0;
    appState.lineJumps = file.lineJumps !== false;
    appState.projectOriginDeviceId = file.os ?? file.origin ?? null;
    appState.projectLastSavedDeviceId = file.LS ?? file.lastSaved ?? null;
    applyTimestamps(file);

    const solenoidKeys = new Set<string>();
    for (const snap of file.comps) {
      if (!SOLENOID_VALVE_TYPES.has(snap.type)) continue;
      const data = snap.data as Record<string, unknown>;
      for (const field of SOLENOID_KEY_FIELDS) {
        const value = data[field];
        if (typeof value === 'string' && value.trim()) solenoidKeys.add(value.trim().toUpperCase());
      }
    }

    const idMap = new Map<number, number>();
    for (const snap of file.comps) {
      const type = upgradedCoilType(snap.type, snap.data as Record<string, unknown>, solenoidKeys);
      const comp = spawnComponent(type, ctx, viewport, snap.x, snap.y);
      comp.restore(snap.data);
      if (snap.rot) setComponentRotation(comp, snap.rot);
      if (snap.mirror) setComponentMirrored(comp, true);
      idMap.set(snap.id, comp.id);
    }
    retargetTaps(idMap);

    for (const snap of file.conns) {
      const fromId = idMap.get(snap.from.id);
      const toId = idMap.get(snap.to.id);
      if (fromId === undefined || toId === undefined) continue;

      const conn = createConnection(
        { id: fromId, port: snap.from.port },
        { id: toId, port: snap.to.port },
      );
      conn.guides = snap.guides.map((g) => ({ ...g }));
      conn.stubStartLen = snap.stubStartLen;
      conn.stubEndLen = snap.stubEndLen;
      conn.dashed = snap.dashed;
    }
  });

  redrawAllConnections();
  renderPageFrame();
  // Nothing actually changes selection-wise (clearProject's own clearSelection() already left it
  // empty), but the inspector's "Project info" section only re-renders on a selection-change
  // notification - without this second one, it would keep showing whatever author/checked
  // by/company were on screen before this load instead of the values just restored above.
  clearSelection();
}

/**
 * What a project's content amounts to, for telling whether it has changed since it was opened or
 * saved: its parts, wires, sheet and title block - not its name, nor the save stamps, nor the
 * part ids, which a project gets anew each time it's put on the canvas (so parts are referred to
 * by their place in the file instead).
 */
export function projectSignature(file: ProjectFileV1): string {
  const index = new Map(file.comps.map((c, i) => [c.id, i]));
  return JSON.stringify({
    comps: file.comps.map((c) => [c.type, c.x, c.y, c.rot ?? 0, c.mirror ?? false, c.data]),
    conns: file.conns.map((w) => [
      index.get(w.from.id),
      w.from.port,
      index.get(w.to.id),
      w.to.port,
      w.guides,
      w.stubStartLen,
      w.stubEndLen,
      w.dashed ?? false,
    ]),
    meta: file.meta ?? null,
    pageFrame: file.pageFrame ?? null,
    lineJumps: file.lineJumps ?? true,
  });
}
