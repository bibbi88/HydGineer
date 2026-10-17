import type { Component } from '../core/types';
import { createJunction, JUNCTION_TYPE } from './junction';
import {
  createHydPump,
  createHydTank,
  createHydRelief,
  createHydGauge,
  createHydPressureSwitch,
  HYD_PUMP_TYPE,
  HYD_TANK_TYPE,
  HYD_RELIEF_TYPE,
  HYD_GAUGE_TYPE,
  HYD_PRESSURE_SWITCH_TYPE,
} from './hyd/supply';
import {
  createHydValve43,
  createHydValve42,
  createHydCheck,
  createHydPilotCheck,
  createHydThrottle,
  createHydOneWayFlowControl,
  createHydFlowControl,
  createHydReducing,
  HYD_VALVE_43_TYPE,
  HYD_VALVE_42_TYPE,
  HYD_CHECK_TYPE,
  HYD_PILOT_CHECK_TYPE,
  HYD_THROTTLE_TYPE,
  HYD_ONE_WAY_FC_TYPE,
  HYD_FLOW_CONTROL_TYPE,
  HYD_REDUCING_TYPE,
} from './hyd/valves';
import {
  createHydCylinderDouble,
  createHydCylinderSingle,
  createHydMotor,
  HYD_CYLINDER_DOUBLE_TYPE,
  HYD_CYLINDER_SINGLE_TYPE,
  HYD_MOTOR_TYPE,
} from './hyd/actuators';
import {
  createElecRailPlus,
  createElecRailZero,
  createElecContact,
  createElecPushButton,
  createElecChangeover,
  createElecCoil,
  createElecSolenoid,
  createElecLamp,
  ELEC_RAIL_PLUS_TYPE,
  ELEC_RAIL_ZERO_TYPE,
  ELEC_CONTACT_TYPE,
  ELEC_PUSH_BUTTON_TYPE,
  ELEC_CHANGEOVER_TYPE,
  ELEC_COIL_TYPE,
  ELEC_SOLENOID_TYPE,
  ELEC_LAMP_TYPE,
} from './electrical';
import { createPlc, PLC_TYPE } from './plc';
import { createTextAnnotation, TEXT_ANNOTATION_TYPE } from './textAnnotation';

export interface ComponentFactoryContext {
  compLayer: HTMLElement;
}

export type ComponentFactory = (ctx: ComponentFactoryContext, x: number, y: number) => Component;

/** Sidebar grouping, in the order a hydraulics reference presents symbols: energy supply,
 * directional control, pressure control, flow control, actuators. */
export const ComponentCategory = {
  SUPPLY: 'Power supply',
  DIRECTIONAL: 'Directional valves',
  PRESSURE: 'Pressure control',
  FLOW: 'Flow & check valves',
  ACTUATORS: 'Actuators',
  MEASURING: 'Measuring',
  ELECTRICAL: 'Electrical',
  ANNOTATIONS: 'Annotations',
} as const;
export type ComponentCategoryName = (typeof ComponentCategory)[keyof typeof ComponentCategory];

export interface RegistryEntry {
  factory: ComponentFactory;
  /** Sidebar tile label. */
  label: string;
  /** False for types only ever created programmatically (e.g. junction, via wire-splitting). */
  placeable: boolean;
  /** Sidebar group; only meaningful when placeable. */
  category?: ComponentCategoryName;
}

