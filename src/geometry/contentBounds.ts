import { appState } from '../app/AppState';
import type { Component } from '../core/types';

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The smallest rect covering both inputs, ignoring whichever of them is absent. Null only if
 * both are - so callers can chain optional extents (the diagram, the page frame) and still tell
 * "nothing at all" from a real rect. */
export function unionBounds(a: WorldBounds | null, b: WorldBounds | null): WorldBounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** The union of a specific set of components' own world-space bounds. Null for an empty set,
 * so callers can tell "nothing to bound" from a genuine zero-size rect. */
export function boundsOf(components: Component[]): WorldBounds | null {
  if (components.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of components) {
    const b = c.getBounds();
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { minX, minY, maxX, maxY };
}

/** The union of every component's own world-space bounds (see Component.getBounds()) - the same
 * "what's actually on the canvas" extent persistence/exportImage.ts crops its SVG/PNG export to,
 * reused here for zoom-to-fit and for centering the page frame on the current diagram. Null with
 * an empty canvas, since there's nothing to bound. */
export function computeContentBounds(): WorldBounds | null {
  return boundsOf(appState.components);
}
