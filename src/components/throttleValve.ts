import type { Component, FlowVisualContext, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createPort, createSvgEl } from './shared/svgHelpers';
import { createSilencerSymbol, setSilencerState, type SilencerOption } from './shared/silencer';

export const THROTTLE_VALVE_TYPE = 'throttleValve';

// A plain adjustable restrictor, equally throttled both ways - one straight line between the two
// ports with a flow-restriction glyph (the ball-and-seat lens plus its directional arrow, reused
// verbatim from the one-way flow control valve's own check-valve path - see
// oneWayFlowControlValve.ts's decor group) centered on it. Matches a user-supplied reference
// symbol for a plain throttle valve; the arrow marks the drawn/rated flow direction the way a
// real adjustable flow control valve is often labeled, even though the restriction itself (and
// this component's own flowMultiplier) applies equally in both directions.
export interface ThrottleValveGeometry {
  localW: number;
  localH: number;
  /** x of the single line between IN and OUT (and the glyph centered on it). */
  portX: number;
  /** Margin from the top/bottom edge of localH to the IN/OUT ports (symmetric). */
  portMargin: number;
  /** Uniform scale applied to the shared lens+arrow glyph. */
  decorScale: number;
  decorOffsetX: number;
  decorOffsetY: number;
}

// Matches the one-way flow control valve's own scale (ONE_WAY_FLOW_DEFAULT_GEOMETRY) so the two
// components read as the same size/weight in a diagram - only localW shrinks, since there's no
// branch line to leave room for. portX sits exactly on localW's own center, which is what keeps
// IN/OUT on the 10px grid (see src/core/grid.ts) for any localW: a port's offset from the
// component's own center is then always 0, trivially a grid multiple.
export const THROTTLE_VALVE_DEFAULT_GEOMETRY: ThrottleValveGeometry = {
  localW: 54,
  localH: 80,
  portX: 27,
  portMargin: 10,
  decorScale: 1.7,
  decorOffsetX: -2.75,
  decorOffsetY: -34.8,
};

const OX = 7;
const OY = 7;
const DEFAULT_FLOW_PCT = 50;

/** Draws the body (the single line + restriction glyph) into `g`, and returns the port positions
 * that resulted so the caller can place ports/labels there. Pure with respect to `g`'s own
 * contents - safe to call repeatedly against a cleared `g` for a live preview. */
export function drawThrottleValveBody(
  g: SVGElement,
  geo: ThrottleValveGeometry,
): {
  bottomY: number;
  topY: number;
  portX: number;
  /** The single IN<->OUT path - live whenever air is actually crossing this valve, in either
   * direction (it throttles both the same, so there's nothing to distinguish here). */
  flowPath: SVGLineElement;
} {
  const bottomY = geo.localH - geo.portMargin;
  const topY = geo.portMargin;

  const flowPath = createSvgEl('line', {
    x1: geo.portX,
    y1: bottomY,
    x2: geo.portX,
    y2: topY,
    stroke: '#111',
    'stroke-width': 2,
  }) as SVGLineElement;
  flowPath.classList.add('owfvFlowPath');
  g.appendChild(flowPath);

  // The restriction glyph - lens/arc shape plus its diagonal adjustment arrow, lifted verbatim
  // from the one-way flow control valve's own throttle path (see
  // oneWayFlowControlValve.ts's decor group and drawOneWayFlowControlValveBody's own doc) so the
  // two components' line glyphs match exactly.
  const decorTransform = `matrix(${geo.decorScale},0,0,${geo.decorScale},${geo.decorOffsetX},${geo.decorOffsetY})`;
  const decor = createSvgEl('g', { transform: decorTransform });
  decor.append(
    createSvgEl('path', {
      d: 'M8,32c5.02,7.21,5.02,16.79,0,24',
      fill: 'none',
      stroke: '#111',
      'stroke-width': 1,
    }),
    createSvgEl('path', {
      d: 'M24,56c-5.02,-7.21,-5.02,-16.79,0,-24',
      fill: 'none',
      stroke: '#111',
      'stroke-width': 1,
    }),
    createSvgEl('line', { x1: 4, y1: 48, x2: 25, y2: 39.8, stroke: '#111', 'stroke-width': 1 }),
    createSvgEl('polygon', { points: '31,37.4 24.5,37.56 26.1,41.34', fill: '#111' }),
  );
  g.appendChild(decor);

  return { bottomY, topY, portX: geo.portX, flowPath };
}