export const componentRegistry = new Map<string, RegistryEntry>([
  [
    HYD_PUMP_TYPE,
    {
      factory: (ctx, x, y) => createHydPump(ctx.compLayer, x, y),
      label: 'Pump unit (fixed displacement)',
      placeable: true,
      category: ComponentCategory.SUPPLY,
    },
  ],
  [
    HYD_TANK_TYPE,
    {
      factory: (ctx, x, y) => createHydTank(ctx.compLayer, x, y),
      label: 'Tank',
      placeable: true,
      category: ComponentCategory.SUPPLY,
    },
  ],
  [
    HYD_VALVE_43_TYPE,
    {
      factory: (ctx, x, y) => createHydValve43(ctx.compLayer, x, y),
      label: '4/3 valve',
      placeable: true,
      category: ComponentCategory.DIRECTIONAL,
    },
  ],
  [
    HYD_VALVE_42_TYPE,
    {
      factory: (ctx, x, y) => createHydValve42(ctx.compLayer, x, y),
      label: '4/2 valve',
      placeable: true,
      category: ComponentCategory.DIRECTIONAL,
    },
  ],
  [
    HYD_RELIEF_TYPE,
    {
      factory: (ctx, x, y) => createHydRelief(ctx.compLayer, x, y),
      label: 'Pressure relief valve',
      placeable: true,
      category: ComponentCategory.PRESSURE,
    },
  ],
  [
    HYD_REDUCING_TYPE,
    {
      factory: (ctx, x, y) => createHydReducing(ctx.compLayer, x, y),
      label: 'Pressure reducing valve',
      placeable: true,
      category: ComponentCategory.PRESSURE,
    },
  ],
  [
    HYD_CHECK_TYPE,
    {
      factory: (ctx, x, y) => createHydCheck(ctx.compLayer, x, y),
      label: 'Check valve',
      placeable: true,
      category: ComponentCategory.FLOW,
    },
  ],
  [
    HYD_PILOT_CHECK_TYPE,
    {
      factory: (ctx, x, y) => createHydPilotCheck(ctx.compLayer, x, y),
      label: 'Pilot-operated check valve',
      placeable: true,
      category: ComponentCategory.FLOW,
    },
  ],
  [
    HYD_THROTTLE_TYPE,
    {
      factory: (ctx, x, y) => createHydThrottle(ctx.compLayer, x, y),
      label: 'Throttle valve',
      placeable: true,
      category: ComponentCategory.FLOW,
    },
  ],
  [
    HYD_ONE_WAY_FC_TYPE,
    {
      factory: (ctx, x, y) => createHydOneWayFlowControl(ctx.compLayer, x, y),
      label: 'One-way flow control',
      placeable: true,
      category: ComponentCategory.FLOW,
    },
  ],
  [
    HYD_FLOW_CONTROL_TYPE,
    {
      factory: (ctx, x, y) => createHydFlowControl(ctx.compLayer, x, y),
      label: 'Flow control (pressure comp.)',
      placeable: true,
      category: ComponentCategory.FLOW,
    },
  ],
  [
    HYD_CYLINDER_DOUBLE_TYPE,
    {
      factory: (ctx, x, y) => createHydCylinderDouble(ctx.compLayer, x, y),
      label: 'Cylinder, double-acting',
      placeable: true,
      category: ComponentCategory.ACTUATORS,
    },
  ],
  [
    HYD_CYLINDER_SINGLE_TYPE,
    {
      factory: (ctx, x, y) => createHydCylinderSingle(ctx.compLayer, x, y),
      label: 'Cylinder, single-acting',
      placeable: true,
      category: ComponentCategory.ACTUATORS,
    },
  ],
  [
    HYD_MOTOR_TYPE,
    {
      factory: (ctx, x, y) => createHydMotor(ctx.compLayer, x, y),
      label: 'Hydraulic motor',
      placeable: true,
      category: ComponentCategory.ACTUATORS,
    },
  ],
  [
    HYD_GAUGE_TYPE,
    {
      factory: (ctx, x, y) => createHydGauge(ctx.compLayer, x, y),
      label: 'Pressure gauge',
      placeable: true,
      category: ComponentCategory.MEASURING,
    },
  ],
  [
    HYD_PRESSURE_SWITCH_TYPE,
    {
      factory: (ctx, x, y) => createHydPressureSwitch(ctx.compLayer, x, y),
      label: 'Pressure switch',
      placeable: true,
      category: ComponentCategory.MEASURING,
    },
  ],
  [
    ELEC_RAIL_PLUS_TYPE,
    {
      factory: (ctx, x, y) => createElecRailPlus(ctx.compLayer, x, y),
      label: '+24 V supply',
      placeable: true,
      category: ComponentCategory.ELECTRICAL,
    },
  ],
  [
    ELEC_RAIL_ZERO_TYPE,
    {
      factory: (ctx, x, y) => createElecRailZero(ctx.compLayer, x, y),
      label: '0 V supply',
      placeable: true,
      category: ComponentCategory.ELECTRICAL,
    },
  ],
  [
    ELEC_PUSH_BUTTON_TYPE,
    {
      factory: (ctx, x, y) => createElecPushButton(ctx.compLayer, x, y),
      label: 'Push button NO',
      placeable: true,
      category: ComponentCategory.ELECTRICAL,
    },
  ],
  [
    ELEC_CONTACT_TYPE,
    {
      factory: (ctx, x, y) => createElecContact(ctx.compLayer, x, y),
      label: 'Contact NO',
      placeable: true,
      category: ComponentCategory.ELECTRICAL,
    },
  ],
  // Sidebar shortcuts for the normally-closed variants: same component types as the plain ones
  // (saved projects, the inspector and swapping all key off comp.type, which stays
  // 'elecContact' / 'elecPushButton'), just pre-set to NC - the registry key only has to be
  // unique for the sidebar tile.
  [
    'elecContactNc',
    {
      factory: (ctx, x, y) => {
        const c = createElecContact(ctx.compLayer, x, y);
        c.restore({ ...c.snapshot(), normallyClosed: true });
        return c;
      },
      label: 'Contact NC',
      placeable: true,
      category: ComponentCategory.ELECTRICAL,
    },
  ],
  [
    'elecPushButtonNc',
    {
      factory: (ctx, x, y) => {
        const c = createElecPushButton(ctx.compLayer, x, y);
        c.restore({ ...c.snapshot(), normallyClosed: true });
        return c;
      },
      label: 'Push button NC',
      placeable: true,
      category: ComponentCategory.ELECTRICAL,
    },
  ],
  [
    ELEC_CHANGEOVER_TYPE,
    {
      factory: (ctx, x, y) => createElecChangeover(ctx.compLayer, x, y),
      label: 'Changeover contact',
      placeable: true,
      category: ComponentCategory.ELECTRICAL,
    },
  ],
  [
    ELEC_COIL_TYPE,
    {
      factory: (ctx, x, y) => createElecCoil(ctx.compLayer, x, y),
      label: 'Relay coil',
      placeable: true,
      category: ComponentCategory.ELECTRICAL,
    },
  ],
  [
    ELEC_SOLENOID_TYPE,
    {
      factory: (ctx, x, y) => createElecSolenoid(ctx.compLayer, x, y),
      label: 'Solenoid (valve coil)',
      placeable: true,
      category: ComponentCategory.ELECTRICAL,
    },
  ],
  [
    ELEC_LAMP_TYPE,
    {
      factory: (ctx, x, y) => createElecLamp(ctx.compLayer, x, y),
      label: 'Lamp',
      placeable: true,
      category: ComponentCategory.ELECTRICAL,
    },
  ],
  [
    PLC_TYPE,
    {
      factory: (ctx, x, y) => createPlc(ctx.compLayer, x, y),
      label: 'PLC',
      placeable: true,
      category: ComponentCategory.ELECTRICAL,
    },
  ],
  [
    JUNCTION_TYPE,
    {
      factory: (ctx, x, y) => createJunction(ctx.compLayer, x, y),
      label: 'Junction',
      placeable: false,
    },
  ],
  [
    TEXT_ANNOTATION_TYPE,
    {
      factory: (ctx, x, y) => createTextAnnotation(ctx.compLayer, x, y),
      label: 'Text note',
      placeable: true,
      category: ComponentCategory.ANNOTATIONS,
    },
  ],
]);

