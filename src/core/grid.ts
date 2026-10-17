export const GRID_SIZE = 10;

export let GRID_ENABLED = true;

export function setGridEnabled(enabled: boolean): void {
  GRID_ENABLED = enabled;
}

export function snap(value: number): number {
  if (!GRID_ENABLED) return value;
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}
