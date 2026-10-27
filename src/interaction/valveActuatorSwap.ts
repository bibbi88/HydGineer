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
import {
  getComponentRotation,
  setComponentMirrored,
  setComponentRotation,
} from './componentContextMenu';
import { HYD_ROTARY_DIVIDER_TYPE, HYD_SPOOL_DIVIDER_TYPE } from '../components/hyd/dividers';
import {
  HYD_CHECK_TYPE,
  HYD_FLOW_CONTROL_TYPE,
  HYD_ONE_WAY_FC_TYPE,
  HYD_PILOT_CHECK_TYPE,
  HYD_THROTTLE_TYPE,
  HYD_VALVE_42_TYPE,
  HYD_VALVE_43_TYPE,
  HYD_VALVE_LS_TYPE,
} from '../components/hyd/valves';
import { HYD_PUMP_LS_TYPE, HYD_PUMP_TYPE } from '../components/hyd/supply';
import { HYD_MOTOR_TYPE, HYD_MOTOR_VAR_TYPE } from '../components/hyd/actuators';

/**
 * Groups of interchangeable component types: same job, same port names, so one can replace the
 * other in place with every wire kept - from the inspector's type dropdown, or by dropping one
 * from the library onto the other.
 */
export const SWAP_FAMILIES: Array<Array<{ type: string; label: string }>> = [
  [
    { type: HYD_SPOOL_DIVIDER_TYPE, label: 'Spool (pressure-compensated sleeve)' },
    { type: HYD_ROTARY_DIVIDER_TYPE, label: 'Rotary (gear)' },
  ],
  [
    { type: HYD_VALVE_43_TYPE, label: '4/3 (three positions)' },
    { type: HYD_VALVE_42_TYPE, label: '4/2 (two positions)' },
    { type: HYD_VALVE_LS_TYPE, label: 'Load-sensing, proportional (4/3 + LS port)' },
  ],
  [
    { type: HYD_PUMP_TYPE, label: 'Fixed or pressure-compensated' },
    { type: HYD_PUMP_LS_TYPE, label: 'Load-sensing (LS port)' },
  ],
  [
    { type: HYD_MOTOR_TYPE, label: 'Fixed displacement' },
    { type: HYD_MOTOR_VAR_TYPE, label: 'Variable displacement' },
  ],
  [
    { type: HYD_CHECK_TYPE, label: 'Check valve' },
    { type: HYD_PILOT_CHECK_TYPE, label: 'Pilot-operated check valve (X)' },
  ],
  [
    { type: HYD_THROTTLE_TYPE, label: 'Throttle (both ways)' },
    { type: HYD_ONE_WAY_FC_TYPE, label: 'One-way flow control (bypass check)' },
    { type: HYD_FLOW_CONTROL_TYPE, label: 'Pressure-compensated flow control' },
  ],
];

/** Ports a type names differently from the rest of its family, by the name they share: the
 * pilot-operated check's A/B are the check valve's IN/OUT. */
const PORT_ALIASES: Record<string, Record<string, string>> = {
  [HYD_PILOT_CHECK_TYPE]: { A: 'IN', B: 'OUT' },
};

function sharedPortName(type: string, port: string): string {
  return PORT_ALIASES[type]?.[port] ?? port;
}

function ownPortName(type: string, shared: string): string {
  const aliases = PORT_ALIASES[type] ?? {};
  return Object.keys(aliases).find((k) => aliases[k] === shared) ?? shared;
}

/** Which way an inline component's IN → OUT runs as drawn (unrotated): +1 down, -1 up, or null
 * if it has no such pair. */
function throughDirection(comp: Component): number | null {
  const pIn = comp.ports[ownPortName(comp.type, 'IN')];
  const pOut = comp.ports[ownPortName(comp.type, 'OUT')];
  if (!pIn || !pOut || pIn.cy === pOut.cy) return null;
  return Math.sign(pOut.cy - pIn.cy);
}

