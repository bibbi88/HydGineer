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
import { SOURCE_TYPE } from '../components/source';
import { snap } from '../core/grid';

/** Same shape as spawn.ts's spawnComponent - injected rather than imported directly, since
 * spawn.ts is the one place that calls wireUpPortContextMenu on every component it creates
 * (including a quick-added source), and importing spawnComponent back from here would make the
 * two modules import each other. */
export type SpawnFn = (type: string, x: number, y: number) => Component;

/** How far below a port a quick-added pressure source is placed by default - just a starting
 * point, since the source is an ordinary component the user can drag anywhere afterward. */
const QUICK_SOURCE_OFFSET_Y = 80;

interface AttachedSource {
  source: Component;
  connectionId: number;
}

/** Finds a pressure source wired directly to this exact port, if any - the state the port's
 * quick-add menu reflects and toggles. */
function findAttachedSource(comp: Component, portKey: PortKey): AttachedSource | null {
  for (const conn of appState.connections) {
    let otherEndpoint: { id: number; port: PortKey } | null = null;
    if (conn.from.id === comp.id && conn.from.port === portKey) otherEndpoint = conn.to;
    else if (conn.to.id === comp.id && conn.to.port === portKey) otherEndpoint = conn.from;
    if (!otherEndpoint) continue;

    const other = appState.findComponent(otherEndpoint.id);
    if (other?.type === SOURCE_TYPE) return { source: other, connectionId: conn.id };
  }
  return null;
}

/** The snapshot key of this port's built-in silencer option (e.g. 'silencer3' for an exhaust
 * port 3), or null if the component has no silencer option for this port. */
function silencerKey(comp: Component, portKey: PortKey): string | null {
  const key = `silencer${portKey}`;
  return key in comp.snapshot() ? key : null;
}

function setSilencer(comp: Component, key: string, on: boolean): void {
  comp.restore({ ...comp.snapshot(), [key]: on ? 'silencer' : 'none' });
  redrawAllConnections();
  appState.markDirty();
}

/** Wires up "right-click a port -> None / Pressure source / Silencer" so a supply (or, on an
 * exhaust port, a silencer) can be added to any port without leaving the canvas. Picking
 * "Pressure source" adds a new source component and a wire straight to this port; picking "None"
 * removes that wire, plus the source itself if nothing else is still using it (a source shared
 * with another port is left in place - only the wire to *this* port goes). A source added this
 * way can always also just be deleted manually like any other component.
 *
 * "Silencer" is offered only on ports with a built-in silencer option (the valves' exhaust ports,
 * same setting as the inspector's "Port 3 silencer") and only while nothing but a quick-added
 * source is wired there - a silencer can't share a port with a wire. A silenced port's own dot
 * stops taking clicks (shared/silencer.ts), so the silencer symbol itself opens the same menu. */
export function wireUpPortContextMenu(
  comp: Component,
  viewport: ViewportAdapter,
  spawn: SpawnFn,
): void {
  for (const port of Object.values(comp.ports)) {
    const openMenu = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!canEdit(appState.mode)) return;

      const attached = findAttachedSource(comp, port.key);
      const silKey = silencerKey(comp, port.key);
      const silenced = silKey !== null && comp.snapshot()[silKey] === 'silencer';
      const otherWires = appState.connections.some(
        (c) =>
          c.id !== attached?.connectionId &&
          ((c.from.id === comp.id && c.from.port === port.key) ||
            (c.to.id === comp.id && c.to.port === port.key)),
      );

      const removeAttachedSource = (): void => {
        if (!attached) return;
        const sourceStillUsedElsewhere = appState.connections.some(
          (c) =>
            c.id !== attached.connectionId &&
            (c.from.id === attached.source.id || c.to.id === attached.source.id),
        );
        if (sourceStillUsedElsewhere) removeConnection(attached.connectionId);
        else removeComponentAndConnections(attached.source.id);
        redrawAllConnections();
      };

      const items = [
        {
          label: attached || silenced ? 'None' : '✓ None',
          onClick: () => {
            removeAttachedSource();
            if (silenced && silKey) setSilencer(comp, silKey, false);
          },
        },
        {
          label: attached ? '✓ Pressure source' : 'Pressure source',
          onClick: () => {
            if (attached) return;
            if (silenced && silKey) setSilencer(comp, silKey, false);
            const rect = port.el.getBoundingClientRect();
            const portWorld = viewport.clientToWorld(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            );
            const source = spawn(
              SOURCE_TYPE,
              snap(portWorld.x),
              snap(portWorld.y + QUICK_SOURCE_OFFSET_Y),
            );
            createConnection({ id: source.id, port: 'OUT' }, { id: comp.id, port: port.key });
          },
        },
      ];
      if (silKey && !otherWires) {
        items.push({
          label: silenced ? '✓ Silencer' : 'Silencer',
          onClick: () => {
            if (silenced) return;
            removeAttachedSource();
            setSilencer(comp, silKey, true);
          },
        });
      }
      showContextMenu(e.clientX, e.clientY, items);
    };

    port.el.addEventListener('contextmenu', openMenu);
    comp.el
      .querySelector<SVGGElement>(`.silencerSymbol[data-port="${port.key}"]`)
      ?.addEventListener('contextmenu', openMenu);
  }
}