export function createComponent(
  type: string,
  ctx: ComponentFactoryContext,
  x: number,
  y: number,
): Component {
  const entry = componentRegistry.get(type);
  if (!entry) throw new Error(`Unknown component type: ${type}`);
  return entry.factory(ctx, x, y);
}

const CATEGORY_ORDER: ComponentCategoryName[] = [
  ComponentCategory.SUPPLY,
  ComponentCategory.DIRECTIONAL,
  ComponentCategory.PRESSURE,
  ComponentCategory.FLOW,
  ComponentCategory.ACTUATORS,
  ComponentCategory.MEASURING,
  ComponentCategory.ELECTRICAL,
  ComponentCategory.ANNOTATIONS,
];

export interface ComponentGroup {
  category: ComponentCategoryName;
  items: Array<{ type: string; label: string }>;
}

/** Placeable component types grouped for the sidebar, in a fixed category order matching how a
 * hydraulics reference organizes symbols (supply -> valves -> pressure/flow control ->
 * actuators) rather than the registration order above. */
export function placeableComponentsByCategory(): ComponentGroup[] {
  const entries = [...componentRegistry.entries()].filter(([, entry]) => entry.placeable);
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: entries
      .filter(([, entry]) => entry.category === category)
      .map(([type, entry]) => ({ type, label: entry.label })),
  })).filter((group) => group.items.length > 0);
}
