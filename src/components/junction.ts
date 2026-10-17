import type { Component, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createPort, createSvgEl } from './shared/svgHelpers';

export const JUNCTION_TYPE = 'junction';

export interface JunctionGeometry {
  svgW: number;
  svgH: number;
  dotRadius: number;
}

export const JUNCTION_DEFAULT_GEOMETRY: JunctionGeometry = {
  svgW: 14,
  svgH: 14,
  dotRadius: 4,
};

export function drawJunctionBody(g: SVGElement, geo: JunctionGeometry): { cx: number; cy: number } {
  const cx = geo.svgW / 2;
  const cy = geo.svgH / 2;
  g.appendChild(createSvgEl('circle', { cx, cy, r: geo.dotRadius, fill: '#111' }));
  return { cx, cy };
}

export function createJunction(
  compLayer: HTMLElement,
  x: number,
  y: number,
  entryOrientation: 'H' | 'V' = 'H',
): Component {
  const geo = JUNCTION_DEFAULT_GEOMETRY;
  const shell = buildComponentShell(compLayer, JUNCTION_TYPE, x, y, geo.svgW, geo.svgH, '');
  const { cx, cy } = drawJunctionBody(shell.svg, geo);

  const ports = {
    P: createPort(shell.svg, 'P', cx, cy, entryOrientation, { radius: geo.dotRadius }),
  };

  const comp: Component = {
    id: uid(),
    type: JUNCTION_TYPE,
    el: shell.el,
    x,
    y,
    svgW: geo.svgW,
    svgH: geo.svgH,
    gx: 0,
    gy: 0,
    ports,

    conductivityRule(): PortConnection[] {
      return [];
    },

    // The axis a new branch leaves along (see wireSplitting.ts: across the line the junction
    // was placed on), saved so it survives a reload. Older saves have none and keep 'H'.
    snapshot(): Record<string, unknown> {
      return { orientation: ports.P.entryOrientation };
    },
    restore(data: Record<string, unknown>): void {
      if (data.orientation === 'H' || data.orientation === 'V') {
        ports.P.entryOrientation = data.orientation;
      }
    },
    reset(): void {},

    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
  };

  return comp;
}
