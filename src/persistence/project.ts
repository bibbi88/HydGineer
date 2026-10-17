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
import { createConnection, redrawAllConnections } from '../wires/connection';
import { clearSelection } from '../interaction/selection';
import { resetCylinderLetters } from '../components/shared/letters';
import { renderPageFrame } from '../ui/pageFrame';
import { getDeviceId } from '../app/deviceId';
import { CURRENT_SCHEMA_VERSION, type ProjectFileV1 } from './schema';
import { upgradedCoilType } from '../components/electrical';
import { SOLENOID_KEY_FIELDS, SOLENOID_VALVE_TYPES } from '../components/solenoidValves';

export function serializeProject(name: string): ProjectFileV1 {
  // origin is only ever set once per project - a fresh one (never loaded from/saved to a file
  // before) gets stamped with *this* browser's id here, on its first save; a project that
  // already has one (loaded from an existing file) keeps that value no matter which browser
  // saves it from here on, so it stays a trace of the original. lastSaved, in contrast, is
  // overwritten on every single save - comparing the two is what actually flags a redistributed
  // file (a different id in lastSaved than in origin).
  if (!appState.projectOriginDeviceId) appState.projectOriginDeviceId = getDeviceId();
  appState.projectLastSavedDeviceId = getDeviceId();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name,
    origin: appState.projectOriginDeviceId,
    lastSaved: appState.projectLastSavedDeviceId,
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
      guides: c.guides,
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
  clearSelection();
  resetCylinderLetters();
}

export function loadProject(
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
    appState.projectOriginDeviceId = file.origin ?? null;
    appState.projectLastSavedDeviceId = file.lastSaved ?? null;

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

    for (const snap of file.conns) {
      const fromId = idMap.get(snap.from.id);
      const toId = idMap.get(snap.to.id);
      if (fromId === undefined || toId === undefined) continue;

      const conn = createConnection(
        { id: fromId, port: snap.from.port },
        { id: toId, port: snap.to.port },
      );
      conn.guides = snap.guides;
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
