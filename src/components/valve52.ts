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
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { createSilencerSymbol, setSilencerState, type SilencerOption } from './shared/silencer';

export const VALVE_52_TYPE = 'valve52';

// ===== Geometry, ported 1:1 from the original app's two-cell sliding 5/2 symbol =====
export interface Valve52Geometry {
  /** Width/height of a single cell - the housing is always two cells wide. */
  w0: number;
  h0: number;
  /** Static offset of the housing within the svg canvas (room for pilot ports). */
  gx0: number;
  gy0: number;
  /** Extra canvas room beyond the two-cell body, split as svgW = w0*2 + extraW / svgH = h0 + extraH. */
  extraW: number;
  extraH: number;
  stroke: number;
  font: number;
  /** Pilot triangle height as a fraction of h0, and its width as a multiple of that height. */
  triHRatio: number;
  triWRatio: number;
  triGap: number;
  pilotPortOffset: number;
  /** Extra reach (beyond the triangle's own tip) from each pilot port to its triangle. */
  pilotLinkGap: number;
  /** Inset of each cell's own diagonal/vertical flow arrows from the cell's edges. */
  cellArrowInset: number;
  /** x-inset (from the housing's side edge) of ports 4/2/5/3; y-lead (above/below the housing) of ports 4/2/5/1/3. */
  fixedPortInset: number;
  fixedPortLead: number;
  /** Label offset used for the crowded bottom-row ports (5/1/3). */
  tightLabelDx: number;
  tightLabelDy: number;
}

