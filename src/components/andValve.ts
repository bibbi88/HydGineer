import type { Component, ConductivityContext, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createSvgEl, createLabeledPort } from './shared/svgHelpers';

export const AND_VALVE_TYPE = 'andValve';

export interface AndValveGeometry {
  svgW: number;
  svgH: number;
  gx: number;
  gy: number;
  husX: number;
  husY: number;
  husW: number;
  husH: number;
  /** How far in from each housing side edge the seat lines sit. */
  seatInset: number;
  /** How far outside the housing each A/B/OUT port sits. */
  portLead: number;
}

export const AND_VALVE_DEFAULT_GEOMETRY: AndValveGeometry = {
  svgW: 200,
  svgH: 102,
  gx: 10,
  // -29 rather than the "natural" -26: lands ports A/B/OUT exactly on the 10px grid relative
  // to this canvas's own center - see src/core/grid.ts.
  gy: -29,
  husX: 40,
  husY: 60,
  husW: 100,
  husH: 60,
  seatInset: 35,
  portLead: 20,
};

function line(x1: number, y1: number, x2: number, y2: number): SVGLineElement {
  return createSvgEl('line', { x1, y1, x2, y2, stroke: '#111', 'stroke-width': 2 });
}
function rect(x: number, y: number, w: number, h: number): SVGRectElement {
  return createSvgEl('rect', {
    x,
    y,
    width: w,
    height: h,
    fill: '#fff',
    stroke: '#111',
    'stroke-width': 2,
  });
}

export function drawAndValveBody(
  g: SVGElement,
  geo: AndValveGeometry,
): {
  a: { cx: number; cy: number };
  b: { cx: number; cy: number };
  out: { cx: number; cy: number };
} {
  const yMid = geo.husY + geo.husH / 2;
  const leftX = geo.husX + geo.seatInset;
  const rightX = geo.husX + geo.husW - geo.seatInset;

  g.append(
    rect(geo.husX, geo.husY, geo.husW, geo.husH),
    line(leftX - 20, geo.husY, leftX - 20, geo.husY + 23),
    line(leftX - 27, geo.husY + 15, leftX - 27, geo.husY + geo.husH - 15),
    line(leftX - 20, geo.husY + geo.husH, leftX - 20, geo.husY + geo.husH - 23),
    line(rightX + 20, geo.husY, rightX + 20, geo.husY + 23),
    line(rightX + 27, geo.husY + 15, rightX + 27, geo.husY + geo.husH - 15),
    line(rightX + 20, geo.husY + geo.husH, rightX + 20, geo.husY + geo.husH - 23),
    line(leftX - 27, yMid, rightX + 27, yMid),
  );

  const A = { cx: geo.husX - geo.portLead, cy: yMid };
  const B = { cx: geo.husX + geo.husW + geo.portLead, cy: yMid };
  const OUT = { cx: geo.husX + geo.husW / 2, cy: geo.husY - geo.portLead };

  // These lead-in lines must reach the exact port center (not just close to it), since a
  // connected port's own circle is hidden - any gap between the line and the port position
  // would otherwise show up as a visible blank break in the wire.
  g.append(
    line(geo.husX, A.cy, A.cx, A.cy),
    line(geo.husX + geo.husW, B.cy, B.cx, B.cy),
    line(OUT.cx, OUT.cy, OUT.cx, geo.husY),
  );

  return { a: A, b: B, out: OUT };
}

export function createAndValve(compLayer: HTMLElement, x: number, y: number): Component {
  const geo = AND_VALVE_DEFAULT_GEOMETRY;
  const shell = buildComponentShell(
    compLayer,
    AND_VALVE_TYPE,
    x,
    y,
    geo.svgW,
    geo.svgH,
    'AND valve',
    {
      x: geo.gx + geo.husX,
      y: geo.gy + geo.husY,
      w: geo.husW,
      h: geo.husH,
    },
  );
  const g = createSvgEl('g', { transform: `translate(${geo.gx},${geo.gy})` });
  const { a: A, b: B, out: OUT } = drawAndValveBody(g, geo);
  shell.svg.appendChild(g);

  const ports = {
    A: createLabeledPort(g, 'A', A.cx, A.cy, 'H', 'left'),
    B: createLabeledPort(g, 'B', B.cx, B.cy, 'H', 'left'),
    OUT: createLabeledPort(g, 'OUT', OUT.cx, OUT.cy, 'V', 'left'),
  };

  const comp: Component = {
    id: uid(),
    type: AND_VALVE_TYPE,
    el: shell.el,
    x,
    y,
    svgW: geo.svgW,
    svgH: geo.svgH,
    gx: geo.gx,
    gy: geo.gy,
    ports,

    conductivityRule(ctx: ConductivityContext): PortConnection[] {
      return ctx.isPressurized('A') && ctx.isPressurized('B')
        ? [
            { a: 'A', b: 'OUT' },
            { a: 'B', b: 'OUT' },
          ]
        : [];
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
