import type { Component, ConductivityContext, PortConnection, SimStepContext } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createPort, createPortLabel, createSvgEl } from './shared/svgHelpers';

export const QUICK_EXHAUST_VALVE_TYPE = 'quickExhaustValve';

/**
 * ISO-1219-style ball-and-seat symbol: a floating ball inside the housing that seats against
 * whichever side isn't currently fed, exactly matching this valve's own conductivity rule
 * below (1->2 open / 2->3 open are mutually exclusive) - `.qevBall.right` slides it over via a
 * CSS transition (see app.css) whenever port 1 is pressurized, and it rests at its drawn
 * (left-seated) position otherwise. The whole drawing is done at one fixed internal scale
 * (`SCALE`, applied as an SVG transform) rather than redrawing at a different size - every
 * coordinate below stays the same regardless of `SCALE`, and ports/labels/the ball's CSS-driven
 * travel all render correctly at whatever size because they're all children of the same scaled
 * group. localW/localH and every offset below (housingCenterY, port1LeadX, port2LeadTopY,
 * port3TipX) are nudged a few px from what a straight redraw of the reference icon would give,
 * so ports 1/2/3 land on a clean grid at the *reference* 1:1 size - see src/core/grid.ts;
 * shrinking via SCALE trades a little of that precision for the requested smaller footprint.
 */
export interface QuickExhaustValveGeometry {
  localW: number;
  localH: number;
  ox: number;
  oy: number;
  /** Uniform scale applied to the whole drawing (ports included) - see the file-level comment. */
  scale: number;
  /** Left edge / width of the main housing rect. */
  housingX: number;
  housingW: number;
  /** Vertical center of the housing - port 1 and port 3 both sit on this line. */
  housingCenterY: number;
  housingHalfH: number;
  /** x where port 1's lead-in line starts (its port position). */
  port1LeadX: number;
  /** x where the ball rests when seated left (port 1 not pressurized). */
  ballLeftCx: number;
  ballRadius: number;
  /** How far the ball travels right when port 1 pressurizes and seats it against the other
   * side - kept as a delta (rather than a second absolute cx) so the left/right positions stay
   * exactly mirrored about the housing center regardless of other tuning. */
  ballTravel: number;
  /** y where port 2's lead-in line starts, above the housing. */
  port2LeadTopY: number;
  /** x of the exhaust arrow's tip, just before port 3's own short final lead-in. */
  port3TipX: number;
  /** x where port 3's lead-in line ends (its port position), just past the arrow tip. */
  port3LeadX: number;
}

// scale 1.0 - the reference icon's own drawn size, ~17% smaller than the previous 1.2. At scale
// 1.0 every raw coordinate below *is* its own final on-canvas position, so landing on the 10px
// grid just means each one is already a multiple of 10 relative to localW/2 (76) or localH/2
// (37) - no scale-dependent re-nudging needed, unlike 0.8 or 1.2 (see src/core/grid.ts).
export const QUICK_EXHAUST_VALVE_DEFAULT_GEOMETRY: QuickExhaustValveGeometry = {
  localW: 152,
  localH: 74,
  ox: 8,
  oy: 8,
  scale: 1.0,
  housingX: 24,
  housingW: 64,
  housingCenterY: 47,
  housingHalfH: 16,
  port1LeadX: 6,
  ballLeftCx: 39,
  ballRadius: 4,
  ballTravel: 34,
  port2LeadTopY: 17,
  port3TipX: 141,
  port3LeadX: 146,
};