/** The other types `type` can be swapped with (empty if it has no family). */
export function swapFamilyOf(type: string): Array<{ type: string; label: string }> {
  return SWAP_FAMILIES.find((f) => f.some((m) => m.type === type)) ?? [];
}

function isMotor(type: string): boolean {
  return type === HYD_MOTOR_TYPE || type === HYD_MOTOR_VAR_TYPE;
}

export function canSwap(fromType: string, toType: string): boolean {
  return fromType !== toType && swapFamilyOf(fromType).some((m) => m.type === toType);
}

/** The component a library tile of `type` is being dropped onto, if it is one `type` can
 * replace in place (e.g. a rotary flow divider dropped on a spool one) - see SWAP_FAMILIES. */
export function dropSwapTarget(type: string, world: { x: number; y: number }): Component | null {
  for (const c of appState.components) {
    if (!canSwap(c.type, type)) continue;
    const b = c.getBounds();
    const pad = 10;
    if (
      world.x >= b.x - pad &&
      world.x <= b.x + b.w + pad &&
      world.y >= b.y - pad &&
      world.y <= b.y + b.h + pad
    ) {
      return c;
    }
  }
  return null;
}

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
 * `extra` settings are applied to the new component in the same undo step.
 */
export function swapComponentType(
  comp: Component,
  newType: string,
  extra?: Record<string, unknown>,
): void {
  if (!ctxRef || !viewportRef) return;
  const { x, y } = comp;
  // Contact <-> push button keeps its NO/NC choice, relay coil <-> solenoid keeps its name;
  // other swaps have no such fields.
  const { normallyClosed, key, showName, customName, displacement, torque, etaHm, diameter } =
    comp.snapshot() as Record<string, unknown>;
  const rotation = getComponentRotation(comp);
  const mirrored = comp.el.dataset.mirror === '1';
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
    // Fixed <-> variable motor keeps its size and load.
    if (isMotor(comp.type) && isMotor(newType)) {
      next.restore({ ...next.snapshot(), displacement, torque, etaHm });
    }
    // Throttle <-> one-way flow control keeps its orifice.
    if (diameter !== undefined && 'diameter' in next.snapshot()) {
      next.restore({ ...next.snapshot(), diameter });
    }
    // Same place on the drawing: orientation and naming carry over to the replacement. One
    // drawn with its IN -> OUT the other way round is turned over, so the flow keeps its way.
    const oldDir = throughDirection(comp);
    const newDir = throughDirection(next);
    const flip = oldDir !== null && newDir !== null && oldDir !== newDir ? 180 : 0;
    if (rotation || flip) setComponentRotation(next, (rotation + flip) % 360);
    if (mirrored) setComponentMirrored(next, true);
    if (showName !== undefined || customName !== undefined) {
      next.restore({ ...next.snapshot(), showName, customName });
    }
    // Settings the caller picked along with the type (e.g. a pump's control), in the same step.
    if (extra) next.restore({ ...next.snapshot(), ...extra });

    for (const saved of related) {
      const fromMoved = saved.from.id === comp.id;
      const toMoved = saved.to.id === comp.id;
      // Only the end(s) that were actually on `comp` need to exist on `next` - the other end
      // belongs to some unrelated component (e.g. a source's own 'OUT' port) that the swap
      // never touched, so it's never in question here.
      const onNext = (port: string): string =>
        ownPortName(newType, sharedPortName(comp.type, port));
      if (fromMoved && !next.ports[onNext(saved.from.port)]) continue;
      if (toMoved && !next.ports[onNext(saved.to.port)]) continue;
      const from = fromMoved ? { id: next.id, port: onNext(saved.from.port) } : saved.from;
      const to = toMoved ? { id: next.id, port: onNext(saved.to.port) } : saved.to;
      const conn = createConnection(from, to);
      conn.guides = saved.guides;
      conn.stubStartLen = saved.stubStartLen;
      conn.stubEndLen = saved.stubEndLen;
      redrawConnection(conn);
    }

    selectOnly(next.id);
  });
}
