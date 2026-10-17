import type { Component, ConductivityContext, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createSvgEl, createPort } from './shared/svgHelpers';
import {
  buildSlidingValve32Body,
  SLIDING_VALVE_W,
  SLIDING_VALVE_H,
  SLIDING_VALVE_OFFSET_X,
  SLIDING_VALVE_OFFSET_Y,
} from './shared/slidingValve32';
import { addSpringZigzag, SPRING_DEFAULT_GEOMETRY } from './shared/spring';

export const AIR_VALVE_32_TYPE = 'airValve32';

// Extra right-side room for the spring symbol, beyond the offset already reserved on the left.
// (+50/+34 rather than the "natural" +48/+30: chosen so ports 1/2/3 land exactly on the 10px
// grid relative to this canvas's own center - see src/core/grid.ts.)
const SVG_W = SLIDING_VALVE_OFFSET_X + SLIDING_VALVE_W + 50;
const SVG_H = SLIDING_VALVE_OFFSET_Y + SLIDING_VALVE_H + 34;

export interface AirValve32Geometry {
  /** x of the pilot port 14, relative to the mover's own origin. */
  pilotPortX: number;
  /** x of the pilot wall triangle's flat base. */
  pilotBaseX: number;
  /** x of the pilot wall triangle's tip, and the inner link's inner end. */
  pilotTipX: number;
  pilotHalfHeight: number;
  /** Return spring - see SPRING_DEFAULT_GEOMETRY in shared/spring.ts, which every
   * valve's spring is drawn from so the symbol set shares one design. */
  springSpan: number;
  springSegLen: number;
  springZigW: number;
  springZigH: number;
}

export const AIR_VALVE_32_DEFAULT_GEOMETRY: AirValve32Geometry = {
  // -42 rather than the "natural" -40: lands port 14 exactly on the 10px grid given the
  // SVG_W fix above.
  pilotPortX: -42,
  pilotBaseX: -26,
  pilotTipX: -6,
  pilotHalfHeight: 8,
  springSpan: SPRING_DEFAULT_GEOMETRY.springSpan,
  springSegLen: SPRING_DEFAULT_GEOMETRY.springSegLen,
  springZigW: SPRING_DEFAULT_GEOMETRY.springZigW,
  springZigH: SPRING_DEFAULT_GEOMETRY.springZigH,
};

/** Draws the pilot wall (inward triangle) + link + spring into the mover, matching the original
 * app's air-piloted artwork. Coordinates are local to the mover, not the canvas. Port 14 is
 * created here too since its position is one of this variant's own tunable dimensions. */
export function drawAirValve32Actuator(
  mover: SVGGElement,
  svg: SVGSVGElement,
  geo: AirValve32Geometry,
): { port14: ReturnType<typeof createPort> } {
  const cy = SLIDING_VALVE_H / 2;
  const spring = createSvgEl('g', { transform: `translate(${SLIDING_VALVE_W}, ${cy})` });
  addSpringZigzag(spring, 0, geo.springSpan, 0, 2, geo);

  const pilotTriangle = createSvgEl('path', {
    d: `M ${geo.pilotBaseX} ${cy + geo.pilotHalfHeight} L ${geo.pilotTipX} ${cy} L ${geo.pilotBaseX} ${cy - geo.pilotHalfHeight} Z`,
    fill: 'none',
    stroke: '#111',
    'stroke-width': 2,
  });
  const pilotLink = createSvgEl('path', {
    d: `M ${geo.pilotBaseX} ${cy} L ${geo.pilotPortX} ${cy}`,
    fill: 'none',
    stroke: '#111',
    'stroke-width': 2,
  });
  const pilotLink2 = createSvgEl('path', {
    d: `M 0 ${cy} L ${geo.pilotTipX} ${cy}`,
    fill: 'none',
    stroke: '#111',
    'stroke-width': 2,
  });
  const port14 = createPort(svg, '14', geo.pilotPortX, cy, 'H', {
    isPilot: true,
    pilotDir: -1,
  });
  mover.append(pilotTriangle, pilotLink, pilotLink2, port14.el, spring);
  return { port14 };
}

export function createAirValve32(compLayer: HTMLElement, x: number, y: number): Component {
  const geo = AIR_VALVE_32_DEFAULT_GEOMETRY;
  const shell = buildComponentShell(
    compLayer,
    AIR_VALVE_32_TYPE,
    x,
    y,
    SVG_W,
    SVG_H,
    '3/2 air-piloted',
    {
      x: SLIDING_VALVE_OFFSET_X,
      y: SLIDING_VALVE_OFFSET_Y,
      w: SLIDING_VALVE_W,
      h: SLIDING_VALVE_H,
    },
  );
  const valve = buildSlidingValve32Body(shell.svg, `arrow-air-${uid()}`);
  const { port14 } = drawAirValve32Actuator(valve.mover, shell.svg, geo);

  const ports = { ...valve.ports, '14': port14 };

  let active = false;
  // Swaps the two cells so the valve passes 1 -> 2 at rest instead of blocking it, turning it
  // normally open - see pushButton32.ts, which this mirrors. Only the artwork and the rule
  // change: actuating still slides the mover the same way, so the actuator animates identically
  // either way round.
  let normallyOpen = false;

  /** True while 1 is connected through to 2, whichever combination of actuated and
   * normally-open produced it - both the symbol and the rule follow this one value. */
  function flowing(): boolean {
    return active !== normallyOpen;
  }

  const comp: Component = {
    id: uid(),
    type: AIR_VALVE_32_TYPE,
    el: shell.el,
    x,
    y,
    svgW: SVG_W,
    svgH: SVG_H,
    gx: 0,
    gy: 0,
    ports,

    conductivityRule(): PortConnection[] {
      return flowing() ? [{ a: '2', b: '1' }] : [{ a: '2', b: '3' }];
    },

    onPressureChange(ctx: ConductivityContext): void {
      active = ctx.isPressurized('14');
      valve.setActive(active);
    },

    snapshot(): Record<string, unknown> {
      return {
        active,
        normallyOpen,
        showName: shell.getNameVisible(),
        customName: shell.getCustomName(),
        silencer3: valve.getSilencer(),
      };
    },
    restore(data: Record<string, unknown>): void {
      active = data.active as boolean;
      normallyOpen = Boolean(data.normallyOpen);
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      valve.setSilencer((data.silencer3 as 'none' | 'silencer') ?? 'silencer');
      valve.setSwapped(normallyOpen);
      valve.setActive(active);
    },
    reset(): void {
      active = false;
      valve.setActive(false);
    },

    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
  };

  valve.setActive(false);

  return comp;
}
