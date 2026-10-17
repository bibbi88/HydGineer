import type { Component, FlowVisualContext, PortConnection, PortKey } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createPort, createSvgEl } from './shared/svgHelpers';
import { addSpringZigzag, SPRING_DEFAULT_GEOMETRY } from './shared/spring';
import { SOURCE_PRESSURE } from '../sim/constants';

export const PRESSURE_REDUCING_VALVE_TYPE = 'pressureReducingValve';

// The ISO 1219-1 two-port adjustable pressure-reducing valve, drawn vertically (IN at the
// bottom, OUT at the top) to match this app's other inline flow components rather than the
// left-to-right layout the standard's own plates use - the symbol is the same either way, and
// the component can be rotated.
//
// Three features are what make it a *reducing* valve rather than a relief valve, and all three
// are drawn here:
//   - a single square envelope with the flow arrow in line through it, so the valve reads as
//     normally open and throttling rather than normally closed;
//   - the control line tapped from the OUTLET (a relief valve taps its inlet instead), drawn
//     dashed and led round into the far wall of the envelope - downstream pressure is what this
//     valve regulates against;
//   - an adjustable setting spring opposing that control line on the near wall, with the
//     diagonal arrow struck through it that denotes adjustability.
export interface PressureReducingValveGeometry {
  localW: number;
  localH: number;
  /** x of the flow axis. Sits on localW's own center, which is what keeps IN/OUT on the 10px
   * grid however wide the symbol gets - a port's offset from the component's own center is then
   * always 0 (see src/core/grid.ts, and throttleValve.ts's note on the same trick). */
  portX: number;
  /** Margin from the top/bottom edge of localH to the OUT/IN ports (symmetric). */
  portMargin: number;
  /** Half-width and half-height of the square envelope, about (portX, localH / 2). */
  boxHalfW: number;
  boxHalfH: number;
  /** How far the flow arrow inside the envelope stops short of its top and bottom walls. */
  arrowInset: number;
  /** Reach of the setting spring out from the envelope's left wall. */
  springSpan: number;
  springSegLen: number;
  springZigW: number;
  springZigH: number;
  /** How far right of the flow axis the control line runs before turning down to the envelope. */
  pilotX: number;
  /** Height above the envelope's top wall at which the control line taps the outlet. */
  pilotTapY: number;
  /** Half-length of the adjustability arrow, measured along the axis it is struck across. */
  adjustHalfH: number;
}

export const PRESSURE_REDUCING_VALVE_DEFAULT_GEOMETRY: PressureReducingValveGeometry = {
  // 100 tall (not the throttle valve's 80): with portMargin 10 that puts IN/OUT exactly 40
  // either side of the canvas center, a grid multiple. 92 wide leaves the spring and the control
  // line equal room either side of the axis, which is what keeps portX on that center.
  localW: 92,
  localH: 100,
  portX: 46,
  portMargin: 10,
  boxHalfW: 20,
  boxHalfH: 20,
  arrowInset: 6,
  springSpan: SPRING_DEFAULT_GEOMETRY.springSpan,
  springSegLen: SPRING_DEFAULT_GEOMETRY.springSegLen,
  springZigW: SPRING_DEFAULT_GEOMETRY.springZigW,
  springZigH: SPRING_DEFAULT_GEOMETRY.springZigH,
  pilotX: 82,
  pilotTapY: 6,
  adjustHalfH: 14,
};

const OX = 7;
const OY = 7;
/** Half of the 6 bar supply - a typical regulated working pressure, and a visibly reduced one,
 * so a freshly placed valve reads as doing something rather than passing supply straight on. */
const DEFAULT_OUTLET_PRESSURE = 3.0;

/** A straight arrow from (x1, y1) to the tip at (x2, y2) with a filled head of fixed size. Drawn
 * directly rather than with the shared SVG marker, whose head scales with stroke width and so
 * swamps a symbol this small. */
