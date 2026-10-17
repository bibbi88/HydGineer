/** Sensor bus: cylinders emit end-of-stroke signals (e.g. "a0"/"a1"), limit valves read them.
 * Keys are normalized to a single case so "A1" and "a1" are treated as the same sensor
 * regardless of which case either side happened to type/emit it in. */
const signals = new Map<string, boolean>();

function normalize(key: string): string {
  return key.trim().toUpperCase();
}

export function setSignal(key: string, value: boolean): void {
  signals.set(normalize(key), value);
}

export function getSignal(key: string): boolean {
  return signals.get(normalize(key)) ?? false;
}

export function resetSignals(): void {
  signals.clear();
}