/** A plain restrictor: throttles flow by the same `flowPct` regardless of which port it enters
 * through - unlike the one-way flow control valve, there's no check-valve path bypassing it. */
export function createThrottleValve(compLayer: HTMLElement, x: number, y: number): Component {
  const geo = THROTTLE_VALVE_DEFAULT_GEOMETRY;
  const svgW = geo.localW + OX * 2;
  const svgH = geo.localH + OY * 2;

  const shell = buildComponentShell(
    compLayer,
    THROTTLE_VALVE_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Throttle valve',
    { x: OX, y: OY, w: geo.localW, h: geo.localH },
  );

  const g = createSvgEl('g', { transform: `translate(${OX},${OY})` });
  const { bottomY, topY, portX, flowPath } = drawThrottleValveBody(g, geo);
  shell.svg.appendChild(g);

  const ports = {
    IN: createPort(g, 'IN', portX, bottomY, 'V'),
    OUT: createPort(g, 'OUT', portX, topY, 'V'),
  };

  // Either port can take a silencer, for the common exhaust-throttling setup where the throttle
  // screws straight into a valve's exhaust port and its free end vents to atmosphere (an open
  // port already counts as atmosphere in the simulation, so this is purely visual). Off by
  // default, since a throttle usually sits in a line.
  let silencerIN: SilencerOption = 'none';
  let silencerOUT: SilencerOption = 'none';
  const silencerInEl = createSilencerSymbol(portX, bottomY, 1);
  const silencerOutEl = createSilencerSymbol(portX, topY, -1);
  g.append(silencerInEl, silencerOutEl);
  function applySilencers(): void {
    setSilencerState(ports.IN, silencerInEl, silencerIN);
    setSilencerState(ports.OUT, silencerOutEl, silencerOUT);
  }
  applySilencers();

  let flowPct = DEFAULT_FLOW_PCT;

  function updateLabel(): void {
    shell.setDefaultName(`Throttle valve (${Math.round(flowPct)}%)`);
  }
  updateLabel();

  const comp: Component = {
    id: uid(),
    type: THROTTLE_VALVE_TYPE,
    el: shell.el,
    x,
    y,
    svgW,
    svgH,
    gx: 0,
    gy: 0,
    ports,

    conductivityRule(): PortConnection[] {
      return [{ a: 'IN', b: 'OUT' }];
    },

    flowMultiplier(): number {
      return flowPct / 100;
    },

    // Purely a visual cue, mirroring the one-way flow control valve's own (see that file's own
    // doc for why `isPressurized`/`isExhausting` are what settle this rather than something
    // simpler computed in step()) - except with only one path to ever highlight, there's no
    // upstream/downstream ambiguity to resolve here: whichever of the two is true just lights
    // this single line up as pressurized (steady) or exhausting (animated), full stop.
    updateFlowVisual(ctx: FlowVisualContext): void {
      const exhausting = ctx.isExhausting('IN') || ctx.isExhausting('OUT');
      const pressurized = !exhausting && (ctx.isPressurized('IN') || ctx.isPressurized('OUT'));
      flowPath.classList.toggle('owfvFlowPath--pressurized', pressurized);
      flowPath.classList.toggle('owfvFlowPath--exhausting', exhausting);
    },

    snapshot(): Record<string, unknown> {
      return {
        flowPct,
        silencerIN,
        silencerOUT,
        showName: shell.getNameVisible(),
        customName: shell.getCustomName(),
      };
    },
    restore(data: Record<string, unknown>): void {
      flowPct = data.flowPct as number;
      silencerIN = (data.silencerIN as SilencerOption) ?? 'none';
      silencerOUT = (data.silencerOUT as SilencerOption) ?? 'none';
      applySilencers();
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      updateLabel();
    },
    reset(): void {
      flowPath.classList.remove('owfvFlowPath--pressurized');
      flowPath.classList.remove('owfvFlowPath--exhausting');
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
