import { appState } from '../../app/AppState';
import type { ComponentId } from '../../core/types';

/** One named proximity sensor along a cylinder's stroke. Reads as triggered for its whole dwell
 * across [minPct, maxPct] (0 = fully retracted, 100 = fully extended), not just at a single
 * point - closer to a real proximity/reed switch mounted across a physical span of the barrel
 * than an idealized point sensor, and lets a sensor be widened deliberately (e.g. "anywhere in
 * the first 5%") instead of only ever sitting exactly at one position. `label` is the signal key
 * a limit valve binds to (matched case-insensitively - see sim/signals.ts). */
export interface CylinderSensor {
  label: string;
  minPct: number;
  maxPct: number;
}

export function isInSensorRange(pos: number, sensor: CylinderSensor): boolean {
  const pct = pos * 100;
  return pct >= sensor.minPct && pct <= sensor.maxPct;
}

/** A freshly placed cylinder's starting sensors - matches the original fixed end-of-stroke
 * tolerance, so nothing changes for a cylinder nobody has customized. */
export function defaultSensors(letter: string): CylinderSensor[] {
  return [
    { label: `${letter}0`, minPct: 0, maxPct: 2 },
    { label: `${letter}1`, minPct: 98, maxPct: 100 },
  ];
}

/**
 * True if `label` (matched case-insensitively, like the signal bus itself) is already used by
 * some *other* sensor anywhere in the project - two sensors sharing a label would both drive the
 * same signal, silently overwriting each other every frame. Pass `exclude` (the sensor's own
 * component + index) when checking an edit to an existing sensor so it doesn't flag itself.
 */
export function isSensorLabelInUse(
  label: string,
  exclude: { compId: ComponentId; index: number } | null = null,
): boolean {
  const target = label.trim().toUpperCase();
  if (!target) return false;
  for (const comp of appState.components) {
    const sensors = (comp.snapshot() as Record<string, unknown>).sensors;
    if (!isValidSensorArray(sensors)) continue;
    for (let i = 0; i < sensors.length; i++) {
      if (exclude && comp.id === exclude.compId && i === exclude.index) continue;
      if (sensors[i]!.label.trim().toUpperCase() === target) return true;
    }
  }
  return false;
}

/** A sensible label for a newly added sensor - the next "<letter><n>" not already used by any
 * sensor in the project. */
export function nextSensorLabel(letter: string): string {
  for (let n = 0; n < 1000; n++) {
    const candidate = `${letter}${n}`;
    if (!isSensorLabelInUse(candidate)) return candidate;
  }
  return `${letter}${Date.now()}`;
}

export interface SensorRename {
  oldLabel: string;
  newLabel: string;
}

/** Carries each sensor's label forward when a cylinder is relabeled (whether by pasting a copy
 * or renaming it directly) - only for labels still exactly of the form "<oldLetter><n>", since
 * those are the ones this component generated itself; anything the user typed by hand is left
 * alone (and, if it now collides with something else, that's caught by isSensorLabelInUse same
 * as any manual edit). Also returns the individual old-to-new renames that happened, so the
 * caller can carry them into anything bound to the old label (see renameSensorKeyBindings). */
export function relabelSensors(
  sensors: CylinderSensor[],
  oldLetter: string,
  newLetter: string,
): { sensors: CylinderSensor[]; renames: SensorRename[] } {
  const pattern = new RegExp(`^${oldLetter}(\\d+)$`, 'i');
  const renames: SensorRename[] = [];
  const renamed = sensors.map((s) => {
    const match = pattern.exec(s.label);
    if (!match) return s;
    const newLabel = `${newLetter}${match[1]}`;
    renames.push({ oldLabel: s.label, newLabel });
    return { ...s, label: newLabel };
  });
  return { sensors: renamed, renames };
}

/** Updates every component bound (via a `sensorKey` field, matched case-insensitively) to
 * `oldLabel` so it points at `newLabel` instead - keeps e.g. a limit switch working across a
 * cylinder rename instead of it silently going dead because the sensor it read no longer exists
 * under that name. Type-agnostic for the same reason isSensorKeyBoundElsewhere is. */
export function renameSensorKeyBindings(oldLabel: string, newLabel: string): void {
  const target = oldLabel.trim().toUpperCase();
  if (!target) return;
  for (const comp of appState.components) {
    const snap = comp.snapshot() as Record<string, unknown>;
    if (typeof snap.sensorKey !== 'string') continue;
    if (snap.sensorKey.trim().toUpperCase() !== target) continue;
    comp.restore({ ...snap, sensorKey: newLabel });
  }
}

export interface SensorLabelOption {
  label: string;
  cylinderName: string;
}

/** Every sensor label currently defined by any cylinder in the project, each tagged with the
 * cylinder it belongs to - feeds the limit switch's "Sensor key" dropdown, so binding one is a
 * choice among what actually exists rather than free text that can silently typo-mismatch. */
export function listAllSensorLabels(): SensorLabelOption[] {
  const options: SensorLabelOption[] = [];
  for (const comp of appState.components) {
    const snap = comp.snapshot() as Record<string, unknown>;
    if (!isValidSensorArray(snap.sensors)) continue;
    const cylinderName = `Cylinder ${typeof snap.letter === 'string' ? snap.letter : '?'}`;
    for (const sensor of snap.sensors) options.push({ label: sensor.label, cylinderName });
  }
  return options;
}

/**
 * True if `key` (matched case-insensitively, like the signal bus itself) is already the
 * `sensorKey` some *other* component in the project is bound to - two limit switches sharing a
 * sensor would both react to it as if they were one combined switch, which is rarely what's
 * intended. Type-agnostic by design: it just looks for a `sensorKey` string in each component's
 * snapshot rather than importing the limit-switch component type, which would create an import
 * cycle (that component imports this file for the sensor-label dropdown it renders through).
 * Pass `excludeCompId` when checking an existing binding so it doesn't flag itself.
 */
export function isSensorKeyBoundElsewhere(key: string, excludeCompId?: ComponentId): boolean {
  const target = key.trim().toUpperCase();
  if (!target) return false;
  for (const comp of appState.components) {
    if (excludeCompId !== undefined && comp.id === excludeCompId) continue;
    const snap = comp.snapshot() as Record<string, unknown>;
    if (typeof snap.sensorKey !== 'string') continue;
    if (snap.sensorKey.trim().toUpperCase() === target) return true;
  }
  return false;
}

export function isValidSensorArray(data: unknown): data is CylinderSensor[] {
  return (
    Array.isArray(data) &&
    data.every(
      (s) =>
        s &&
        typeof s.label === 'string' &&
        typeof s.minPct === 'number' &&
        typeof s.maxPct === 'number',
    )
  );
}