export const VALVE_52_DEFAULT_GEOMETRY: Valve52Geometry = {
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
  // 16 rather than the "natural" 15: lands the pilot ports (14/12) exactly on the grid too,
  // given the extraH fix above.
  pilotLinkGap: 16,
  cellArrowInset: 10,
  fixedPortInset: 10,
  fixedPortLead: 10,
  tightLabelDx: -8,
  tightLabelDy: 4,
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

export interface Valve52Body {
  gInner: SVGGElement;
  gSlide: SVGGElement;
  midX: number;
  fixedPorts: { '4': PortDef; '2': PortDef; '5': PortDef; '1': PortDef; '3': PortDef };
  port12: PortDef;
  port14: PortDef;
  silencer3El: SVGGElement;
  silencer5El: SVGGElement;
}

/** Draws the full two-cell sliding 5/2 body: both cells' flow arrows, both pilot triangles, the
 * fixed 1/2/3/4/5 ports and their silencers. `gInner` (returned) carries the housing's static
 * offset plus whatever slide shift the caller applies via its own transform. */
export function drawValve52Body(
  svg: SVGSVGElement,
  geo: Valve52Geometry,
  arrowId: string,
): Valve52Body {
  const W0 = geo.w0;
  const H0 = geo.h0;
  const BODY_W = W0 * 2;
  const TRI_H = H0 * geo.triHRatio;
  const TRI_W = TRI_H * geo.triWRatio;
  const PILOT_CY = H0 / 2;
  const PORT14_LOCAL_X = -geo.pilotLinkGap - geo.pilotPortOffset;
  const PORT12_LOCAL_X = W0 * 2 + geo.pilotLinkGap + geo.pilotPortOffset;

  addDoubleArrowMarker(svg, arrowId);

  // gInner carries the fixed housing offset (GX0) plus the dynamic slide shift in one
  // transform, since the original app nested a static gRoot offset around a sliding gInner.
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

  gSlide.append(cell0, cell1);

  function addTriangleAndWallLine(parent: SVGElement, side: 'left' | 'right'): void {
    const tipX = side === 'left' ? -geo.triGap : BODY_W + geo.triGap;
    const dir = side === 'left' ? -1 : 1;
    const points = [
      [tipX, PILOT_CY],
      [tipX + dir * TRI_W, PILOT_CY - TRI_H / 2],
      [tipX + dir * TRI_W, PILOT_CY + TRI_H / 2],
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
        x2: side === 'left' ? 0 : BODY_W,
        y2: PILOT_CY,
        stroke: '#111',
        'stroke-width': geo.stroke,
      }),
    );
  }

  const gP14 = createSvgEl('g');
  const gP12 = createSvgEl('g');
  addTriangleAndWallLine(gP14, 'left');
  addTriangleAndWallLine(gP12, 'right');

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
  gP12.appendChild(
    createSvgEl('line', {
      x1: BODY_W + geo.triGap + TRI_W,
      y1: PILOT_CY,
      x2: PORT12_LOCAL_X,
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

  const port12 = createPort(svg, '12', PORT12_LOCAL_X, PILOT_CY, 'H', {
    isPilot: true,
    pilotDir: 1,
  });
  port12.el.setAttribute('r', '6');
  const label12 = createSvgEl('text', {
    x: PORT12_LOCAL_X,
    y: PILOT_CY - 10,
    'text-anchor': 'middle',
    'font-size': geo.font,
  });
  label12.textContent = '12';
  gP12.append(port12.el, label12);

  gInner.append(gSlide, gP12, gP14);
  svg.appendChild(gInner);

  // ===== Fixed ports (do not slide), offset by GX0 into the housing's coordinate space =====
  const fixedPortsLocal = {
    '4': { cx: geo.fixedPortInset, cy: -geo.fixedPortLead },
    '2': { cx: W0 - geo.fixedPortInset, cy: -geo.fixedPortLead },
    '5': { cx: geo.fixedPortInset, cy: H0 + geo.fixedPortLead },
    '1': { cx: W0 / 2, cy: H0 + geo.fixedPortLead },
    '3': { cx: W0 - geo.fixedPortInset, cy: H0 + geo.fixedPortLead },
  } as const;

  // Fixed lead-in lines from the housing's top/bottom edge to each port's exact center (not
  // just close to it), since a connected port's own circle is hidden - any gap would otherwise
  // show up as a visible blank break in the wire. Every fixed port's x-position falls within
  // the sliding cell's horizontal span in both states, so a vertical line at that x always
  // lands on the housing edge regardless of which cell is currently showing.
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

  // Not createLabeledPort's default 'left' offset (dx: -14): the three bottom-row ports (5, 1,
  // 3) sit only 30 units apart, so that offset reads as ambiguous - closer to the neighboring
  // port than to its own dot. A tighter, port-specific offset keeps each digit next to the port
  // it actually labels. Ports 4/2 on the top row aren't crowded this way and keep the default.
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

  const fixedPorts: Valve52Body['fixedPorts'] = {
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

  // Ports 3 and 5 are both this valve's exhausts - fixed in place (not part of the sliding
  // gInner), so each silencer just moves with the whole component like everything else drawn
  // directly on `svg`. Default on, matching how these valves are conventionally fitted in
  // practice - most exhaust ports get a silencer unless there's a specific reason not to.
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

  return { gInner, gSlide, midX: W0, fixedPorts, port12, port14, silencer3El, silencer5El };
}

export function createValve52(compLayer: HTMLElement, x: number, y: number): Component {
  const geo = VALVE_52_DEFAULT_GEOMETRY;
  const svgW = geo.w0 * 2 + geo.extraW;
  const svgH = geo.h0 + geo.extraH;

  // The two-cell sliding assembly is always fully drawn (no clipping window), so its footprint
  // physically shifts sideways by one cell width (w0) between states - state 0 spans
  // [gx0, gx0+bodyW], state 1 spans [gx0-w0, gx0+w0]. The component defaults (and resets) to
  // state 1, so that's the footprint getBounds() should report; using state 0's instead is what
  // misplaced the selection outline and left half of every sidebar icon blank.
  const shell = buildComponentShell(compLayer, VALVE_52_TYPE, x, y, svgW, svgH, '5/2 valve', {
    x: geo.gx0 - geo.w0,
    y: geo.gy0,
    w: geo.w0 * 2,
    h: geo.h0,
  });
  const svg = shell.svg;
  svg.style.overflow = 'visible';

  const arrowId = `arrow-v52-${uid()}`;
  const { gInner, gSlide, midX, fixedPorts, port12, port14, silencer3El, silencer5El } =
    drawValve52Body(svg, geo, arrowId);

  let silencer3: SilencerOption = 'silencer';
  let silencer5: SilencerOption = 'silencer';
  let state: 0 | 1 = 1;
  let pilot12Prev = false;
  let pilot14Prev = false;

  function setShift(shift: number): void {
    gInner.setAttribute('transform', `translate(${geo.gx0 + shift},${geo.gy0})`);
  }
  function applyState(): void {
    setShift(state === 0 ? 0 : -midX);
  }
  applyState();

  const comp: Component = {
    id: uid(),
    type: VALVE_52_TYPE,
    el: shell.el,
    x,
    y,
    svgW,
    svgH,
    gx: 0,
    gy: 0,
    ports: { ...fixedPorts, '12': port12, '14': port14 },

    // State 0 shows cell0 under the fixed ports: its diagonal arrow runs port4-column to
    // port1-column (1<->4) and its vertical arrow runs port2-column to port3-column (2<->3).
    // State 1 shows cell1: diagonal runs 1<->2, vertical runs 4<->5. This must match the
    // drawn artwork exactly, or the diagram shows one routing while simulating another.
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

    onPressureChange(ctx: ConductivityContext): void {
      const pilot12 = ctx.isPressurized('12');
      const pilot14 = ctx.isPressurized('14');
      const rising12 = pilot12 && !pilot12Prev;
      const rising14 = pilot14 && !pilot14Prev;
      const falling12 = !pilot12 && pilot12Prev;
      const falling14 = !pilot14 && pilot14Prev;
      // A real double-pilot valve only moves when one side is commanded while the other is
      // vented - with both pilots holding pressure at once the command is ambiguous (or the
      // valve is being fought from both ends), so it should hold its current position. That
      // means checking the *other* pilot's current level, not just whether it also rose this
      // same tick: it's just as invalid for one pilot to rise while the other is already held
      // on from an earlier tick as for both to rise together.
      //
      // Once one of the two pilots is removed again, though, the ambiguity is gone: whichever
      // pilot is still held becomes the (now unambiguous) command and should move the valve to
      // match it, exactly as if it had just risen on its own - otherwise a pilot that was held
      // the whole time it was blocked would never get to take effect at all.
      if (rising12 && !pilot14) state = 1;
      else if (rising14 && !pilot12) state = 0;
      else if (falling14 && pilot12) state = 1;
      else if (falling12 && pilot14) state = 0;
      pilot12Prev = pilot12;
      pilot14Prev = pilot14;
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
      pilot12Prev = false;
      pilot14Prev = false;
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

  function toggle(): void {
    if (appState.mode === Modes.STOP) return;
    state = state === 0 ? 1 : 0;
    applyState();
  }
  gSlide.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });

  return comp;
}
