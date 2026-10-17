import type { Component, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createSvgEl, createPort } from './shared/svgHelpers';

export const SOURCE_TYPE = 'source';

export interface SourceGeometry {
  svgW: number;
  svgH: number;
  gx: number;
  gy: number;
  cx: number;
  cy: number;
  r: number;
  /** Y of the port/stem tip, in the same local coordinates as cx/cy. */
  portY: number;
}

// svgH (72, not the "natural" 73) and portY (16, not 14) are chosen together so the OUT port
// lands exactly on the 10px grid relative to this canvas's own center - an odd svgH alone
// leaves it a permanent half-pixel off - see src/core/grid.ts.
//
// cy is then what centers the drawing inside that canvas. The symbol runs from the port at
// portY down to the bottom of the circle at cy + r, so cy = 41 puts that span at 16..56 - an
// equal 16px margin top and bottom - where the previous 50 left 16 above and only 7 below and
// visibly sat low in its own box (most obvious in the sidebar icon, which frames the canvas).
// Any change here has to keep (portY - svgH / 2) a multiple of 10 or the port leaves the grid;
// with r = 15 that means the stem length (cy - r - portY) has to stay ≡ 10 (mod 20).
export const SOURCE_DEFAULT_GEOMETRY: SourceGeometry = {
  svgW: 46,
  svgH: 72,
  gx: -27,
  gy: 0,
  cx: 50,
  cy: 41,
  r: 15,
  portY: 16,
};

export function drawSourceBody(g: SVGElement, geo: SourceGeometry): { cx: number; portY: number } {
  g.appendChild(
    createSvgEl('circle', {
      cx: geo.cx,
      cy: geo.cy,
      r: geo.r,
      fill: '#fff',
      stroke: '#111',
      'stroke-width': 2,
    }),
  );
  g.appendChild(
    createSvgEl('circle', {
      cx: geo.cx,
      cy: geo.cy,
      r: geo.r * 0.55,
      fill: 'none',
      stroke: '#111',
      'stroke-width': 2,
    }),
  );
  // Reaches the exact port center (not just close to it), since a connected port's own circle
  // is hidden - any gap between the stem and the port position would otherwise show up as a
  // visible blank break in the wire.
  g.appendChild(
    createSvgEl('line', {
      x1: geo.cx,
      y1: geo.cy - geo.r,
      x2: geo.cx,
      y2: geo.portY,
      stroke: '#111',
      'stroke-width': 2,
    }),
  );
  return { cx: geo.cx, portY: geo.portY };
}

export function createSource(compLayer: HTMLElement, x: number, y: number): Component {
  const geo = SOURCE_DEFAULT_GEOMETRY;
  const shell = buildComponentShell(
    compLayer,
    SOURCE_TYPE,
    x,
    y,
    geo.svgW,
    geo.svgH,
    'Pressure source',
    {
      x: geo.gx + (geo.cx - geo.r),
      y: geo.gy + (geo.cy - geo.r),
      w: geo.r * 2,
      h: geo.r * 2,
    },
  );
  const g = createSvgEl('g', { transform: `translate(${geo.gx},${geo.gy})` });
  const { cx, portY } = drawSourceBody(g, geo);
  shell.svg.appendChild(g);

  const port = createPort(g, 'OUT', cx, portY, 'V');

  const comp: Component = {
    id: uid(),
    type: SOURCE_TYPE,
    el: shell.el,
    x,
    y,
    svgW: geo.svgW,
    svgH: geo.svgH,
    gx: geo.gx,
    gy: geo.gy,
    ports: { OUT: port },

    conductivityRule(): PortConnection[] {
      return [];
    },

    sourcePorts(): string[] {
      return ['OUT'];
    },

    snapshot(): Record<string, unknown> {
      return { showName: shell.getNameVisible(), customName: shell.getCustomName() };
    },
    restore(data: Record<string, unknown>): void {
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
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
