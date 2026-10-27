import type { Component } from '../core/types';
import type { ProjectBarRefs } from './projectBar';
import { openTipsDialog } from './tipsDialog';
import { openTermsDialog } from './termsDialog';
import { createIcon, type IconName } from './icons';
import { iconButton } from './iconButton';
import { canEdit } from '../app/modes';
import {
  alignComponents,
  distributeComponents,
  type AlignMode,
  type DistributeAxis,
} from '../interaction/align';
import { appState } from '../app/AppState';
import { getSelectedComponents, onSelectionChange } from '../interaction/selection';
import { redrawAllConnections } from '../wires/connection';
import { setPageFrameSize, renderPageFrame, type PageFrameSize } from './pageFrame';
import {
  HYD_PUMP_TYPE,
  HYD_RELIEF_TYPE,
  HYD_GAUGE_TYPE,
  HYD_PRESSURE_SWITCH_TYPE,
  HYD_ACCUMULATOR_TYPE,
  HYD_PUMP_LS_TYPE,
  HYD_PUMP_LOOP_TYPE,
} from '../components/hyd/supply';
import {
  CENTER_OPTIONS,
  HYD_VALVE_43_TYPE,
  HYD_VALVE_42_TYPE,
  HYD_CHECK_TYPE,
  HYD_PILOT_CHECK_TYPE,
  HYD_THROTTLE_TYPE,
  HYD_ONE_WAY_FC_TYPE,
  HYD_FLOW_CONTROL_TYPE,
  HYD_REDUCING_TYPE,
  HYD_COUNTERBALANCE_TYPE,
  HYD_SEQUENCE_TYPE,
  HYD_VALVE_LS_TYPE,
  HYD_PRESSURE_COMP_TYPE,
  HYD_CROSS_RELIEF_TYPE,
} from '../components/hyd/valves';
import {
  HYD_CYLINDER_DOUBLE_TYPE,
  HYD_CYLINDER_SINGLE_TYPE,
  HYD_MOTOR_TYPE,
  HYD_MOTOR_VAR_TYPE,
} from '../components/hyd/actuators';
import { HYD_SPOOL_DIVIDER_TYPE, HYD_ROTARY_DIVIDER_TYPE } from '../components/hyd/dividers';
import {
  nextSensorLabel,
  isSensorLabelInUse,
  isSensorKeyBoundElsewhere,
  listAllSensorLabels,
  type CylinderSensor,
} from '../components/shared/sensorPositions';
import { swapComponentType, swapFamilyOf } from '../interaction/valveActuatorSwap';
import { JUNCTION_TYPE } from '../components/junction';
import { PLC_TYPE } from '../components/plc';
import {
  ELEC_CONTACT_TYPE,
  ELEC_COIL_TYPE,
  ELEC_SOLENOID_TYPE,
  ELEC_PUSH_BUTTON_TYPE,
  ELEC_CHANGEOVER_TYPE,
} from '../components/electrical';
import { NOTE_STYLES, TEXT_ANNOTATION_TYPE } from '../components/textAnnotation';

type FieldLabel = string | ((comp: Component) => string);

interface NumberField {
  kind: 'number';
  key: string;
  label: FieldLabel;
  min?: number;
  max?: number;
  step?: number;
}

interface TextField {
  kind: 'text';
  key: string;
  label: FieldLabel;
}

/** A snapshot value shown for reference but not directly editable - e.g. the PLC's program text,
 * which is now generated from its graphical editor (see plcEditorDialog.ts) rather than typed. */
interface ReadonlyTextField {
  kind: 'readonlyText';
  key: string;
  label: FieldLabel;
}

/** A plain boolean snapshot key/value, e.g. a cylinder's "show force" toggle. */
interface CheckboxField {
  kind: 'checkbox';
  key: string;
  label: FieldLabel;
}

/** A limit switch's sensor key, shown as a dropdown of every sensor label that actually exists
 * in the project rather than free text - binding becomes a choice, not something that can
 * silently typo-mismatch a cylinder's signal. */
interface SensorKeySelectField {
  kind: 'sensorKeySelect';
  key: string;
  label: FieldLabel;
}

/** An open-ended, addable/removable list of named ranges - currently only a cylinder's sensors,
 * each read/written as a whole array under `arrayKey` rather than one scalar key per field. */
interface SensorListField {
  kind: 'sensorList';
  arrayKey: string;
  min?: number;
  max?: number;
  step?: number;
}

/** A choice between whole component types (see interaction/valveActuatorSwap.ts's own doc for
 * why, e.g. push-button vs limit-switch vs air-piloted, or a 5/2 valve's bistable vs monostable
 * pilot), not a scalar snapshot field - shown as a dropdown that replaces the component in place
 * when changed, reconnecting every wire whose port exists on both. */
interface ActuatorModeField {
  kind: 'actuatorMode';
  label: string;
  options: Array<{ type: string; label: string }>;
}

/** A pump's type in one dropdown: fixed or pressure-compensated (the same component, its
 * `control` setting) or load-sensing (a different component, with an LS port, swapped in). */
interface PumpTypeField {
  kind: 'pumpType';
}

/** A component's own identifying label (currently just a cylinder's letter), renamed through
 * `comp.renameLabel()` rather than a plain snapshot key/value - that's what cascades the rename
 * into the cylinder's sensor labels and anything bound to them. */
interface RelabelField {
  kind: 'relabel';
  label: FieldLabel;
}

/** A single-acting cylinder's push/pull mode, switched through `comp.setCylinderMode()` rather
 * than a plain snapshot key/value - that's what snaps the piston straight to the new mode's own
 * default rest position instead of just changing which end pressurizing port A extends toward. */
interface CylinderModeField {
  kind: 'cylinderMode';
}

/** Whether a muffler symbol is attached directly to one of this valve's exhaust ports - a plain
 * snapshot key/value like `number`/`text`, just rendered as a None/Silencer dropdown instead of
 * a free-form input. `port` is the actual port key this attaches to (e.g. "3"), checked against
 * live wiring before a silencer is allowed on - a port already carrying a wire can't also take
 * one, since the two occupy the same physical connection point. */
interface SilencerField {
  kind: 'silencer';
  key: string;
  port: string;
  label: FieldLabel;
}

/** A plain snapshot key/value picked from a fixed list, e.g. a note's style. */
interface SelectField {
  kind: 'select';
  key: string;
  label: FieldLabel;
  options: Array<{ value: string; label: string }>;
}

/** Free text over several lines, e.g. a note's own text. */
interface MultilineTextField {
  kind: 'multilineText';
  key: string;
  label: FieldLabel;
}

type InspectorField =
  | SelectField
  | MultilineTextField
  | NumberField
  | TextField
  | ReadonlyTextField
  | CheckboxField
  | SensorListField
  | ActuatorModeField
  | PumpTypeField
  | SensorKeySelectField
  | RelabelField
  | CylinderModeField
  | SilencerField;

