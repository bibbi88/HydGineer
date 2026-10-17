import type { Component } from '../core/types';
import { appState } from '../app/AppState';
import { snap } from '../core/grid';
import { redrawAllConnections } from '../wires/connection';

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/**
 * Lines up `comps` along one edge or centerline of the box around them all.
 *
 * Edges go by each component's drawn bounds (getBounds - rotation-aware), so symbols of
 * different sizes end up flush. Center/middle go by the component's own position instead
 * (comp.x/comp.y, its canvas center), not its bounds center: every symbol lays its ports out on
 * the grid relative to that point, so this is what puts e.g. a column of contacts and coils
 * with their terminals exactly in line, ready for straight wires. Every result is snapped to
 * the grid, like a drag.
 */
export function alignComponents(comps: Component[], mode: AlignMode): void {
  if (comps.length < 2) return;
  const bounds = comps.map((c) => c.getBounds());
  const horizontal = mode === 'left' || mode === 'center' || mode === 'right';
  let target: number;
  if (mode === 'left') target = Math.min(...bounds.map((b) => b.x));
  else if (mode === 'right') target = Math.max(...bounds.map((b) => b.x + b.w));
  else if (mode === 'top') target = Math.min(...bounds.map((b) => b.y));
  else if (mode === 'bottom') target = Math.max(...bounds.map((b) => b.y + b.h));
  else {
    const coords = comps.map((c) => (horizontal ? c.x : c.y));
    target = snap((Math.min(...coords) + Math.max(...coords)) / 2);
  }

  comps.forEach((c, i) => {
    const b = bounds[i] as (typeof bounds)[number];
    let { x, y } = c;
    if (mode === 'left') x = snap(c.x + target - b.x);
    else if (mode === 'right') x = snap(c.x + target - (b.x + b.w));
    else if (mode === 'center') x = target;
    else if (mode === 'top') y = snap(c.y + target - b.y);
    else if (mode === 'bottom') y = snap(c.y + target - (b.y + b.h));
    else y = target;
    c.setPos(x, y);
  });
  finishMove();
}

/** Spaces `comps` evenly between the two outermost ones along `axis`, by their centers; the
 * outermost two stay put. Needs at least three to have anything in between to move. */
export function distributeComponents(comps: Component[], axis: DistributeAxis): void {
  if (comps.length < 3) return;
  const key = axis === 'horizontal' ? 'x' : 'y';
  const sorted = [...comps].sort((a, b) => a[key] - b[key]);
  const first = (sorted[0] as Component)[key];
  const last = (sorted[sorted.length - 1] as Component)[key];
  const step = (last - first) / (sorted.length - 1);
  sorted.forEach((c, i) => {
    if (i === 0 || i === sorted.length - 1) return;
    const v = snap(first + step * i);
    if (axis === 'horizontal') c.setPos(v, c.y);
    else c.setPos(c.x, v);
  });
  finishMove();
}

function finishMove(): void {
  redrawAllConnections();
  appState.markDirty();
}