export function drawQuickExhaustValveBody(
  g: SVGElement,
  geo: QuickExhaustValveGeometry,
): {
  ball: SVGEllipseElement;
  /** The two halves of the main horizontal line, split (but drawn touching - no gap) at the
   * port-2 junction so the currently-conducting side can be highlighted independently: `toPort2`
   * is the port-1-to-junction half (live when port 1 is pressurized, feeding port 2), `toExhaust`
   * is the junction-to-muffler half (live otherwise, venting port 2 out through port 3). */
  toPort2: SVGLineElement;
  toExhaust: SVGLineElement;
  port2Line: SVGLineElement;
  label1: SVGTextElement;
  label2: SVGTextElement;
  '1': { cx: number; cy: number };
  '2': { cx: number; cy: number };
  '3': { cx: number; cy: number };
} {
  const cy = geo.housingCenterY;
  const housingRight = geo.housingX + geo.housingW;
  const seatInnerX = geo.housingX + 16;
  const seatOuterX = housingRight - 16;
  const junctionX = housingRight - geo.housingW / 2;

  function line(x1: number, y1: number, x2: number, y2: number): SVGLineElement {
    return createSvgEl('line', { x1, y1, x2, y2, stroke: '#111', 'stroke-width': 1.5 });
  }
  function path(d: string, opts: { dashed?: boolean } = {}): SVGPathElement {
    return createSvgEl('path', {
      d,
      fill: 'none',
      stroke: '#111',
      'stroke-width': 1.5,
      ...(opts.dashed ? { 'stroke-dasharray': '3 3' } : {}),
    });
  }

  g.appendChild(
    createSvgEl('rect', {
      x: geo.housingX,
      y: cy - geo.housingHalfH,
      width: geo.housingW,
      height: geo.housingHalfH * 2,
      fill: 'none',
      stroke: '#111',
      'stroke-width': 2,
    }),
  );

  // One continuous line from port 1 through to the exhaust muffler - split in two only so the
  // currently-conducting half can be colored (see toPort2/toExhaust above), never leaving an
  // actual gap between them. The ball (drawn later, below, with an opaque fill) covers whatever
  // line is directly behind it at its own current position, so there's never a visible stub of
  // line poking out from behind it either.
  const toPort2 = line(geo.port1LeadX, cy, junctionX, cy);
  toPort2.classList.add('qevFlowPath');
  const toExhaust = line(junctionX, cy, housingRight + 16, cy);
  toExhaust.classList.add('qevFlowPath');
  g.append(toPort2, toExhaust);

  // The two seats the ball presses against - a small inward-pointing wedge on each side.
  g.append(
    path(`M ${seatInnerX} ${cy - 8} L ${seatInnerX - 8} ${cy} L ${seatInnerX} ${cy + 8}`),
    path(`M ${seatOuterX} ${cy - 8} L ${seatOuterX + 8} ${cy} L ${seatOuterX} ${cy + 8}`),
  );

  // Port 2's own lead-in, straight down the housing's vertical centerline, plus the small dot
  // marking where it meets the main horizontal path (standard ISO junction marker).
  const port2Line = line(junctionX, geo.port2LeadTopY, junctionX, cy);
  port2Line.classList.add('qevFlowPath');
  g.append(
    port2Line,
    createSvgEl('ellipse', { cx: junctionX, cy, rx: 2, ry: 2, fill: '#111', stroke: '#111' }),
  );

  // Internal pilot line (dashed, ISO convention): port 2's own pressure is routed back down
  // into the housing's upper-right corner, which is what lets this valve sense the pressure
  // differential and hold the ball over rather than needing a separate pilot port.
  g.appendChild(
    path(
      `M ${junctionX} ${cy - geo.housingHalfH} ` +
        `L ${junctionX + 8} ${cy - geo.housingHalfH - 8} ` +
        `L ${housingRight + 8} ${cy - geo.housingHalfH - 8} ` +
        `L ${housingRight + 8} ${cy - 8} ` +
        `L ${housingRight} ${cy - 8}`,
      { dashed: true },
    ),
  );

  const ball = createSvgEl('ellipse', {
    class: 'qevBall',
    cx: geo.ballLeftCx,
    cy,
    rx: geo.ballRadius,
    ry: geo.ballRadius,
    fill: '#fff',
    stroke: '#111',
    'stroke-width': 1.5,
  });
  g.appendChild(ball);

  // Exhaust muffler (port 3's own built-in silencer - a quick-exhaust valve's whole purpose is
  // fast atmospheric venting, so unlike other valves' exhaust ports this one always has it).
  const muffler = { x: housingRight + 16, y: cy - 8, w: 32, h: 16 };
  g.append(
    createSvgEl('rect', {
      x: muffler.x,
      y: muffler.y,
      width: muffler.w,
      height: muffler.h,
      fill: 'none',
      stroke: '#111',
      'stroke-width': 1.5,
    }),
    // Internal baffles, alternating from the bottom/top edge in to the centerline (not full
    // vertical lines) - the standard zigzag-baffle look for a muffler's cross-section.
    path(
      `M ${muffler.x + 8} ${muffler.y + muffler.h} L ${muffler.x + 8} ${cy} ` +
        `M ${muffler.x + 16} ${muffler.y} L ${muffler.x + 16} ${cy} ` +
        `M ${muffler.x + 24} ${muffler.y + muffler.h} L ${muffler.x + 24} ${cy} ` +
        `M ${muffler.x + muffler.w} ${cy - 4} L ${muffler.x + muffler.w + 5} ${cy} L ${muffler.x + muffler.w} ${cy + 4}`,
    ),
    line(muffler.x + muffler.w + 5, cy, geo.port3LeadX, cy),
  );

  const label1 = createPortLabel(g, geo.port1LeadX, cy, '1', { anchor: 'middle', dy: 18 });
  const label2 = createPortLabel(g, junctionX, geo.port2LeadTopY, '2', {
    anchor: 'middle',
    dy: -10,
  });

  return {
    ball,
    toPort2,
    toExhaust,
    port2Line,
    label1,
    label2,
    '1': { cx: geo.port1LeadX, cy },
    '2': { cx: junctionX, cy: geo.port2LeadTopY },
    '3': { cx: geo.port3LeadX, cy },
  };
}