const ELEC_CONTACT_MODES: Array<{ type: string; label: string }> = [
  { type: ELEC_CONTACT_TYPE, label: 'Contact (relay / sensor)' },
  { type: ELEC_PUSH_BUTTON_TYPE, label: 'Push button' },
];

const ELEC_COIL_MODES: Array<{ type: string; label: string }> = [
  { type: ELEC_COIL_TYPE, label: 'Relay coil' },
  { type: ELEC_SOLENOID_TYPE, label: 'Solenoid (valve coil)' },
];

const ACTUATION_OPTIONS = [
  { value: 'solenoid', label: 'Solenoid (electric)' },
  { value: 'lever', label: 'Hand lever with detent' },
];

const VALVE_FLOW_FIELD: NumberField = {
  kind: 'number',
  key: 'qNom',
  label: 'Nominal flow (L/min at Δp 5 bar per path)',
  min: 0.1,
  max: 2000,
  step: 1,
};

const INSPECTOR_FIELDS: Record<string, InspectorField[]> = {
  [HYD_PUMP_TYPE]: [
    { kind: 'pumpType' },
    {
      kind: 'number',
      key: 'displacement',
      label: 'Displacement (cm³/rev)',
      min: 0,
      max: 1000,
      step: 0.5,
    },
    { kind: 'number', key: 'speed', label: 'Motor speed (rpm)', min: 0, max: 10000, step: 10 },
    { kind: 'number', key: 'etaV', label: 'Volumetric efficiency (%)', min: 50, max: 100, step: 1 },
    {
      kind: 'number',
      key: 'etaHm',
      label: 'Hydromechanical efficiency (%)',
      min: 50,
      max: 100,
      step: 1,
    },
    {
      kind: 'number',
      key: 'ratedPressure',
      label: 'Rated pressure (bar)',
      min: 1,
      max: 1000,
      step: 10,
    },
    {
      kind: 'number',
      key: 'compSetting',
      label: 'Compensator setting (bar) - pressure compensated only',
      min: 1,
      max: 1000,
      step: 5,
    },
    {
      kind: 'text',
      key: 'signal',
      label: 'Motor signal (empty = always on; K1 = runs while K1 is on; !S1 = while S1 is off)',
    },
  ],
  [HYD_PUMP_LS_TYPE]: [
    { kind: 'pumpType' },
    {
      kind: 'number',
      key: 'displacement',
      label: 'Max displacement (cm³/rev)',
      min: 0,
      max: 1000,
      step: 0.5,
    },
    { kind: 'number', key: 'speed', label: 'Motor speed (rpm)', min: 0, max: 10000, step: 10 },
    {
      kind: 'number',
      key: 'margin',
      label: 'LS margin / standby pressure (bar)',
      min: 1,
      max: 100,
      step: 1,
    },
    {
      kind: 'number',
      key: 'compSetting',
      label: 'Max pressure cut-off (bar)',
      min: 1,
      max: 1000,
      step: 5,
    },
    { kind: 'number', key: 'etaV', label: 'Volumetric efficiency (%)', min: 50, max: 100, step: 1 },
    {
      kind: 'number',
      key: 'etaHm',
      label: 'Hydromechanical efficiency (%)',
      min: 50,
      max: 100,
      step: 1,
    },
    {
      kind: 'number',
      key: 'ratedPressure',
      label: 'Rated pressure (bar)',
      min: 1,
      max: 1000,
      step: 10,
    },
    {
      kind: 'text',
      key: 'signal',
      label: 'Motor signal (empty = always on; K1 = runs while K1 is on; !S1 = while S1 is off)',
    },
  ],
  [HYD_VALVE_LS_TYPE]: [
    { kind: 'actuatorMode', label: 'Valve type', options: swapFamilyOf(HYD_VALVE_LS_TYPE) },
    {
      kind: 'select',
      key: 'actuation',
      label: 'Actuation',
      options: [
        { value: 'lever', label: 'Proportional lever (slider while simulating)' },
        { value: 'solenoid', label: 'Solenoids, to a set stroke' },
      ],
    },
    {
      kind: 'number',
      key: 'qNom',
      label: 'Rated flow at full stroke (L/min at Δp 15 bar)',
      min: 0.1,
      max: 2000,
      step: 1,
    },
    { kind: 'checkbox', key: 'compensated', label: 'Section pressure compensator' },
    { kind: 'text', key: 'keyLeft', label: 'Left solenoid (P→A)' },
    { kind: 'text', key: 'keyRight', label: 'Right solenoid (P→B)' },
    {
      kind: 'number',
      key: 'solenoidStroke',
      label: 'Solenoid stroke (%)',
      min: 0,
      max: 100,
      step: 5,
    },
  ],
  [HYD_PRESSURE_COMP_TYPE]: [
    {
      kind: 'number',
      key: 'setting',
      label: 'Δp held above LS pressure (bar)',
      min: 0.5,
      max: 100,
      step: 0.5,
    },
    {
      kind: 'number',
      key: 'qNom',
      label: 'Nominal flow (L/min at Δp 5 bar, fully open)',
      min: 0.5,
      max: 2000,
      step: 1,
    },
  ],
  [HYD_PUMP_LOOP_TYPE]: [
    {
      kind: 'number',
      key: 'displacement',
      label: 'Max displacement (cm³/rev)',
      min: 0,
      max: 1000,
      step: 0.5,
    },
    { kind: 'number', key: 'speed', label: 'Drive speed (rpm)', min: 0, max: 10000, step: 10 },
    {
      kind: 'number',
      key: 'etaV',
      label: 'Volumetric efficiency at rated pressure (%)',
      min: 50,
      max: 100,
      step: 1,
    },
    {
      kind: 'number',
      key: 'etaHm',
      label: 'Hydromechanical efficiency (%)',
      min: 50,
      max: 100,
      step: 1,
    },
    {
      kind: 'number',
      key: 'ratedPressure',
      label: 'Rated pressure (bar)',
      min: 1,
      max: 1000,
      step: 10,
    },
  ],
  [HYD_CROSS_RELIEF_TYPE]: [
    {
      kind: 'number',
      key: 'setting',
      label: 'Cracking pressure, both valves (bar)',
      min: 1,
      max: 700,
      step: 5,
    },
  ],
  [HYD_ACCUMULATOR_TYPE]: [
    { kind: 'number', key: 'volume', label: 'Nominal volume (L)', min: 0.01, max: 1000, step: 0.1 },
    { kind: 'number', key: 'precharge', label: 'Gas pre-charge (bar)', min: 0, max: 700, step: 5 },
    {
      kind: 'number',
      key: 'n',
      label: 'Polytropic exponent (1 = slow/isothermal, 1.4 = fast/adiabatic)',
      min: 1,
      max: 1.4,
      step: 0.05,
    },
  ],
  [HYD_COUNTERBALANCE_TYPE]: [
    {
      kind: 'number',
      key: 'setting',
      label: 'Setting (bar) - about 1.3 × holding pressure',
      min: 1,
      max: 700,
      step: 5,
    },
    { kind: 'number', key: 'ratio', label: 'Pilot ratio', min: 1, max: 20, step: 0.5 },
    {
      kind: 'number',
      key: 'qNom',
      label: 'Nominal flow (L/min at Δp 5 bar)',
      min: 0.5,
      max: 2000,
      step: 1,
    },
  ],
  [HYD_SEQUENCE_TYPE]: [
    { kind: 'number', key: 'setting', label: 'Opening pressure (bar)', min: 1, max: 700, step: 5 },
    {
      kind: 'number',
      key: 'qNom',
      label: 'Nominal flow (L/min at Δp 5 bar)',
      min: 0.5,
      max: 2000,
      step: 1,
    },
    { kind: 'checkbox', key: 'check', label: 'Bypass check valve (free A→P)' },
  ],
  [HYD_RELIEF_TYPE]: [
    { kind: 'number', key: 'setting', label: 'Cracking pressure (bar)', min: 0, max: 700, step: 5 },
  ],
  [HYD_REDUCING_TYPE]: [
    { kind: 'number', key: 'setting', label: 'Outlet pressure (bar)', min: 0, max: 700, step: 5 },
  ],
  [HYD_GAUGE_TYPE]: [
    { kind: 'number', key: 'range', label: 'Scale range (bar)', min: 1, max: 1000, step: 10 },
  ],
  [HYD_PRESSURE_SWITCH_TYPE]: [
    {
      kind: 'number',
      key: 'setting',
      label: 'Switching pressure (bar)',
      min: 0,
      max: 700,
      step: 5,
    },
    { kind: 'text', key: 'key', label: 'Signal name (e.g. S1)' },
  ],
  [HYD_VALVE_43_TYPE]: [
    { kind: 'actuatorMode', label: 'Valve type', options: swapFamilyOf(HYD_VALVE_43_TYPE) },
    { kind: 'select', key: 'actuation', label: 'Actuation', options: ACTUATION_OPTIONS },
    { kind: 'select', key: 'center', label: 'Centre position', options: CENTER_OPTIONS },
    { kind: 'text', key: 'keyLeft', label: 'Left solenoid (P→A, B→T)' },
    { kind: 'text', key: 'keyRight', label: 'Right solenoid (P→B, A→T)' },
    VALVE_FLOW_FIELD,
  ],
  [HYD_VALVE_42_TYPE]: [
    { kind: 'actuatorMode', label: 'Valve type', options: swapFamilyOf(HYD_VALVE_42_TYPE) },
    { kind: 'select', key: 'actuation', label: 'Actuation', options: ACTUATION_OPTIONS },
    { kind: 'text', key: 'key', label: 'Solenoid (energized: P→A, B→T)' },
    VALVE_FLOW_FIELD,
  ],
  [HYD_CHECK_TYPE]: [
    { kind: 'actuatorMode', label: 'Valve type', options: swapFamilyOf(HYD_CHECK_TYPE) },
    { kind: 'number', key: 'crack', label: 'Cracking pressure (bar)', min: 0, max: 50, step: 0.5 },
  ],
  [HYD_PILOT_CHECK_TYPE]: [
    { kind: 'actuatorMode', label: 'Valve type', options: swapFamilyOf(HYD_PILOT_CHECK_TYPE) },
    { kind: 'number', key: 'ratio', label: 'Pilot ratio', min: 1, max: 20, step: 0.5 },
  ],
  [HYD_THROTTLE_TYPE]: [
    { kind: 'actuatorMode', label: 'Valve type', options: swapFamilyOf(HYD_THROTTLE_TYPE) },
    { kind: 'number', key: 'diameter', label: 'Orifice diameter (mm)', min: 0, max: 50, step: 0.1 },
  ],
  [HYD_ONE_WAY_FC_TYPE]: [
    { kind: 'actuatorMode', label: 'Valve type', options: swapFamilyOf(HYD_ONE_WAY_FC_TYPE) },
    {
      kind: 'number',
      key: 'diameter',
      label: 'Orifice diameter (mm), IN→OUT',
      min: 0,
      max: 50,
      step: 0.1,
    },
  ],
  [HYD_FLOW_CONTROL_TYPE]: [
    { kind: 'actuatorMode', label: 'Valve type', options: swapFamilyOf(HYD_FLOW_CONTROL_TYPE) },
    { kind: 'number', key: 'qSet', label: 'Set flow (L/min)', min: 0, max: 2000, step: 0.5 },
    { kind: 'checkbox', key: 'bypass', label: 'Bypass check valve (free OUT→IN)' },
  ],
  [HYD_SPOOL_DIVIDER_TYPE]: [
    { kind: 'actuatorMode', label: 'Divider type', options: swapFamilyOf(HYD_SPOOL_DIVIDER_TYPE) },
    {
      kind: 'number',
      key: 'ratioA',
      label: 'Share to A (%) - B gets the rest',
      min: 5,
      max: 95,
      step: 5,
    },
    {
      kind: 'number',
      key: 'qNom',
      label: 'Nominal inlet flow (L/min)',
      min: 0.5,
      max: 2000,
      step: 1,
    },
  ],
  [HYD_ROTARY_DIVIDER_TYPE]: [
    { kind: 'actuatorMode', label: 'Divider type', options: swapFamilyOf(HYD_ROTARY_DIVIDER_TYPE) },
    {
      kind: 'number',
      key: 'dispA',
      label: 'Section A displacement (cm³/rev)',
      min: 0.1,
      max: 1000,
      step: 0.5,
    },
    {
      kind: 'number',
      key: 'dispB',
      label: 'Section B displacement (cm³/rev)',
      min: 0.1,
      max: 1000,
      step: 0.5,
    },
    {
      kind: 'number',
      key: 'leakAt100',
      label: 'Internal leakage per section (L/min at 100 bar)',
      min: 0,
      max: 100,
      step: 0.05,
    },
    {
      kind: 'number',
      key: 'friction',
      label: 'Breakaway friction (Nm)',
      min: 0,
      max: 1000,
      step: 0.1,
    },
  ],
  [HYD_CYLINDER_DOUBLE_TYPE]: [
    { kind: 'relabel', label: 'Cylinder letter' },
    { kind: 'number', key: 'bore', label: 'Piston diameter (mm)', min: 5, max: 1000, step: 1 },
    { kind: 'number', key: 'rodD', label: 'Rod diameter (mm)', min: 1, max: 999, step: 1 },
    { kind: 'number', key: 'stroke', label: 'Stroke (mm)', min: 1, max: 10000, step: 10 },
    { kind: 'number', key: 'load', label: 'Load force (N, + opposes extension)', step: 100 },
    { kind: 'number', key: 'friction', label: 'Seal friction (N)', min: 0, step: 10 },
    {
      kind: 'number',
      key: 'mass',
      label: 'Moving mass (kg) - 0 = inertia ignored',
      min: 0,
      step: 10,
    },
    { kind: 'sensorList', arrayKey: 'sensors', min: 0, max: 100, step: 1 },
  ],
  [HYD_CYLINDER_SINGLE_TYPE]: [
    { kind: 'relabel', label: 'Cylinder letter' },
    { kind: 'number', key: 'bore', label: 'Piston diameter (mm)', min: 5, max: 1000, step: 1 },
    { kind: 'number', key: 'stroke', label: 'Stroke (mm)', min: 1, max: 10000, step: 10 },
    { kind: 'number', key: 'load', label: 'Load force (N, + opposes extension)', step: 100 },
    { kind: 'number', key: 'springPreload', label: 'Spring preload (N)', min: 0, step: 10 },
    { kind: 'number', key: 'springRate', label: 'Spring rate (N/mm)', min: 0, step: 0.5 },
    { kind: 'number', key: 'friction', label: 'Seal friction (N)', min: 0, step: 10 },
    {
      kind: 'number',
      key: 'mass',
      label: 'Moving mass (kg) - 0 = inertia ignored',
      min: 0,
      step: 10,
    },
    { kind: 'sensorList', arrayKey: 'sensors', min: 0, max: 100, step: 1 },
  ],
  [HYD_MOTOR_TYPE]: [
    { kind: 'actuatorMode', label: 'Motor type', options: swapFamilyOf(HYD_MOTOR_TYPE) },
    {
      kind: 'number',
      key: 'displacement',
      label: 'Displacement (cm³/rev)',
      min: 0.1,
      max: 10000,
      step: 1,
    },
    { kind: 'number', key: 'torque', label: 'Load torque (Nm)', min: 0, step: 1 },
    {
      kind: 'number',
      key: 'etaHm',
      label: 'Hydromechanical efficiency (%)',
      min: 50,
      max: 100,
      step: 1,
    },
  ],
  [HYD_MOTOR_VAR_TYPE]: [
    { kind: 'actuatorMode', label: 'Motor type', options: swapFamilyOf(HYD_MOTOR_VAR_TYPE) },
    {
      kind: 'number',
      key: 'displacement',
      label: 'Max displacement (cm³/rev)',
      min: 0.1,
      max: 10000,
      step: 1,
    },
    {
      kind: 'number',
      key: 'minPct',
      label: 'Min displacement (% of max)',
      min: 5,
      max: 100,
      step: 5,
    },
    {
      kind: 'number',
      key: 'setting',
      label: 'Starting displacement (%)',
      min: 5,
      max: 100,
      step: 5,
    },
    { kind: 'number', key: 'torque', label: 'Load torque (Nm)', min: 0, step: 1 },
    {
      kind: 'number',
      key: 'etaHm',
      label: 'Hydromechanical efficiency (%)',
      min: 50,
      max: 100,
      step: 1,
    },
  ],
  [TEXT_ANNOTATION_TYPE]: [
    {
      kind: 'select',
      key: 'style',
      label: 'Style',
      options: Object.entries(NOTE_STYLES).map(([value, def]) => ({ value, label: def.label })),
    },
    { kind: 'multilineText', key: 'text', label: 'Text' },
  ],
  [ELEC_CONTACT_TYPE]: [
    { kind: 'actuatorMode', label: 'Type', options: ELEC_CONTACT_MODES },
    {
      kind: 'text',
      key: 'key',
      label: 'Signal (relay coil, sensor or pressure switch, e.g. K1, A1, S1)',
    },
    { kind: 'checkbox', key: 'normallyClosed', label: 'Normally closed (NC)' },
  ],
  [ELEC_PUSH_BUTTON_TYPE]: [
    { kind: 'actuatorMode', label: 'Type', options: ELEC_CONTACT_MODES },
    { kind: 'checkbox', key: 'normallyClosed', label: 'Normally closed (NC)' },
    { kind: 'checkbox', key: 'detent', label: 'Detent (latching)' },
  ],
  [ELEC_CHANGEOVER_TYPE]: [
    {
      kind: 'text',
      key: 'key',
      label: 'Signal (relay coil, sensor or pressure switch, e.g. K1, A1, S1)',
    },
  ],
  [PLC_TYPE]: [
    {
      kind: 'readonlyText',
      key: 'program',
      label: 'Program (double-click the PLC to edit)',
    },
  ],
  [ELEC_COIL_TYPE]: [
    { kind: 'actuatorMode', label: 'Type', options: ELEC_COIL_MODES },
    { kind: 'text', key: 'key', label: 'Name (e.g. K1)' },
  ],
  [ELEC_SOLENOID_TYPE]: [
    { kind: 'actuatorMode', label: 'Type', options: ELEC_COIL_MODES },
    { kind: 'text', key: 'key', label: 'Name - same as the valve solenoid it drives (e.g. Y1)' },
  ],
};