function addArrow(
  g: SVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  headLen: number,
  headHalfW: number,
): void {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const bx = x2 - ux * headLen;
  const by = y2 - uy * headLen;
  g.append(
    createSvgEl('line', { x1, y1, x2: bx, y2: by, stroke: '#111', 'stroke-width': width }),
    createSvgEl('path', {
      d: `M ${x2} ${y2} L ${bx - uy * headHalfW} ${by + ux * headHalfW} L ${bx + uy * headHalfW} ${by - ux * headHalfW} Z`,
      fill: '#111',
    }),
  );
}

/** Draws the symbol into `g` and returns the port positions that resulted. Pure with respect to
 * `g`'s own contents, so it can be called repeatedly against a cleared group. */
export function drawPressureReducingValveBody(
  g: SVGElement,
  geo: PressureReducingValveGeometry,
): {
  bottomY: number;
  topY: number;
  portX: number;
  /** The IN/OUT stubs either side of the envelope - lit whenever air is crossing the valve. */
  flowPath: SVGPathElement;
} {
  const bottomY = geo.localH - geo.portMargin;
  const topY = geo.portMargin;
  const midY = geo.localH / 2;
  const boxTop = midY - geo.boxHalfH;
  const boxBottom = midY + geo.boxHalfH;
  const boxLeft = geo.portX - geo.boxHalfW;
  const boxRight = geo.portX + geo.boxHalfW;

  // One element for both stubs (two subpaths) so there is a single thing to highlight, and so
  // neither stub runs through the envelope - the arrow inside is what carries flow across it.
  const flowPath = createSvgEl('path', {
    d: `M ${geo.portX} ${bottomY} L ${geo.portX} ${boxBottom} M ${geo.portX} ${boxTop} L ${geo.portX} ${topY}`,
    fill: 'none',
    stroke: '#111',
    'stroke-width': 2,
  }) as SVGPathElement;
  flowPath.classList.add('owfvFlowPath');
  g.appendChild(flowPath);

  g.appendChild(
    createSvgEl('rect', {
      x: boxLeft,
      y: boxTop,
      width: geo.boxHalfW * 2,
      height: geo.boxHalfH * 2,
      fill: '#fff',
      stroke: '#111',
      'stroke-width': 2,
    }),
  );

  // Flow arrow, pointing the way through the valve: in at the bottom, out at the top.
  addArrow(g, geo.portX, boxBottom - geo.arrowInset, geo.portX, boxTop + geo.arrowInset, 2, 8, 4);

  // Setting spring, bearing on the envelope's left wall, with the thin diagonal adjustability
  // arrow struck across it - kept clear of the envelope so the spring stays readable. Same
  // spring symbol the valve family uses (shared/spring.ts).
  const springEnd = boxLeft - geo.springSpan;
  addSpringZigzag(g, boxLeft, springEnd, midY, 2, geo);
  addArrow(
    g,
    springEnd + 2,
    midY + geo.adjustHalfH,
    boxLeft - 4,
    midY - geo.adjustHalfH,
    1.5,
    6,
    3,
  );

  // Control line, dashed, tapped off the outlet (with a junction dot where it joins) and led
  // round to the opposite wall, where it acts against the spring - the one feature that
  // distinguishes this from a relief valve, which taps its inlet instead.
  const tapY = boxTop - geo.pilotTapY;
  const DASH = 4;
  const GAP = 3;
  const pilotLen = geo.pilotX - geo.portX + (midY - tapY) + (geo.pilotX - boxRight);
  // Phase the dashes so the line always ends on a full dash at the envelope wall rather than
  // stopping short in a gap (the start is hidden under the junction dot anyway).
  const dashOffset = (((DASH - pilotLen) % (DASH + GAP)) + DASH + GAP) % (DASH + GAP);
  g.appendChild(
    createSvgEl('path', {
      d: `M ${geo.portX} ${tapY} L ${geo.pilotX} ${tapY} L ${geo.pilotX} ${midY} L ${boxRight} ${midY}`,
      fill: 'none',
      stroke: '#111',
      'stroke-width': 1.5,
      'stroke-dasharray': `${DASH} ${GAP}`,
      'stroke-dashoffset': dashOffset,
    }),
  );
  g.appendChild(createSvgEl('circle', { cx: geo.portX, cy: tapY, r: 2.5, fill: '#111' }));

  return { bottomY, topY, portX: geo.portX, flowPath };
}

