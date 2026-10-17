import type { Component, ConductivityContext, PortConnection, PortDef } from '../core/types';
import { uid } from '../core/ids';
import {
  buildComponentShell,
  createSvgEl,
  createPort,
  createLabeledPort,
  createPortLabel,
  addDoubleArrowMarker,
} from './shared/svgHelpers';
import { createSilencerSymbol, setSilencerState, type SilencerOption } from './shared/silencer';
import { addSpringZigzag, SPRING_DEFAULT_GEOMETRY } from './shared/spring';

export const VALVE_52_MONO_TYPE = 'valve52Mono';

// Same two-cell sliding housing as the bistable 5/2 valve (valve52.ts), used as the base here -
// only pilot 12 and its side of the artwork differ: a spring (copied from the 3/2 valve
// family's own spring symbol) takes its place, and there's only the one pilot port left to
// drive the valve, so it's spring-return rather than holding whichever state it was last
// pushed to.
export interface Valve52MonoGeometry {
  w0: number;
  h0: number;
  gx0: number;
  gy0: number;
  extraW: number;
  extraH: number;
  stroke: number;
  font: number;
  triHRatio: number;
  triWRatio: number;
  triGap: number;
  pilotPortOffset: number;
  pilotLinkGap: number;
  cellArrowInset: number;
  fixedPortInset: number;
  fixedPortLead: number;
  tightLabelDx: number;
  tightLabelDy: number;
  /** Return spring - see SPRING_DEFAULT_GEOMETRY in shared/spring.ts, which every
   * valve's spring is drawn from so the symbol set shares one design. */
  springSpan: number;
  springSegLen: number;
  springZigW: number;
  springZigH: number;
}

export const VALVE_52_MONO_DEFAULT_GEOMETRY: Valve52MonoGeometry = {
  w0: 80,
  h0: 60,
  gx0: 115,
  gy0: 24,
  extraW: 110,
  // 48 rather than the "natural" 49: keeps svgH even (an odd canvas height leaves every port a
  // permanent half-pixel off the 10px grid, however else the geometry is tuned) and lands the
  // fixed ports exactly on it - see src/core/grid.ts.
  extraH: 48,
  stroke: 2,
  font: 10,
  triHRatio: 0.25,
  triWRatio: 1.2,
  triGap: 7,
  pilotPortOffset: 24,
  // 16 rather than the "natural" 15: lands the pilot port (14) exactly on the grid too, given
  // the extraH fix above.
  pilotLinkGap: 16,
  cellArrowInset: 10,
  fixedPortInset: 10,
  fixedPortLead: 10,
  tightLabelDx: -8,
  tightLabelDy: 4,
  springSpan: SPRING_DEFAULT_GEOMETRY.springSpan,
  springSegLen: SPRING_DEFAULT_GEOMETRY.springSegLen,
  springZigW: SPRING_DEFAULT_GEOMETRY.springZigW,
  springZigH: SPRING_DEFAULT_GEOMETRY.springZigH,
};

function addDoubleArrow(
  parent: SVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: number,
  arrowId: string,
): void {
  parent.appendChild(
    createSvgEl('line', {
      x1,
      y1,
      x2,
      y2,
      stroke: '#111',
      'stroke-width': stroke,
      'marker-start': `url(#${arrowId})`,
      'marker-end': `url(#${arrowId})`,
    }),
  );
}

export interface Valve52MonoBody {
  gInner: SVGGElement;
  midX: number;
  fixedPorts: { '4': PortDef; '2': PortDef; '5': PortDef; '1': PortDef; '3': PortDef };
  port14: PortDef;
  silencer3El: SVGGElement;
  silencer5El: SVGGElement;
}