function resolveLabel(label: FieldLabel, comp: Component): string {
  return typeof label === 'function' ? label(comp) : label;
}

/** Uses each component's own snapshot()/restore() as an implicit get/set for one field,
 * so the inspector doesn't need a bespoke setter API per component type. markDirty() is what
 * makes the edit undo-able and autosaved (same as any other project change) - it also fires
 * appState's onChange, which is what lets a limit switch notice when some *other* one's sensor
 * key changed and recheck whether it now shares a label with it. */
function updateComponentField(comp: Component, key: string, value: unknown): void {
  comp.restore({ ...comp.snapshot(), [key]: value });
  redrawAllConnections();
  appState.markDirty();
}

function renderSelectField(
  container: HTMLElement,
  comp: Component,
  field: SelectField,
  snap: Record<string, unknown>,
): void {
  const row = document.createElement('label');
  row.className = 'inspectorRow';
  const span = document.createElement('span');
  span.textContent = resolveLabel(field.label, comp);
  const select = document.createElement('select');
  for (const opt of field.options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    select.appendChild(o);
  }
  select.value = String(snap[field.key] ?? field.options[0]?.value ?? '');
  select.addEventListener('change', () => updateComponentField(comp, field.key, select.value));
  row.append(span, select);
  container.appendChild(row);
}

