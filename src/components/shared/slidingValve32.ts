import { createSvgEl, addArrowMarker, createLabeledPort } from './svgHelpers';
import { createSilencerSymbol, setSilencerState, type SilencerOption } from './silencer';
import type { PortDef } from '../../core/types';

export interface SlidingValve32Geometry {
  bodyW: number;
  bodyH: number;
  offsetX: number;
  offsetY: number;
  /** Ratio of the right cell's half-width used to inset the P1/P2/L1/L2 column from the frame's
   * vertical centerline. */
  insetRightRatio: number;
  /** Gap from the frame's side edge to port 3's column / the T-block's stem column. */
  portEdgeGap: number;
  /** How far the diagonal flow arrow's endpoints sit clear of the frame's top/bottom edges. */
  arrowEdgeGap: number;
  /** Half-width of the T-block's crossbar. */
  tBlockBarHalfWidth: number;
  /** Gap from the frame's bottom edge up to the T-block's crossbar. */
  tBlockBottomGap: number;
  /** Gap from the T-block's crossbar down to its stem's open end. */
  tBlockStemGap: number;
  /** Direction (in local +y units) the silencer glyph fitted to port 3 extends away from it. */
  silencerDir: 1 | -1;
}

export const SLIDING_VALVE_32_DEFAULT_GEOMETRY: SlidingValve32Geometry = {
  bodyW: 140,
  bodyH: 60,
  // Static placement of the whole symbol within its component canvas - large enough that every
  // variant's actuator extras (pilot ports, roller, spring) stay inside the canvas instead of
  // relying entirely on overflow:visible.
  offsetX: 54,
  offsetY: 34,
  insetRightRatio: 0.25,
  portEdgeGap: 12,
  arrowEdgeGap: 10,
  tBlockBarHalfWidth: 10,
  tBlockBottomGap: 18,
  tBlockStemGap: 8,
  silencerDir: 1,
};

// Every variant (push button, air-piloted, limit valve, time delay) positions its own
// actuator-specific extras (spring, roller, pilot triangle, clock) relative to these - derived
// from the shared geometry above (rather than duplicated literals) so tuning the shared body
// keeps every variant's actuator artwork lined up with it.
export const SLIDING_VALVE_W = SLIDING_VALVE_32_DEFAULT_GEOMETRY.bodyW;
export const SLIDING_VALVE_H = SLIDING_VALVE_32_DEFAULT_GEOMETRY.bodyH;
export const SLIDING_VALVE_OFFSET_X = SLIDING_VALVE_32_DEFAULT_GEOMETRY.offsetX;
export const SLIDING_VALVE_OFFSET_Y = SLIDING_VALVE_32_DEFAULT_GEOMETRY.offsetY;

export interface SlidingValve32Body {
  /** Everything that slides sideways when the valve actuates - append actuator-specific
   * graphics (roller, rod, pilot triangle) here so they move with the rest of the symbol. */
  mover: SVGGElement;
  ports: { '1': PortDef; '2': PortDef; '3': PortDef };
  /** true = left cell (2->1, 3 blocked) sits under the ports; false = right cell (2->3, 1 blocked). */
  setActive(active: boolean): void;
  /** Swaps which half of the frame each cell's artwork occupies, turning a normally-closed
   * valve into a normally-open one and back. Only the two cells move; the frame, the ports and
   * whatever actuator the variant drew into `mover` all stay exactly where they are, so a wire
   * already attached to a port is untouched and the button/roller doesn't jump. */
  setSwapped(swapped: boolean): void;
  /** Port 3 is this valve family's exhaust - the one a silencer would actually be fitted to. */
  setSilencer(option: SilencerOption): void;
  getSilencer(): SilencerOption;
}

function tBlock(
  xCenter: number,
  yBar: number,
  yStemEnd: number,
  barHalfWidth: number,
): SVGGElement {
  const g = createSvgEl('g');
  g.appendChild(
    createSvgEl('path', {
      d: `M ${xCenter - barHalfWidth} ${yBar} L ${xCenter + barHalfWidth} ${yBar}`,
      fill: 'none',
      stroke: '#111',
      'stroke-width': 2,
    }),
  );
  g.appendChild(
    createSvgEl('path', {
      d: `M ${xCenter} ${yBar} L ${xCenter} ${yStemEnd}`,
      fill: 'none',
      stroke: '#111',
      'stroke-width': 2,
    }),
  );
  return g;
}

/** Shared body for the 3/2 "sliding mover" valve family (limit valve, push button, air-piloted
 * valve): a two-cell frame with a diagonal flow arrow + T-block (blocked port) symbol in each
 * cell, which slides sideways to swap which cell sits under the fixed 1/2/3 ports - matching the
 * original app's pushButton32/limitValve32/airValve32 artwork. */