export function drawValve52MonoBody(
  svg: SVGSVGElement,
  geo: Valve52MonoGeometry,
  arrowId: string,
): Valve52MonoBody {
  const W0 = geo.w0;
  const H0 = geo.h0;
  const BODY_W = W0 * 2;
  const TRI_H = H0 * geo.triHRatio;
  const TRI_W = TRI_H * geo.triWRatio;
  const PILOT_CY = H0 / 2;
  const PORT14_LOCAL_X = -geo.pilotLinkGap - geo.pilotPortOffset;

  addDoubleArrowMarker(svg, arrowId);

  const gInner = createSvgEl('g');

  const gSlide = createSvgEl('g');
  const cell0 = createSvgEl('g');
  cell0.appendChild(
    createSvgEl('rect', {
      x: 0,
      y: 0,
      width: W0,
      height: H0,
      fill: '#fff',
      stroke: '#111',
      'stroke-width': geo.stroke,
    }),
  );
  addDoubleArrow(cell0, W0 / 2, H0, geo.cellArrowInset, 0, geo.stroke, arrowId);
  addDoubleArrow(
    cell0,
    W0 - geo.cellArrowInset,
    0,
    W0 - geo.cellArrowInset,
    H0,
    geo.stroke,
    arrowId,
  );

  const cell1 = createSvgEl('g', { transform: `translate(${W0},0)` });
  cell1.appendChild(
    createSvgEl('rect', {
      x: 0,
      y: 0,
      width: W0,
      height: H0,
      fill: '#fff',
      stroke: '#111',
      'stroke-width': geo.stroke,
    }),
  );
  addDoubleArrow(cell1, W0 / 2, H0, W0 - geo.cellArrowInset, 0, geo.stroke, arrowId);
  addDoubleArrow(cell1, geo.cellArrowInset, 0, geo.cellArrowInset, H0, geo.stroke, arrowId);

  // The spring (same symbol as the 3/2 push-button/air-piloted valves' own spring) sits where
  // the second pilot used to be, sliding with the two-cell picture just like theirs slides with
  // the mover - representing the spring compressing/extending as the valve shifts.
  const spring = createSvgEl('g', { transform: `translate(${BODY_W},${PILOT_CY})` });
  addSpringZigzag(spring, 0, geo.springSpan, 0, geo.stroke, geo);

  gSlide.append(cell0, cell1, spring);

  function addTriangleAndWallLine(parent: SVGElement): void {
    const tipX = -geo.triGap;
    const points = [
      [tipX, PILOT_CY],
      [tipX - TRI_W, PILOT_CY - TRI_H / 2],
      [tipX - TRI_W, PILOT_CY + TRI_H / 2],
    ];
    parent.appendChild(
      createSvgEl('polygon', {
        points: points.map((p) => p.join(',')).join(' '),
        fill: 'none',
        stroke: '#111',
        'stroke-width': geo.stroke,
      }),
    );
    parent.appendChild(
      createSvgEl('line', {
        x1: tipX,
        y1: PILOT_CY,
        x2: 0,
        y2: PILOT_CY,
        stroke: '#111',
        'stroke-width': geo.stroke,
      }),
    );
  }

  const gP14 = createSvgEl('g');
  addTriangleAndWallLine(gP14);

  // Reaches the pilot port's exact center (not just close to it, which is what a visible port
  // circle would otherwise be relied on to bridge) - since a connected port's own circle is
  // hidden, any gap here would show up as a visible blank break in the wire.
  gP14.appendChild(
    createSvgEl('line', {
      x1: PORT14_LOCAL_X,
      y1: PILOT_CY,
      x2: -geo.triGap - TRI_W,
      y2: PILOT_CY,
      stroke: '#111',
      'stroke-width': geo.stroke,
    }),
  );

  const port14 = createPort(svg, '14', PORT14_LOCAL_X, PILOT_CY, 'H', {
    isPilot: true,
    pilotDir: -1,
  });
  port14.el.setAttribute('r', '6');
  const label14 = createSvgEl('text', {
    x: PORT14_LOCAL_X,
    y: PILOT_CY - 10,
    'text-anchor': 'middle',
    'font-size': geo.font,
  });
  label14.textContent = '14';
  gP14.append(port14.el, label14);

  gInner.append(gSlide, gP14);
  svg.appendChild(gInner);

  const fixedPortsLocal = {
    '4': { cx: geo.fixedPortInset, cy: -geo.fixedPortLead },
    '2': { cx: W0 - geo.fixedPortInset, cy: -geo.fixedPortLead },
    '5': { cx: geo.fixedPortInset, cy: H0 + geo.fixedPortLead },
    '1': { cx: W0 / 2, cy: H0 + geo.fixedPortLead },
    '3': { cx: W0 - geo.fixedPortInset, cy: H0 + geo.fixedPortLead },
  } as const;

  for (const key of ['4', '2'] as const) {
    const p = fixedPortsLocal[key];
    svg.appendChild(
      createSvgEl('line', {
        x1: geo.gx0 + p.cx,
        y1: geo.gy0,
        x2: geo.gx0 + p.cx,
        y2: geo.gy0 + p.cy,
        stroke: '#111',
        'stroke-width': geo.stroke,
      }),
    );
  }
  for (const key of ['5', '1', '3'] as const) {
    const p = fixedPortsLocal[key];
    svg.appendChild(
      createSvgEl('line', {
        x1: geo.gx0 + p.cx,
        y1: geo.gy0 + H0,
        x2: geo.gx0 + p.cx,
        y2: geo.gy0 + p.cy,
        stroke: '#111',
        'stroke-width': geo.stroke,
      }),
    );
  }

  function tightLeftLabeledPort(key: '5' | '1' | '3'): PortDef {
    const p = fixedPortsLocal[key];
    const px = geo.gx0 + p.cx;
    const py = geo.gy0 + p.cy;
    const port = createPort(svg, key, px, py, 'V');
    createPortLabel(svg, px, py, key, {
      anchor: 'end',
      dx: geo.tightLabelDx,
      dy: geo.tightLabelDy,
    });
    return port;
  }

  const fixedPorts: Valve52MonoBody['fixedPorts'] = {
    '4': createLabeledPort(
      svg,
      '4',
      geo.gx0 + fixedPortsLocal['4'].cx,
      geo.gy0 + fixedPortsLocal['4'].cy,
      'V',
      'left',
    ),
    '2': createLabeledPort(
      svg,
      '2',
      geo.gx0 + fixedPortsLocal['2'].cx,
      geo.gy0 + fixedPortsLocal['2'].cy,
      'V',
      'left',
    ),
    '5': tightLeftLabeledPort('5'),
    '1': tightLeftLabeledPort('1'),
    '3': tightLeftLabeledPort('3'),
  };

  const silencer3El = createSilencerSymbol(
    geo.gx0 + fixedPortsLocal['3'].cx,
    geo.gy0 + fixedPortsLocal['3'].cy,
    1,
  );
  const silencer5El = createSilencerSymbol(
    geo.gx0 + fixedPortsLocal['5'].cx,
    geo.gy0 + fixedPortsLocal['5'].cy,
    1,
  );
  setSilencerState(fixedPorts['3'], silencer3El, 'silencer');
  setSilencerState(fixedPorts['5'], silencer5El, 'silencer');
  svg.append(silencer3El, silencer5El);

  return { gInner, midX: W0, fixedPorts, port14, silencer3El, silencer5El };
}