/** An adjustable pressure-reducing valve (regulator): passes IN straight through to OUT, and
 * caps the pressure everything downstream of OUT sees at its set pressure.
 *
 * The cap is applied by the pressure graph (see `pressureLimit` below and sim/pressure.ts), so
 * it reaches everything that reads a real pressure: a cylinder's force is computed from what its
 * driven port is actually seeing, and port/wire readouts show the reduced figure. It only
 * reduces - a set pressure at or above the supply leaves the line at supply pressure, which is
 * exactly how a real regulator behaves.
 */
export function createPressureReducingValve(
  compLayer: HTMLElement,
  x: number,
  y: number,
): Component {
  const geo = PRESSURE_REDUCING_VALVE_DEFAULT_GEOMETRY;
  const svgW = geo.localW + OX * 2;
  const svgH = geo.localH + OY * 2;

  const shell = buildComponentShell(
    compLayer,
    PRESSURE_REDUCING_VALVE_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Pressure reducing valve',
    { x: OX, y: OY, w: geo.localW, h: geo.localH },
  );

  const g = createSvgEl('g', { transform: `translate(${OX},${OY})` });
  const { bottomY, topY, portX, flowPath } = drawPressureReducingValveBody(g, geo);
  shell.svg.appendChild(g);

  const ports = {
    IN: createPort(g, 'IN', portX, bottomY, 'V'),
    OUT: createPort(g, 'OUT', portX, topY, 'V'),
  };

  let outletPressure = DEFAULT_OUTLET_PRESSURE;

  function updateLabel(): void {
    shell.setDefaultName(`Reducing valve (${outletPressure.toFixed(1)} bar)`);
  }
  updateLabel();

  const comp: Component = {
    id: uid(),
    type: PRESSURE_REDUCING_VALVE_TYPE,
    el: shell.el,
    x,
    y,
    svgW,
    svgH,
    gx: 0,
    gy: 0,
    ports,

    // Normally open: a regulator restricts pressure, not the topology, so air always has a path
    // through it.
    // One way only, IN -> OUT. Once the outlet reaches the set pressure the valve closes, and
    // air downstream can't push back through it - a cylinder fed through it can't exhaust back
    // this way, so it holds (fit a check valve in parallel, or put the reducing valve in the
    // supply ahead of the directional valve, for a return path).
    conductivityRule(): PortConnection[] {
      return [{ a: 'IN', b: 'OUT', directed: true }];
    },

    // Downstream only: caps what reaches OUT at the set pressure.
    pressureLimit(fromPort: PortKey): number | null {
      return fromPort === 'IN' ? outletPressure : null;
    },

    updateFlowVisual(ctx: FlowVisualContext): void {
      const exhausting = ctx.isExhausting('IN') || ctx.isExhausting('OUT');
      const pressurized = !exhausting && (ctx.isPressurized('IN') || ctx.isPressurized('OUT'));
      flowPath.classList.toggle('owfvFlowPath--pressurized', pressurized);
      flowPath.classList.toggle('owfvFlowPath--exhausting', exhausting);
    },

    snapshot(): Record<string, unknown> {
      return {
        outletPressure,
        showName: shell.getNameVisible(),
        customName: shell.getCustomName(),
      };
    },
    restore(data: Record<string, unknown>): void {
      // Clamped to the supply: a regulator can only reduce, so a set point above SOURCE_PRESSURE
      // would be meaningless (and the inspector's own slider stops there too).
      const next = Number(data.outletPressure);
      outletPressure = Number.isFinite(next)
        ? Math.max(0, Math.min(SOURCE_PRESSURE, next))
        : DEFAULT_OUTLET_PRESSURE;
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      updateLabel();
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