function renderMultilineTextField(
  container: HTMLElement,
  comp: Component,
  field: MultilineTextField,
  snap: Record<string, unknown>,
): void {
  const row = document.createElement('label');
  row.className = 'inspectorRow inspectorRowStacked';
  const span = document.createElement('span');
  span.textContent = resolveLabel(field.label, comp);
  const area = document.createElement('textarea');
  area.rows = 4;
  area.value = String(snap[field.key] ?? '');
  area.addEventListener('change', () => updateComponentField(comp, field.key, area.value));
  row.append(span, area);
  container.appendChild(row);
}

function renderNumberOrTextField(
  container: HTMLElement,
  comp: Component,
  field: NumberField | TextField,
  snap: Record<string, unknown>,
): void {
  const row = document.createElement('label');
  row.className = 'inspectorRow';

  const span = document.createElement('span');
  span.textContent = resolveLabel(field.label, comp);

  const input = document.createElement('input');
  input.type = field.kind === 'number' ? 'number' : 'text';
  if (field.kind === 'number') {
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    if (field.step !== undefined) input.step = String(field.step);
  }
  input.value = String(snap[field.key] ?? '');

  input.addEventListener('change', () => {
    const value = field.kind === 'number' ? Number(input.value) : input.value;
    updateComponentField(comp, field.key, value);
  });

  row.append(span, input);
  container.appendChild(row);
}