export function createValve52Mono(compLayer: HTMLElement, x: number, y: number): Component {
  const geo = VALVE_52_MONO_DEFAULT_GEOMETRY;
  const svgW = geo.w0 * 2 + geo.extraW;
  const svgH = geo.h0 + geo.extraH;

  const shell = buildComponentShell(
    compLayer,
    VALVE_52_MONO_TYPE,
    x,
    y,
    svgW,
    svgH,
    '5/2 valve, monostable',
    { x: geo.gx0 - geo.w0, y: geo.gy0, w: geo.w0 * 2, h: geo.h0 },
  );
  const svg = shell.svg;
  svg.style.overflow = 'visible';

  const arrowId = `arrow-v52m-${uid()}`;
  const { gInner, midX, fixedPorts, port14, silencer3El, silencer5El } = drawValve52MonoBody(
    svg,
    geo,
    arrowId,
  );

  let silencer3: SilencerOption = 'silencer';
  let silencer5: SilencerOption = 'silencer';
  let state: 0 | 1 = 1;

  function setShift(shift: number): void {
    gInner.setAttribute('transform', `translate(${geo.gx0 + shift},${geo.gy0})`);
  }
  function applyState(): void {
    setShift(state === 0 ? 0 : -midX);
  }
  applyState();

  const comp: Component = {
    id: uid(),
    type: VALVE_52_MONO_TYPE,
    el: shell.el,
    x,
    y,
    svgW,
    svgH,
    gx: 0,
    gy: 0,
    ports: { ...fixedPorts, '14': port14 },

    conductivityRule(): PortConnection[] {
      return state === 0
        ? [
            { a: '1', b: '4' },
            { a: '2', b: '3' },
          ]
        : [
            { a: '1', b: '2' },
            { a: '4', b: '5' },
          ];
    },

    // Spring-return: with only one pilot, position simply follows its current pressure level -
    // pressurized pushes it to state 0, vented lets the spring pull it straight back to state 1,
    // with no edge-detection or ambiguity handling needed (there's nothing to be ambiguous with).
    onPressureChange(ctx: ConductivityContext): void {
      state = ctx.isPressurized('14') ? 0 : 1;
      applyState();
    },

    snapshot(): Record<string, unknown> {
      return {
        state,
        showName: shell.getNameVisible(),
        customName: shell.getCustomName(),
        silencer3,
        silencer5,
      };
    },
    restore(data: Record<string, unknown>): void {
      state = data.state as 0 | 1;
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      silencer3 = (data.silencer3 as SilencerOption) ?? 'silencer';
      silencer5 = (data.silencer5 as SilencerOption) ?? 'silencer';
      setSilencerState(fixedPorts['3'], silencer3El, silencer3);
      setSilencerState(fixedPorts['5'], silencer5El, silencer5);
      applyState();
    },
    reset(): void {
      state = 1;
      applyState();
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