export function buildSlidingValve32Body(
  svg: SVGSVGElement,
  arrowId: string,
  geo: SlidingValve32Geometry = SLIDING_VALVE_32_DEFAULT_GEOMETRY,
): SlidingValve32Body {
  const W = geo.bodyW;
  const H = geo.bodyH;
  const midX = W / 2;
  addArrowMarker(svg, arrowId);

  const insetRight = Math.round((W - midX) * geo.insetRightRatio);
  const P2 = { cx: midX + insetRight, cy: -geo.arrowEdgeGap };
  const P1 = { cx: midX + insetRight, cy: H + geo.arrowEdgeGap };
  const P3 = { cx: W - geo.portEdgeGap, cy: H + geo.arrowEdgeGap };
  const L2 = { cx: insetRight, cy: P2.cy };
  const L1 = { cx: insetRight, cy: P1.cy };
  const L3 = { cx: midX - geo.portEdgeGap, cy: P3.cy };

  const mover = createSvgEl('g');

  const body = createSvgEl('rect', {
    x: 0,
    y: 0,
    width: W,
    height: H,
    fill: '#fff',
    stroke: '#111',
    'stroke-width': 2,
  });
  const boxLeft = createSvgEl('rect', {
    x: 0,
    y: 0,
    width: midX,
    height: H,
    fill: '#fff',
    stroke: '#111',
    'stroke-width': 1.6,
  });
  const boxRight = createSvgEl('rect', {
    x: midX,
    y: 0,
    width: midX,
    height: H,
    fill: '#fff',
    stroke: '#111',
    'stroke-width': 1.6,
  });

  // Both cells are drawn against a cell origin of x = 0 and then translated into whichever half
  // of the frame they currently occupy (see setSwapped), rather than being drawn at fixed
  // left/right coordinates - that's what lets the pair trade places at runtime.
  //
  // The flow cell passes 1 straight up to 2 and blocks 3; the exhaust cell dumps 2 across to 3
  // and blocks 1. Which one sits under the fixed ports at rest is the whole difference between
  // a normally-closed and a normally-open valve.
  function gFlowCell(): SVGGElement {
    const g = createSvgEl('g', { class: 'valveCell valveCell--flow' });
    g.appendChild(
      createSvgEl('path', {
        d: `M ${L1.cx} ${L1.cy - geo.arrowEdgeGap} L ${L2.cx} ${L2.cy + geo.arrowEdgeGap}`,
        fill: 'none',
        stroke: '#111',
        'stroke-width': 2,
        'marker-end': `url(#${arrowId})`,
      }),
    );
    g.appendChild(
      tBlock(L3.cx, H - geo.tBlockBottomGap, L3.cy - geo.tBlockStemGap, geo.tBlockBarHalfWidth),
    );
    return g;
  }

  function gExhaustCell(): SVGGElement {
    const g = createSvgEl('g', { class: 'valveCell valveCell--exhaust' });
    g.appendChild(
      createSvgEl('path', {
        d: `M ${L2.cx} ${L2.cy + geo.arrowEdgeGap} L ${L3.cx} ${L3.cy - geo.arrowEdgeGap}`,
        fill: 'none',
        stroke: '#111',
        'stroke-width': 2,
        'marker-end': `url(#${arrowId})`,
      }),
    );
    g.appendChild(
      tBlock(L1.cx, H - geo.tBlockBottomGap, L1.cy - geo.tBlockStemGap, geo.tBlockBarHalfWidth),
    );
    return g;
  }

  const flowCell = gFlowCell();
  const exhaustCell = gExhaustCell();

  mover.append(body, boxLeft, boxRight, flowCell, exhaustCell);
  svg.appendChild(mover);

  const ox = geo.offsetX;
  const oy = geo.offsetY;

  // Fixed lead-in lines from the frame's top/bottom edge to each port's exact center (not just
  // close to it), since a connected port's own circle is hidden - any gap would otherwise show
  // up as a visible blank break in the wire. These stay outside the mover (like the ports
  // themselves): the frame always spans far enough horizontally in either slid position that a
  // vertical line at each port's fixed x still lands on the frame's top/bottom edge.
  svg.appendChild(
    createSvgEl('line', {
      x1: ox + P2.cx,
      y1: oy,
      x2: ox + P2.cx,
      y2: oy + P2.cy,
      stroke: '#111',
      'stroke-width': 2,
    }),
  );
  svg.appendChild(
    createSvgEl('line', {
      x1: ox + P1.cx,
      y1: oy + H,
      x2: ox + P1.cx,
      y2: oy + P1.cy,
      stroke: '#111',
      'stroke-width': 2,
    }),
  );
  svg.appendChild(
    createSvgEl('line', {
      x1: ox + P3.cx,
      y1: oy + H,
      x2: ox + P3.cx,
      y2: oy + P3.cy,
      stroke: '#111',
      'stroke-width': 2,
    }),
  );

  const ports = {
    '2': createLabeledPort(svg, '2', ox + P2.cx, oy + P2.cy, 'V', 'left'),
    '1': createLabeledPort(svg, '1', ox + P1.cx, oy + P1.cy, 'V', 'left'),
    '3': createLabeledPort(svg, '3', ox + P3.cx, oy + P3.cy, 'V', 'left'),
  };

  // Port 3 is this valve's exhaust - fixed in place (not part of the mover), so the silencer
  // attached to it stays put and simply moves with the whole component like everything else
  // drawn directly on `svg`. Defaults on, matching how these valves are conventionally fitted
  // in practice - most exhaust ports get a silencer unless there's a specific reason not to.
  let silencer3: SilencerOption = 'silencer';
  const silencer3El = createSilencerSymbol(ox + P3.cx, oy + P3.cy, geo.silencerDir);
  setSilencerState(ports['3'], silencer3El, silencer3);
  svg.appendChild(silencer3El);

  function setActive(active: boolean): void {
    mover.setAttribute('transform', `translate(${ox + (active ? midX : 0)}, ${oy})`);
  }

  // Unswapped is the normally-closed layout the whole family started with: flow on the left,
  // exhaust on the right, so the right cell is the one under the ports while the mover is at 0.
  function setSwapped(swapped: boolean): void {
    flowCell.setAttribute('transform', `translate(${swapped ? midX : 0},0)`);
    exhaustCell.setAttribute('transform', `translate(${swapped ? 0 : midX},0)`);
  }
  setSwapped(false);

  function setSilencer(option: SilencerOption): void {
    silencer3 = option;
    setSilencerState(ports['3'], silencer3El, silencer3);
  }

  return { mover, ports, setActive, setSwapped, setSilencer, getSilencer: () => silencer3 };
}