function renderReadonlyTextField(
  container: HTMLElement,
  comp: Component,
  field: ReadonlyTextField,
  snap: Record<string, unknown>,
): void {
  const row = document.createElement('label');
  row.className = 'inspectorRow inspectorRowStacked';

  const span = document.createElement('span');
  span.textContent = resolveLabel(field.label, comp);

  // A <textarea>, not an <input> - a single-line input silently drops newlines on assignment
  // (its own value-sanitization, not something this code controls), which would otherwise run
  // a multi-statement program together into one unreadable line.
  const value = String(snap[field.key] ?? '');
  const input = document.createElement('textarea');
  input.className = 'inspectorReadonlyText';
  input.readOnly = true;
  input.rows = Math.max(2, Math.min(6, value.split('\n').length));
  input.value = value;

  row.append(span, input);
  container.appendChild(row);
}

function renderCheckboxField(
  container: HTMLElement,
  comp: Component,
  field: CheckboxField,
  snap: Record<string, unknown>,
): void {
  const row = document.createElement('label');
  row.className = 'inspectorRow';

  const span = document.createElement('span');
  span.textContent = resolveLabel(field.label, comp);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = Boolean(snap[field.key]);
  checkbox.addEventListener('change', () => {
    updateComponentField(comp, field.key, checkbox.checked);
  });

  row.append(span, checkbox);
  container.appendChild(row);
}

const PUMP_TYPES: Array<{ value: 'fixed' | 'pc' | 'ls'; label: string }> = [
  { value: 'fixed', label: 'Fixed displacement' },
  { value: 'pc', label: 'Pressure compensated' },
  { value: 'ls', label: 'Load sensing (LS port)' },
];

function renderPumpTypeField(container: HTMLElement, comp: Component): void {
  const row = document.createElement('label');
  row.className = 'inspectorRow';
  const span = document.createElement('span');
  span.textContent = 'Pump type';
  const select = document.createElement('select');
  for (const t of PUMP_TYPES) {
    const option = document.createElement('option');
    option.value = t.value;
    option.textContent = t.label;
    select.appendChild(option);
  }
  const isLS = comp.type === HYD_PUMP_LS_TYPE;
  select.value = isLS ? 'ls' : String((comp.snapshot() as { control?: string }).control ?? 'fixed');

  select.addEventListener('change', () => {
    const value = select.value;
    if (value === 'ls') {
      if (!isLS) swapComponentType(comp, HYD_PUMP_LS_TYPE);
    } else if (isLS) {
      swapComponentType(comp, HYD_PUMP_TYPE, { control: value });
    } else {
      updateComponentField(comp, 'control', value);
    }
  });

  row.append(span, select);
  container.appendChild(row);
}

function renderActuatorModeField(
  container: HTMLElement,
  comp: Component,
  field: ActuatorModeField,
): void {
  const row = document.createElement('label');
  row.className = 'inspectorRow';

  const span = document.createElement('span');
  span.textContent = field.label;

  const select = document.createElement('select');
  for (const mode of field.options) {
    const option = document.createElement('option');
    option.value = mode.type;
    option.textContent = mode.label;
    select.appendChild(option);
  }
  select.value = comp.type;

  select.addEventListener('change', () => {
    if (select.value !== comp.type) swapComponentType(comp, select.value);
    // swapComponentType replaces the component and re-selects the new one, which triggers
    // onSelectionChange -> refresh() on its own - nothing more to do here.
  });

  row.append(span, select);
  container.appendChild(row);
}

const CYLINDER_MODES: Array<{ value: 'push' | 'pull'; label: string }> = [
  { value: 'push', label: 'Push' },
  { value: 'pull', label: 'Pull' },
];

function renderCylinderModeField(
  container: HTMLElement,
  comp: Component,
  onChange: () => void,
): void {
  const row = document.createElement('label');
  row.className = 'inspectorRow';

  const span = document.createElement('span');
  span.textContent = 'Mode';

  const select = document.createElement('select');
  for (const m of CYLINDER_MODES) {
    const option = document.createElement('option');
    option.value = m.value;
    option.textContent = m.label;
    select.appendChild(option);
  }
  select.value = (comp.snapshot() as Record<string, unknown>).mode as string;

  select.addEventListener('change', () => {
    comp.setCylinderMode?.(select.value as 'push' | 'pull');
    onChange();
  });

  row.append(span, select);
  container.appendChild(row);
}

const SILENCER_OPTIONS: Array<{ value: 'none' | 'silencer'; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'silencer', label: 'Silencer' },
];

function isPortWired(compId: number, port: string): boolean {
  return appState.connections.some(
    (c) =>
      (c.from.id === compId && c.from.port === port) || (c.to.id === compId && c.to.port === port),
  );
}

function renderSilencerField(
  container: HTMLElement,
  comp: Component,
  field: SilencerField,
  snap: Record<string, unknown>,
): void {
  const row = document.createElement('label');
  row.className = 'inspectorRow';

  const span = document.createElement('span');
  span.textContent = resolveLabel(field.label, comp);

  const select = document.createElement('select');
  for (const opt of SILENCER_OPTIONS) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  }
  const current = (snap[field.key] as string) ?? 'none';
  select.value = current;

  select.addEventListener('change', () => {
    // A wired port is already physically occupied - a silencer can't also go there. Attaching a
    // wire to an already-silenced port is separately blocked at the port itself (see
    // shared/silencer.ts's setSilencerState, which disables the port while a silencer is on).
    if (select.value === 'silencer' && isPortWired(comp.id, field.port)) {
      flashRejected(select, current);
      return;
    }
    updateComponentField(comp, field.key, select.value);
  });

  row.append(span, select);
  container.appendChild(row);
}

