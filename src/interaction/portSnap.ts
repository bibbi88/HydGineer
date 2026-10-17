import type { Component, PortDef } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';

/** How close a port has to already be, in screen pixels (independent of zoom), before it snaps
 * into exact alignment with another port - small enough that it only catches near-misses left
 * over from the grid's own rounding, not distant components the user hasn't aimed yet. */
const SNAP_SCREEN_RADIUS = 8;

export interface PortSnapCorrection {
  dx: number;
  dy: number;
}

function portWorldPos(viewport: ViewportAdapter, port: PortDef): { x: number; y: number } {
  const rect = port.el.getBoundingClientRect();
  return viewport.clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

/**
 * Finds the small nudge that would bring one of `comp`'s own ports into exact x or y alignment
 * (independently per axis, like the "smart guides" in most diagram editors) with the nearest
 * port on any other component, so wires between them can run as a straight line instead of a
 * dogleg caused by the two components' differing internal padding. Returns a zero correction
 * when nothing is within range.
 */
export function computePortSnapCorrection(
  comp: Component,
  viewport: ViewportAdapter,
): PortSnapCorrection {
  const threshold = SNAP_SCREEN_RADIUS / viewport.getTransform().scale;

  const ownPositions = Object.values(comp.ports).map((port) => portWorldPos(viewport, port));
  if (ownPositions.length === 0) return { dx: 0, dy: 0 };

  let bestDx = 0;
  let bestDxDist = threshold;
  let bestDy = 0;
  let bestDyDist = threshold;

  for (const other of appState.components) {
    if (other.id === comp.id) continue;
    for (const port of Object.values(other.ports)) {
      const otherPos = portWorldPos(viewport, port);
      for (const ownPos of ownPositions) {
        const dx = otherPos.x - ownPos.x;
        if (Math.abs(dx) < bestDxDist) {
          bestDxDist = Math.abs(dx);
          bestDx = dx;
        }
        const dy = otherPos.y - ownPos.y;
        if (Math.abs(dy) < bestDyDist) {
          bestDyDist = Math.abs(dy);
          bestDy = dy;
        }
      }
    }
  }

  return { dx: bestDx, dy: bestDy };
}
