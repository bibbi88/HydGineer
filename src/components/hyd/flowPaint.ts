import {
  FLOW_THRESHOLD,
  PRESSURE_THRESHOLD,
  flowDuration,
  pressureColor,
} from '../../sim/pressureScale';

const CLASSES = ['hydPathP', 'hydPathReturn', 'hydPathFlow', 'hydPathFlowReverse'];

/**
 * Shows the oil in a valve's own internal flow path, the same way sim/render.ts shows it in the
 * wires: red by pressure (`p`, bar), blue for a flowing unpressurised (return) path, and marching
 * dashes while it carries flow. `q` (L/min) is signed relative to the direction the path's
 * elements were drawn in, so the dashes march the way the oil actually goes. Elements marked
 * `data-nodash` (a shared cross-bar, where "direction" means nothing) only take the colour.
 */
export function paintFlow(els: SVGElement[], p: number, q: number): void {
  const pressurized = p > PRESSURE_THRESHOLD;
  const flowing = Math.abs(q) >= FLOW_THRESHOLD;
  const color = pressurized ? pressureColor(p) : null;
  for (const el of els) {
    el.classList.toggle('hydPathP', pressurized);
    el.classList.toggle('hydPathReturn', !pressurized && flowing);
    if (color) el.style.setProperty('--wp', color);
    // Arrowheads and junction dots only take the colour; lines and paths get the dashes.
    const solid = el.tagName === 'polygon' || el.tagName === 'circle';
    const dashes = flowing && !solid && el.dataset.nodash !== '1';
    el.classList.toggle('hydPathFlow', dashes);
    el.classList.toggle('hydPathFlowReverse', dashes && q < 0);
    if (dashes) el.style.setProperty('--flowDur', flowDuration(q));
  }
}

export function clearFlow(els: SVGElement[]): void {
  for (const el of els) el.classList.remove(...CLASSES);
}

/** Paints a set of keyed paths, smallest flow first, so where two paths share a drawn segment
 * the one carrying more oil wins it. */
export function paintPaths(paths: Array<{ els: SVGElement[]; p: number; q: number }>): void {
  const sorted = [...paths].sort((a, b) => Math.abs(a.q) - Math.abs(b.q));
  for (const x of sorted) paintFlow(x.els, x.p, x.q);
}