function renderSensorKeySelectField(
  container: HTMLElement,
  comp: Component,
  field: SensorKeySelectField,
  snap: Record<string, unknown>,
  onChange: () => void,
): void {
  const row = document.createElement('label');
  row.className = 'inspectorRow';

  const span = document.createElement('span');
  span.textContent = resolveLabel(field.label, comp);

  const select = document.createElement('select');
  const current = String(snap[field.key] ?? '');
  const options = listAllSensorLabels();

  // Always available, including alongside a real binding - unbinding one switch is how a label
  // gets freed up to swap with another's without having to move either off to the side first:
  // clear one switch's label, give its now-free label to the other, then give the first switch
  // what the other just gave up.
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '(none)';
  select.appendChild(noneOpt);

  // The current binding stays selectable even if it doesn't match any sensor that exists right
  // now (its cylinder was deleted, or this was typed in before the field became a dropdown) -
  // switching it away is a deliberate choice, not something losing the value should force.
  const currentExists = options.some((o) => o.label.toUpperCase() === current.toUpperCase());
  if (current && !currentExists) {
    const opt = document.createElement('option');
    opt.value = current;
    opt.textContent = `${current} (not found)`;
    select.appendChild(opt);
  }
  // A label already used by another limit switch stays selectable - two switches can
  // legitimately react to the same sensor (a real circuit might fan one signal out to several
  // valves) - just marked, so picking one is an informed choice rather than a surprise.
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.label;
    const takenElsewhere =
      o.label.toUpperCase() !== current.toUpperCase() &&
      isSensorKeyBoundElsewhere(o.label, comp.id);
    opt.textContent = takenElsewhere
      ? `${o.label} — ${o.cylinderName} (also used)`
      : `${o.label} — ${o.cylinderName}`;
    select.appendChild(opt);
  }
  select.value = current;

  select.addEventListener('change', () => {
    updateComponentField(comp, field.key, select.value);
    // Whether this switch (now) duplicates another, and whether any *other* option should read
    // "(also used)", both depend on the value just picked - re-render so the warning and the
    // rest of the list reflect it immediately instead of only on the next selection change.
    onChange();
  });

  row.append(span, select);
  container.appendChild(row);

  // The symbol's own sensor-key text also turns red for this (see limitValve32.ts) - this is
  // the same check surfaced in the inspector, in case the symbol isn't currently in view.
  if (current && isSensorKeyBoundElsewhere(current, comp.id)) {
    const warning = document.createElement('p');
    warning.className = 'inspectorWarning';
    warning.textContent = `Another limit switch is also bound to "${current}".`;
    container.appendChild(warning);
  }
}

/** Briefly flags `input` as rejected (a duplicate label, or some other invalid value) without a
 * popup - just a red outline that clears itself, plus reverting the value the user tried to
 * commit. */
function flashRejected(input: HTMLInputElement | HTMLSelectElement, revertTo: string): void {
  input.value = revertTo;
  input.classList.add('inspectorFieldError');
  window.setTimeout(() => input.classList.remove('inspectorFieldError'), 1000);
}

function renderRelabelField(
  container: HTMLElement,
  comp: Component,
  field: RelabelField,
  onChange: () => void,
): void {
  const row = document.createElement('label');
  row.className = 'inspectorRow';

  const span = document.createElement('span');
  span.textContent = resolveLabel(field.label, comp);

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 1;
  const current = String(comp.snapshot().letter ?? '');
  input.value = current;

  input.addEventListener('change', () => {
    if (!comp.renameLabel?.(input.value)) {
      flashRejected(input, current);
      return;
    }
    // A rename cascades into the sensor list's labels (and possibly other components' sensor
    // key bindings) - re-render so this panel's own sensor rows pick up their new names right
    // away instead of only on the next selection change.
    onChange();
  });

  row.append(span, input);
  container.appendChild(row);
}

/** Renders the sensor list as its own section (explanation, one row per sensor with a live
 * slider, an Add button) and re-renders `onChange` after every add/remove, since the row count
 * itself can change. */
