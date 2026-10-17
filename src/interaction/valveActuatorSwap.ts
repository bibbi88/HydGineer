import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';
import type { Component } from '../core/types';
import { appState } from '../app/AppState';
import { spawnComponent } from './spawn';
import {
  createConnection,
  redrawConnection,
  removeComponentAndConnections,
} from '../wires/connection';
import { selectOnly } from './selection';
import { ELEC_COIL_TYPE, ELEC_SOLENOID_TYPE } from '../components/electrical';

let ctxRef: ComponentFactoryContext | null = null;
let viewportRef: ViewportAdapter | null = null;

export function initValveActuatorSwap(
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
): void {
  ctxRef = ctx;
  viewportRef = viewport;
}

/**
 * Replaces `comp` with a fresh component of `newType` at the same position, reconnecting every
 * wire that touched it. Used to "convert" between component types that differ enough in behavior
 * and artwork to stay separate types rather than one togglable mode, but share enough port keys
 * for most wires to carry over: a 3/2 valve between push-button, limit-switch and air-piloted
 * actuation (all three from `buildSlidingValve32Body`, sharing '1'/'2'/'3' - the air-piloted
 * variant's extra pilot port, '14', isn't on the other two), and a 5/2 valve between bistable
 * (valve52.ts) and monostable/spring-return (valve52Mono.ts) - they share '1' through '5' and
 * '14', but only the bistable one has a second pilot port, '12'. Either way, a wire on a port
 * that doesn't exist on the new component is dropped rather than reconnected somewhere invalid,
 * instead of silently becoming an invisible, un-removable connection with nowhere to land.
 */
export function swapComponentType(comp: Component, newType: string): void {
  if (!ctxRef || !viewportRef) return;
  const { x, y } = comp;
  // Contact <-> push button keeps its NO/NC choice, relay coil <-> solenoid keeps its name;
  // other swaps have no such fields.
  const { normallyClosed, key } = comp.snapshot() as Record<string, unknown>;
  const keepsKey =
    (comp.type === ELEC_COIL_TYPE || comp.type === ELEC_SOLENOID_TYPE) &&
    (newType === ELEC_COIL_TYPE || newType === ELEC_SOLENOID_TYPE);

  const related = appState.connections
    .filter((c) => c.from.id === comp.id || c.to.id === comp.id)
    .map((c) => ({
      from: c.from,
      to: c.to,
      guides: c.guides,
      stubStartLen: c.stubStartLen,
      stubEndLen: c.stubEndLen,
    }));

  appState.runSuppressed(() => {
    removeComponentAndConnections(comp.id);
    const next = spawnComponent(newType, ctxRef!, viewportRef!, x, y);
    if (normallyClosed !== undefined) next.restore({ ...next.snapshot(), normallyClosed });
    if (keepsKey && typeof key === 'string') next.restore({ ...next.snapshot(), key });

    for (const saved of related) {
      const fromMoved = saved.from.id === comp.id;
      const toMoved = saved.to.id === comp.id;
      // Only the end(s) that were actually on `comp` need to exist on `next` - the other end
      // belongs to some unrelated component (e.g. a source's own 'OUT' port) that the swap
      // never touched, so it's never in question here.
      if (fromMoved && !next.ports[saved.from.port]) continue;
      if (toMoved && !next.ports[saved.to.port]) continue;
      const from = fromMoved ? { id: next.id, port: saved.from.port } : saved.from;
      const to = toMoved ? { id: next.id, port: saved.to.port } : saved.to;
      const conn = createConnection(from, to);
      conn.guides = saved.guides;
      conn.stubStartLen = saved.stubStartLen;
      conn.stubEndLen = saved.stubEndLen;
      redrawConnection(conn);
    }

    selectOnly(next.id);
  });
}