/**
 * Self-piloted by its own supply port: when port 1 is pressurized it passes 1->2 through to the
 * cylinder; the instant port 1 drops, it opens a dedicated one-way vent 2->3 so the cylinder can
 * exhaust locally through the valve's own port 3 instead of back through the whole supply line.
 */
export function createQuickExhaustValve(compLayer: HTMLElement, x: number, y: number): Component {
  const geo = QUICK_EXHAUST_VALVE_DEFAULT_GEOMETRY;
  const svgW = geo.localW * geo.scale + geo.ox * 2;
  const svgH = geo.localH * geo.scale + geo.oy * 2;

  const shell = buildComponentShell(
    compLayer,
    QUICK_EXHAUST_VALVE_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Quick-exhaust valve',
    {
      x: geo.ox + geo.housingX * geo.scale,
      y: geo.oy + (geo.housingCenterY - geo.housingHalfH) * geo.scale,
      w: geo.housingW * geo.scale,
      h: geo.housingHalfH * 2 * geo.scale,
    },
  );

  const g = createSvgEl('g', { transform: `translate(${geo.ox},${geo.oy}) scale(${geo.scale})` });
  const p = drawQuickExhaustValveBody(g, geo);
  shell.svg.appendChild(g);

  const ports = {
    '1': createPort(g, '1', p['1'].cx, p['1'].cy, 'H'),
    '2': createPort(g, '2', p['2'].cx, p['2'].cy, 'V'),
    '3': createPort(g, '3', p['3'].cx, p['3'].cy, 'H'),
  };

  let showPortNumbers = false;

  function applyPortNumbersVisible(): void {
    p.label1.style.display = showPortNumbers ? '' : 'none';
    p.label2.style.display = showPortNumbers ? '' : 'none';
  }
  applyPortNumbersVisible();

  const comp: Component = {
    id: uid(),
    type: QUICK_EXHAUST_VALVE_TYPE,
    el: shell.el,
    x,
    y,
    svgW,
    svgH,
    gx: 0,
    gy: 0,
    ports,

    conductivityRule(ctx: ConductivityContext): PortConnection[] {
      return ctx.isPressurized('1') ? [{ a: '1', b: '2' }] : [{ a: '2', b: '3', directed: true }];
    },

    step(_dt: number, ctx: SimStepContext): void {
      const feeding1 = ctx.isPressurized('1');
      p.ball.classList.toggle('right', feeding1);
      // Highlights whichever half of the internal path is actually open right now: 1->2 while
      // port 1 is fed, or 2->3 (the quick-exhaust route) the instant it isn't - matching
      // conductivityRule above exactly, since the ball itself is what makes them exclusive.
      // 1->2 is supply reaching the cylinder, so it reads the same red as any other pressurized
      // wire; 2->3 is genuinely exhausting to atmosphere, so it gets the amber "exhausting" look
      // instead - the same distinction .wire.active vs .wire.exhausting draws for connections.
      p.toPort2.classList.toggle('qevFlowPath--pressurized', feeding1);
      p.toExhaust.classList.toggle('qevFlowPath--exhausting', !feeding1);
      // Port 2's own line carries whichever of the two is currently open, so it takes on that
      // same side's color rather than a fixed one of its own.
      p.port2Line.classList.toggle('qevFlowPath--pressurized', feeding1);
      p.port2Line.classList.toggle('qevFlowPath--exhausting', !feeding1);
    },

    snapshot(): Record<string, unknown> {
      return {
        showName: shell.getNameVisible(),
        customName: shell.getCustomName(),
        showPortNumbers,
      };
    },
    restore(data: Record<string, unknown>): void {
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      showPortNumbers = Boolean(data.showPortNumbers);
      applyPortNumbersVisible();
      p.ball.classList.remove('right');
      p.toPort2.classList.remove('qevFlowPath--pressurized');
      p.toExhaust.classList.remove('qevFlowPath--exhausting');
      p.port2Line.classList.remove('qevFlowPath--pressurized', 'qevFlowPath--exhausting');
    },
    reset(): void {
      p.ball.classList.remove('right');
      p.toPort2.classList.remove('qevFlowPath--pressurized');
      p.toExhaust.classList.remove('qevFlowPath--exhausting');
      p.port2Line.classList.remove('qevFlowPath--pressurized', 'qevFlowPath--exhausting');
    },

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