function renderSensorListField(
  container: HTMLElement,
  comp: Component,
  field: SensorListField,
  snap: Record<string, unknown>,
  onChange: () => void,
): void {
  const sensors = (snap[field.arrayKey] as CylinderSensor[] | undefined) ?? [];
  const lo = field.min ?? 0;
  const hi = field.max ?? 100;

  const heading = document.createElement('div');
  heading.className = 'inspectorSectionHeading';
  heading.textContent = 'Sensors';
  container.appendChild(heading);

  const hint = document.createElement('p');
  hint.className = 'inspectorHint';
  hint.textContent =
    'Each sensor turns on while the piston is within its range of the stroke (0% = fully ' +
    'retracted, 100% = fully extended). Give an electrical contact (or a PLC) the same label ' +
    'as its Signal to read it - labels are case-insensitive, so "a0" and "A0" are the same sensor.';
  container.appendChild(hint);

  function writeSensors(next: CylinderSensor[]): void {
    updateComponentField(comp, field.arrayKey, next);
    onChange();
  }

  sensors.forEach((sensor, index) => {
    const row = document.createElement('div');
    row.className = 'inspectorSensorRow';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'inspectorSensorLabel';
    labelInput.value = sensor.label;
    labelInput.addEventListener('change', () => {
      const next = labelInput.value.trim();
      if (!next) {
        labelInput.value = sensor.label;
        return;
      }
      if (isSensorLabelInUse(next, { compId: comp.id, index })) {
        flashRejected(labelInput, sensor.label);
        return;
      }
      const updated = sensors.slice();
      updated[index] = { ...sensor, label: next };
      writeSensors(updated);
    });

    const fromInput = document.createElement('input');
    fromInput.type = 'number';
    const toInput = document.createElement('input');
    toInput.type = 'number';
    for (const el of [fromInput, toInput]) {
      el.min = String(lo);
      el.max = String(hi);
      if (field.step !== undefined) el.step = String(field.step);
    }
    fromInput.value = String(sensor.minPct);
    toInput.value = String(sensor.maxPct);

    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'sensorSlider';
    const track = document.createElement('div');
    track.className = 'sensorSliderTrack';
    const fill = document.createElement('div');
    fill.className = 'sensorSliderRange';
    const minSlider = document.createElement('input');
    minSlider.type = 'range';
    minSlider.className = 'sensorSliderInput';
    const maxSlider = document.createElement('input');
    maxSlider.type = 'range';
    maxSlider.className = 'sensorSliderInput';
    for (const el of [minSlider, maxSlider]) {
      el.min = String(lo);
      el.max = String(hi);
      el.step = String(field.step ?? 1);
    }
    minSlider.value = String(sensor.minPct);
    maxSlider.value = String(sensor.maxPct);
    sliderWrap.append(track, fill, minSlider, maxSlider);

    function positionFill(minPct: number, maxPct: number): void {
      const span = hi - lo || 1;
      fill.style.left = `${((minPct - lo) / span) * 100}%`;
      fill.style.width = `${((maxPct - minPct) / span) * 100}%`;
    }
    positionFill(sensor.minPct, sensor.maxPct);

    function commitRange(minPct: number, maxPct: number): void {
      fromInput.value = String(minPct);
      toInput.value = String(maxPct);
      minSlider.value = String(minPct);
      maxSlider.value = String(maxPct);
      positionFill(minPct, maxPct);
      const updated = sensors.slice();
      updated[index] = { ...sensor, minPct, maxPct };
      writeSensors(updated);
    }

    fromInput.addEventListener('change', () => {
      const clamped = Math.min(Math.max(Number(fromInput.value), lo), hi);
      commitRange(clamped, Math.max(clamped, Number(toInput.value)));
    });
    toInput.addEventListener('change', () => {
      const clamped = Math.min(Math.max(Number(toInput.value), lo), hi);
      commitRange(Math.min(clamped, Number(fromInput.value)), clamped);
    });
    minSlider.addEventListener('input', () => {
      const v = Math.min(Number(minSlider.value), Number(maxSlider.value));
      minSlider.value = String(v);
      positionFill(v, Number(maxSlider.value));
    });
    minSlider.addEventListener('change', () => {
      commitRange(
        Number(minSlider.value),
        Math.max(Number(minSlider.value), Number(maxSlider.value)),
      );
    });
    maxSlider.addEventListener('input', () => {
      const v = Math.max(Number(maxSlider.value), Number(minSlider.value));
      maxSlider.value = String(v);
      positionFill(Number(minSlider.value), v);
    });
    maxSlider.addEventListener('change', () => {
      commitRange(
        Math.min(Number(minSlider.value), Number(maxSlider.value)),
        Number(maxSlider.value),
      );
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'inspectorRemoveBtn';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove sensor';
    removeBtn.addEventListener('click', () => {
      writeSensors(sensors.filter((_, i) => i !== index));
    });

    const numbersRow = document.createElement('div');
    numbersRow.className = 'inspectorSensorNumbers';
    const sep = document.createElement('span');
    sep.className = 'inspectorRangeSep';
    sep.textContent = '–';
    numbersRow.append(labelInput, fromInput, sep, toInput, removeBtn);

    row.append(numbersRow, sliderWrap);
    container.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn inspectorAddBtn';
  addBtn.textContent = '+ Add sensor';
  addBtn.addEventListener('click', () => {
    const letter = String(comp.snapshot().letter ?? '');
    const label = nextSensorLabel(letter);
    writeSensors([...sensors, { label, minPct: 45, maxPct: 55 }]);
  });
  container.appendChild(addBtn);
}

/** Types with no meaningful identifying name to show/hide/override - a wire junction only ever
 * exists as a side effect of splitting a wire, and a text annotation's own text already serves
 * that purpose, so neither gets the generic name section below. */
const NO_NAME_SECTION = new Set([JUNCTION_TYPE, TEXT_ANNOTATION_TYPE]);

/** Every component gets this, regardless of type: names are hidden by default (see
 * svgHelpers.ts) since a diagram with every symbol labeled gets noisy fast, but showing one
 * (and optionally overriding it with a custom name, e.g. "Clamp cylinder" instead of
 * "Cylinder A") is one checkbox + one text field away. */
function renderNameSection(
  container: HTMLElement,
  comp: Component,
  snap: Record<string, unknown>,
): void {
  const heading = document.createElement('div');
  heading.className = 'inspectorSectionHeading';
  heading.textContent = 'Name';
  container.appendChild(heading);

  const showRow = document.createElement('label');
  showRow.className = 'inspectorRow';
  const showSpan = document.createElement('span');
  showSpan.textContent = 'Show name in diagram';
  const showCheckbox = document.createElement('input');
  showCheckbox.type = 'checkbox';
  showCheckbox.checked = Boolean(snap.showName);
  showCheckbox.addEventListener('change', () => {
    updateComponentField(comp, 'showName', showCheckbox.checked);
  });
  showRow.append(showSpan, showCheckbox);
  container.appendChild(showRow);

  const nameRow = document.createElement('label');
  nameRow.className = 'inspectorRow';
  const nameSpan = document.createElement('span');
  nameSpan.textContent = 'Custom name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'inspectorCustomNameInput';
  nameInput.placeholder = '(default)';
  nameInput.value = (snap.customName as string | null) ?? '';
  nameInput.addEventListener('change', () => {
    updateComponentField(comp, 'customName', nameInput.value.trim() || null);
  });
  nameRow.append(nameSpan, nameInput);
  container.appendChild(nameRow);
}

const PAGE_FRAME_OPTIONS: Array<{ value: PageFrameSize; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'a4', label: 'A4' },
  { value: 'a3', label: 'A3' },
];

/** Title-block metadata - project name, author, checked by, company - plus the page-frame size
 * picker, shown only while nothing is selected, same as Grid below. Project name mirrors the
 * sidebar's own name field (writes through `projectBar.setName` so both stay in sync); the rest
 * live only on `appState` and round-trip through the project file (see persistence/project.ts)
 * alongside it. Every field here also appears in the page frame's own title block (see
 * ui/pageFrame.ts), which is why each commit re-renders that too, not just this panel. */
function renderProjectInfoSection(container: HTMLElement, projectBar: ProjectBarRefs): void {
  const heading = document.createElement('div');
  heading.className = 'inspectorSectionHeading';
  heading.textContent = 'Project info';
  container.appendChild(heading);

  function fieldRow(
    label: string,
    type: 'text' | 'date',
    value: string,
    onCommit: (v: string) => void,
  ): void {
    const row = document.createElement('label');
    row.className = 'inspectorRow';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = type;
    input.className = 'inspectorCustomNameInput';
    input.value = value;
    input.addEventListener('change', () => {
      onCommit(input.value);
      renderPageFrame();
    });
    row.append(span, input);
    container.appendChild(row);
  }

  fieldRow('Project name', 'text', projectBar.getName(), (v) => projectBar.setName(v));
  fieldRow('Date', 'date', appState.projectDate, (v) => {
    appState.projectDate = v;
  });
  fieldRow('Author', 'text', appState.projectAuthor, (v) => {
    appState.projectAuthor = v;
  });
  fieldRow('Checked by', 'text', appState.projectCheckedBy, (v) => {
    appState.projectCheckedBy = v;
  });
  fieldRow('Company', 'text', appState.projectCompany, (v) => {
    appState.projectCompany = v;
  });

  const frameRow = document.createElement('label');
  frameRow.className = 'inspectorRow';
  const frameSpan = document.createElement('span');
  frameSpan.textContent = 'Page frame';
  const frameSelect = document.createElement('select');
  for (const opt of PAGE_FRAME_OPTIONS) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    frameSelect.appendChild(option);
  }
  frameSelect.value = appState.pageFrameSize;
  frameSelect.addEventListener('change', () => {
    setPageFrameSize(frameSelect.value as PageFrameSize);
  });
  frameRow.append(frameSpan, frameSelect);
  container.appendChild(frameRow);

  const frameHint = document.createElement('p');
  frameHint.className = 'inspectorHint';
  frameHint.textContent =
    'Draws a sheet outline with the fields above as a title block - a visual guide only, ' +
    'centered on the current diagram when picked.';
  container.appendChild(frameHint);
}

/** Pinned to the bottom of the panel, below whatever else is showing. It's help rather than a
 * setting, so it renders unconditionally - the one thing here that's always available no matter
 * what (or how much) is selected. */
function renderTipsSection(container: HTMLElement): void {
  const section = document.createElement('div');
  section.className = 'inspectorTips';

  const heading = document.createElement('div');
  heading.className = 'inspectorSectionHeading';
  heading.textContent = 'Help';
  section.appendChild(heading);

  const btn = document.createElement('button');
  btn.className = 'btn inspectorTipsBtn';
  btn.type = 'button';
  btn.append(createIcon('tips'), document.createTextNode('Tips & shortcuts'));
  btn.addEventListener('click', () => openTipsDialog());
  section.appendChild(btn);

  const termsBtn = document.createElement('button');
  termsBtn.className = 'btn inspectorTipsBtn';
  termsBtn.type = 'button';
  termsBtn.append(createIcon('document'), document.createTextNode('Terms of use'));
  termsBtn.addEventListener('click', () => openTermsDialog());
  section.appendChild(termsBtn);

  container.appendChild(section);
}

const ALIGN_BUTTONS: Array<{ icon: IconName; label: string; mode: AlignMode }> = [
  { icon: 'alignLeft', label: 'Align left edges', mode: 'left' },
  { icon: 'alignCenter', label: 'Align centers in a column', mode: 'center' },
  { icon: 'alignRight', label: 'Align right edges', mode: 'right' },
  { icon: 'alignTop', label: 'Align top edges', mode: 'top' },
  { icon: 'alignMiddle', label: 'Align centers in a row', mode: 'middle' },
  { icon: 'alignBottom', label: 'Align bottom edges', mode: 'bottom' },
];

const DISTRIBUTE_BUTTONS: Array<{ icon: IconName; label: string; axis: DistributeAxis }> = [
  { icon: 'distributeH', label: 'Space evenly left to right', axis: 'horizontal' },
  { icon: 'distributeV', label: 'Space evenly top to bottom', axis: 'vertical' },
];

/** Shown while several components are selected: line them up, or space them evenly (that one
 * needs three, so there's something between the outer two to move). Disabled while the
 * simulation runs, like every other edit. */
function renderAlignSection(container: HTMLElement, selected: Component[]): void {
  const heading = document.createElement('div');
  heading.className = 'inspectorSectionHeading';
  heading.textContent = 'Align';
  container.appendChild(heading);

  const editable = canEdit(appState.mode);
  const row = document.createElement('div');
  row.className = 'inspectorAlignRow';
  for (const { icon, label, mode } of ALIGN_BUTTONS) {
    const btn = iconButton(icon, label, () => alignComponents(getSelectedComponents(), mode));
    btn.disabled = !editable;
    row.appendChild(btn);
  }
  for (const { icon, label, axis } of DISTRIBUTE_BUTTONS) {
    const btn = iconButton(icon, label, () => distributeComponents(getSelectedComponents(), axis));
    btn.disabled = !editable || selected.length < 3;
    if (selected.length < 3) btn.title = `${label} (select three or more)`;
    row.appendChild(btn);
  }
  container.appendChild(row);
}

export function renderInspector(container: HTMLElement, projectBar: ProjectBarRefs): void {
  // Split from refresh() so the tips section below can always be appended last, whichever of
  // this function's several early exits the body took.
  function renderBody(): void {
    const selected = getSelectedComponents();
    if (selected.length !== 1) {
      // Project info and the grid are workspace-wide settings, not component ones - but they
      // only get their own section here while nothing is selected, so they don't compete for
      // space with (or look like part of) whatever's actually being edited.
      if (selected.length === 0) {
        renderProjectInfoSection(container, projectBar);
      } else {
        renderAlignSection(container, selected);
      }

      const hint = document.createElement('p');
      hint.className = 'inspectorHint';
      hint.textContent =
        selected.length === 0
          ? 'Select a component to edit its properties.'
          : 'Select a single component to edit its properties.';
      container.appendChild(hint);
      return;
    }
    const comp = selected[0] as Component;
    const snap = comp.snapshot() as Record<string, unknown>;

    const showsNameSection = !NO_NAME_SECTION.has(comp.type);
    if (showsNameSection) renderNameSection(container, comp, snap);

    const fields = INSPECTOR_FIELDS[comp.type];
    if (!fields || fields.length === 0) {
      if (!showsNameSection) {
        const hint = document.createElement('p');
        hint.className = 'inspectorHint';
        hint.textContent = 'This component has nothing to configure here.';
        container.appendChild(hint);
      }
      return;
    }

    for (const field of fields) {
      if (field.kind === 'sensorList') renderSensorListField(container, comp, field, snap, refresh);
      else if (field.kind === 'actuatorMode') renderActuatorModeField(container, comp, field);
      else if (field.kind === 'pumpType') renderPumpTypeField(container, comp);
      else if (field.kind === 'sensorKeySelect')
        renderSensorKeySelectField(container, comp, field, snap, refresh);
      else if (field.kind === 'relabel') renderRelabelField(container, comp, field, refresh);
      else if (field.kind === 'cylinderMode') renderCylinderModeField(container, comp, refresh);
      else if (field.kind === 'silencer') renderSilencerField(container, comp, field, snap);
      else if (field.kind === 'checkbox') renderCheckboxField(container, comp, field, snap);
      else if (field.kind === 'readonlyText') renderReadonlyTextField(container, comp, field, snap);
      else if (field.kind === 'select') renderSelectField(container, comp, field, snap);
      else if (field.kind === 'multilineText')
        renderMultilineTextField(container, comp, field, snap);
      else renderNumberOrTextField(container, comp, field, snap);
    }
  }

  function refresh(): void {
    container.replaceChildren();
    renderBody();
    renderTipsSection(container);
  }

  onSelectionChange(refresh);
  // The Align buttons are only usable while editing.
  appState.onModeChange(refresh);
  // Also catches edits that don't go through this panel's own fields, e.g. saving a PLC's
  // program from its graphical editor dialog - that only calls appState.markDirty(), so its
  // read-only program preview here needs the general change notification to pick it up.
  appState.onChange(refresh);
  refresh();
}
