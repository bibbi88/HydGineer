import type { Component, PortKey } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { canEdit } from '../app/modes';
import { showContextMenu } from './contextMenu';
import {
  createConnection,
  removeConnection,
  removeComponentAndConnections,
  redrawAllConnections,
} from '../wires/connection';
import { HYD_TANK_TYPE } from '../components/hyd/supply';
import { snap } from '../core/grid';

/** Same shape as spawn.ts's spawnComponent - injected rather than imported directly, since
 * spawn.ts is the one place that calls wireUpPortContextMenu on every component it creates
 * (including a quick-added tank), and importing spawnComponent back from here would make the
 * two modules import each other. */
export type SpawnFn = (type: string, x: number, y: number) => Component;

/** How far below a port a quick-added tank symbol is placed - just a starting point, it is an
 * ordinary component the user can drag anywhere afterward. */
const QUICK_TANK_OFFSET_Y = 60;

interface AttachedTank {
  tank: Component;
  connectionId: number;
}

/** Finds a tank symbol wired directly to this exact port, if any. */
function findAttachedTank(comp: Component, portKey: PortKey): AttachedTank | null {
  for (const conn of appState.connections) {
    let other: { id: number; port: PortKey } | null = null;
    if (conn.from.id === comp.id && conn.from.port === portKey) other = conn.to;
    else if (conn.to.id === comp.id && conn.to.port === portKey) other = conn.from;
    if (!other) continue;
    const otherComp = appState.findComponent(other.id);
    if (otherComp?.type === HYD_TANK_TYPE) return { tank: otherComp, connectionId: conn.id };
  }
  return null;
}

/** Wires up "right-click a port -> None / Tank" so a return line to tank can be added to any
 * hydraulic port without leaving the canvas - the hydraulic equivalent of drawing the tank
 * symbol straight on a valve's T port, as circuit diagrams usually do. */
export function wireUpPortContextMenu(
  comp: Component,
  viewport: ViewportAdapter,
  spawn: SpawnFn,
): void {
  if (comp.type === HYD_TANK_TYPE) return;
  for (const port of Object.values(comp.ports)) {
    if (port.electrical) continue;
    const openMenu = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!canEdit(appState.mode)) return;
      const attached = findAttachedTank(comp, port.key);
      showContextMenu(e.clientX, e.clientY, [
        {
          label: attached ? 'None' : '✓ None',
          onClick: () => {
            if (!attached) return;
            const usedElsewhere = appState.connections.some(
              (c) =>
                c.id !== attached.connectionId &&
                (c.from.id === attached.tank.id || c.to.id === attached.tank.id),
            );
            if (usedElsewhere) removeConnection(attached.connectionId);
            else removeComponentAndConnections(attached.tank.id);
            redrawAllConnections();
          },
        },
        {
          label: attached ? '✓ Tank' : 'Tank',
          onClick: () => {
            if (attached) return;
            const rect = port.el.getBoundingClientRect();
            const w = viewport.clientToWorld(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            );
            const tank = spawn(HYD_TANK_TYPE, snap(w.x), snap(w.y + QUICK_TANK_OFFSET_Y));
            createConnection({ id: tank.id, port: 'T' }, { id: comp.id, port: port.key });
          },
        },
      ]);
    };
    port.el.addEventListener('contextmenu', openMenu);
  }
}
