/**
 * One pressure colour scale for the whole diagram, so a valve's internal flow path and the wire
 * it feeds read as the same shade: pale red at low pressure to deep red at the highest pressure
 * anywhere in the circuit this frame (set by sim/engine.ts after every solve).
 */
let pMax = 1;

export function setPressureScale(max: number): void {
  pMax = Math.max(max, 1);
}

export function pressureColor(p: number): string {
  const t = Math.max(0, Math.min(1, p / pMax));
  const light = 72 - 42 * t;
  return `hsl(0 85% ${light.toFixed(0)}%)`;
}

/** Below this (bar) a line counts as unpressurised - a return or idle line. */
export const PRESSURE_THRESHOLD = 1;
/** Flow (L/min) below which a line counts as standing still. */
export const FLOW_THRESHOLD = 0.005;

/** Marching-dash period for a flow: faster for more flow, within a readable range. */
export function flowDuration(q: number): string {
  const dur = Math.max(0.15, Math.min(2.5, 3 / Math.sqrt(Math.abs(q) + 0.1)));
  return `${dur.toFixed(2)}s`;
}
