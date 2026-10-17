import type { ViewportAdapter } from '../ui/viewport';
import type { Component, PortKey } from '../core/types';

export function screenToWorld(
  viewport: ViewportAdapter,
  cx: number,
  cy: number,
): { x: number; y: number } {
  return viewport.clientToWorld(cx, cy);
}

export function worldToScreen(
  viewport: ViewportAdapter,
  wx: number,
  wy: number,
): { x: number; y: number } {
  const { scale, tx, ty } = viewport.getTransform();
  return { x: wx * scale + tx, y: wy * scale + ty };
}

/** A component's rotation in degrees (always a multiple of 90), normalized to 0..270 - read from
 * the same data-rot attribute its CSS transform is built from. */
export function componentRotation(comp: Component): 0 | 90 | 180 | 270 {
  return (((Number(comp.el.dataset.rot ?? '0') % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

/** Rotates a vector by a CSS-style (clockwise on screen, y pointing down) quarter-turn angle. */
export function rotateQuarter(x: number, y: number, deg: 0 | 90 | 180 | 270): [number, number] {
  if (deg === 90) return [-y, x];
  if (deg === 180) return [-x, -y];
  if (deg === 270) return [y, -x];
  return [x, y];
}

/** Resolves a component port to world coordinates via its live DOM position. */
export function portGlobalPosition(
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
  comp: Component,
  portKey: PortKey,
): { x: number; y: number } {
  const port = comp.ports[portKey];
  if (!port) return { x: comp.x, y: comp.y };

  const rect = port.el.getBoundingClientRect();
  const wsRect = workspaceEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2 - wsRect.left;
  const cy = rect.top + rect.height / 2 - wsRect.top;
  const world = screenToWorld(viewport, cx + wsRect.left, cy + wsRect.top);
  return world;
}
