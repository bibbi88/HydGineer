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
import { addSpringZigzag } from './shared/spring';

export const VALVE_53_MONO_TYPE = 'valve53Mono';

// Three cells (left/center/right): closed center (every port dead-ends, drawn as a short stub
// with a small perpendicular cap rather than connecting to anything), single-headed flow arrows
// in the two side cells (each also dead-ending its own unused third port the same way the center
// cell does) - both matching a user-supplied reference symbol - and, on *each* end face, a
// return spring stacked above a pneumatic pilot (triangle + port). "Monostable" here means the same thing it does for the
// 5/2 family: exactly one stable rest position (center) - releasing either pilot always returns
// it there, never to the other pilot's position.
export interface Valve53MonoGeometry {
  w0: number;
  h0: number;
  gx0: number;
  gy0: number;
  extraW: number;
  extraH: number;
  stroke: number;
  font: number;
  cellArrowInset: number;
  fixedPortInset: number;
  fixedPortLead: number;
  tightLabelDx: number;
  tightLabelDy: number;
  /** Dead-end stub: how far it reaches in from the cell wall, and the half-width of its cap. */
  deadEndLen: number;
  deadEndCapHalf: number;
  /** Actuator (per side): how far above/below the body centerline the spring and the pilot sit
   * on the end face, the spring's own span, the triangle's height/width ratios, and the lead
   * from the triangle's back to the port itself. The spring and the pilot both act on the same
   * end of the spool, so per ISO 1219-1 they are stacked on that one end face (spring above,
   * pilot below) and each butts straight against the body - they are not chained in series
   * along the spool axis, which would read as one pushing through the other. */
  actuatorSplitY: number;
  springSpan: number;
  springSegLen: number;
  springZigW: number;
  springZigH: number;
  triHRatio: number;
  triWRatio: number;
  portLead: number;
}

export const VALVE_53_MONO_DEFAULT_GEOMETRY: Valve53MonoGeometry = {
  w0: 80,
  h0: 60,
  gx0: 115,
  gy0: 24,
  extraW: 190,
  extraH: 48,
  stroke: 2,
  font: 10,
  cellArrowInset: 10,
  fixedPortInset: 10,
  fixedPortLead: 10,
  tightLabelDx: -8,
  tightLabelDy: 4,
  deadEndLen: 10,
  deadEndCapHalf: 8,
  // A multiple of GRID_SIZE (10), like every other offset here: it becomes the pilot port's own
  // y-offset from the canvas center once drawn, so it has to land on the grid too - see
  // src/core/grid.ts. 10 also splits the 60-tall end face into even thirds.
  actuatorSplitY: 10,
  springSpan: 24,
  springSegLen: 4,
  springZigW: 5,
  springZigH: 5,
  triHRatio: 0.25,
  triWRatio: 1.2,
  // Leaves a visible link line between the triangle's back face and the pilot port, the way the
  // 5/2 family draws its own pilot (valve52Mono.ts) rather than parking the port straight on the
  // triangle. 22 puts the port 40 out from the body edge - the triangle is 18 wide (triH 15 x
  // triWRatio 1.2) - which is both the 5/2's own pilot port distance and a multiple of
  // GRID_SIZE (10), so the port still lands on the grid; see src/core/grid.ts.
  portLead: 22,
};

function line(x1: number, y1: number, x2: number, y2: number, stroke: number): SVGLineElement {
  return createSvgEl('line', { x1, y1, x2, y2, stroke: '#111', 'stroke-width': stroke });
}

/** A single-headed flow arrow, from (x1,y1) to (x2,y2) with the arrowhead at the end - unlike
 * the 5/2 family's own bidirectional double-arrow, matching the reference symbol's convention of
 * showing which specific port each side cell feeds in that position. */
function addArrow(
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
      'marker-end': `url(#${arrowId})`,
    }),
  );
}

/** A dead-end port stub inside a cell: a short line in from the cell wall, capped with a small
 * perpendicular tick - the closed-center convention for "this port isn't connected to anything
 * while this cell is showing", used both by the center cell (all five ports) and by each side
 * cell (its own one unused port - see the state comments in drawValve53MonoBody). */
function addDeadEndStub(
  parent: SVGElement,
  x: number,
  fromTop: boolean,
  geo: Valve53MonoGeometry,
): void {
  const wallY = fromTop ? 0 : geo.h0;
  const capY = fromTop ? geo.deadEndLen : geo.h0 - geo.deadEndLen;
  parent.appendChild(line(x, wallY, x, capY, geo.stroke));
  parent.appendChild(line(x - geo.deadEndCapHalf, capY, x + geo.deadEndCapHalf, capY, geo.stroke));
}

/** Stem + spring + pilot triangle + port, hanging off `bodyEdgeX` on `side`, drawn fresh into
 * `group` (cleared first). Both act on the same end of the spool, so ISO 1219-1 stacks them on
 * that one end face rather than chaining them in series along the axis: the return spring runs
 * out `geo.actuatorSplitY` above the centerline `cy` and the pilot (triangle, apex against the
 * wall in the direction it pushes, then its port) the same distance below, each starting hard
 * against `bodyEdgeX` with no connecting stem. Returns the port (already parented into `group`
 * directly, unlike valve52.ts's own pilot ports, which have to be created against `svg` and
 * reparented after - here `group` already *is* the pilot's final position, so there's nothing
 * to move). */
function drawPilotActuator(
  group: SVGElement,
  side: 'left' | 'right',
  bodyEdgeX: number,
  cy: number,
  geo: Valve53MonoGeometry,
  key: '12' | '14',
): PortDef {
  while (group.firstChild) group.removeChild(group.firstChild);
  const dir = side === 'left' ? -1 : 1;
  const springY = cy - geo.actuatorSplitY;
  const pilotY = cy + geo.actuatorSplitY;
  const triH = geo.h0 * geo.triHRatio;
  const triW = triH * geo.triWRatio;
  const triTipX = bodyEdgeX;
  const triBaseX = triTipX + dir * triW;
  const portX = triBaseX + dir * geo.portLead;

  addSpringZigzag(group, bodyEdgeX, bodyEdgeX + dir * geo.springSpan, springY, geo.stroke, geo);

  const points = [
    [triTipX, pilotY],
    [triBaseX, pilotY - triH / 2],
    [triBaseX, pilotY + triH / 2],
  ];
  group.appendChild(
    createSvgEl('polygon', {
      points: points.map((p) => p.join(',')).join(' '),
      fill: 'none',
      stroke: '#111',
      'stroke-width': geo.stroke,
    }),
  );
  group.appendChild(line(triBaseX, pilotY, portX, pilotY, geo.stroke));

  const port = createPort(group, key, portX, pilotY, 'H', {
    isPilot: true,
    pilotDir: dir as 1 | -1,
  });
  port.el.setAttribute('r', '6');
  // Below the port, not above it like the 5/2 family's own pilot label: above would put the
  // text straight through the spring now sharing this end face.
  const label = createSvgEl('text', {
    x: portX,
    y: pilotY + 18,
    'text-anchor': 'middle',
    'font-size': geo.font,
  });
  label.textContent = key;
  group.appendChild(label);

  return port;
}

export interface Valve53MonoBody {
  gInner: SVGGElement;
  cellW: number;
  fixedPorts: { '4': PortDef; '2': PortDef; '5': PortDef; '1': PortDef; '3': PortDef };
  leftGroup: SVGGElement;
  rightGroup: SVGGElement;
  silencer3El: SVGGElement;
  silencer5El: SVGGElement;
}

/** Draws the full three-cell sliding 5/3 body: the two actuated cells' single-headed flow arrows
 * (each also dead-ending its own unused port), the blank closed-center cell, and the fixed
 * 1/2/3/4/5 ports and their silencers. `leftGroup`/`rightGroup` (returned) are where the caller
 * draws whatever actuator belongs on each end - `gInner` carries the housing's static offset
 * plus whatever slide shift the caller applies via its own transform. */
export function drawValve53MonoBody(
  svg: SVGSVGElement,
  geo: Valve53MonoGeometry,
  arrowId: string,
): Valve53MonoBody {
  const W0 = geo.w0;
  const H0 = geo.h0;
  const LEFT_X = geo.fixedPortInset;
  const RIGHT_X = W0 - geo.fixedPortInset;
  const MID_X = W0 / 2;

  addDoubleArrowMarker(svg, arrowId);

  const gInner = createSvgEl('g');
  const gSlide = createSvgEl('g');

  function cellRect(x: number): SVGRectElement {
    return createSvgEl('rect', {
      x,
      y: 0,
      width: W0,
      height: H0,
      fill: '#fff',
      stroke: '#111',
      'stroke-width': geo.stroke,
    }) as SVGRectElement;
  }

  // Left cell (shown when the left solenoid is energized): 1->4 (diagonal, arrow into 4) and
  // 2->3 (vertical, arrow into 3) - port 5's position is unused here, so it dead-ends.
  const cellL = createSvgEl('g');
  cellL.appendChild(cellRect(0));
  addArrow(cellL, MID_X, H0, LEFT_X, 0, geo.stroke, arrowId);
  addArrow(cellL, RIGHT_X, 0, RIGHT_X, H0, geo.stroke, arrowId);
  addDeadEndStub(cellL, LEFT_X, false, geo);

  // Center cell - closed center: every port dead-ends, nothing connects to anything else.
  const cellC = createSvgEl('g', { transform: `translate(${W0},0)` });
  cellC.appendChild(cellRect(0));
  addDeadEndStub(cellC, LEFT_X, true, geo);
  addDeadEndStub(cellC, RIGHT_X, true, geo);
  addDeadEndStub(cellC, LEFT_X, false, geo);
  addDeadEndStub(cellC, MID_X, false, geo);
  addDeadEndStub(cellC, RIGHT_X, false, geo);

  // Right cell (shown when the right solenoid is energized): 4->5 (vertical, arrow into 5) and
  // 1->2 (diagonal, arrow into 2) - port 3's position is unused here, so it dead-ends.
  const cellR = createSvgEl('g', { transform: `translate(${W0 * 2},0)` });
  cellR.appendChild(cellRect(0));
  addArrow(cellR, LEFT_X, 0, LEFT_X, H0, geo.stroke, arrowId);
  addArrow(cellR, MID_X, H0, RIGHT_X, 0, geo.stroke, arrowId);
  addDeadEndStub(cellR, RIGHT_X, false, geo);

  gSlide.append(cellL, cellC, cellR);

  const leftGroup = createSvgEl('g');
  const rightGroup = createSvgEl('g');
  gInner.append(gSlide, leftGroup, rightGroup);
  svg.appendChild(gInner);

  // ===== Fixed ports (do not slide) - the window they sit over is always exactly one cell
  // wide, centered on the same column positions every cell uses internally. =====
  const fixedPortsLocal = {
    '4': { cx: LEFT_X, cy: -geo.fixedPortLead },
    '2': { cx: RIGHT_X, cy: -geo.fixedPortLead },
    '5': { cx: LEFT_X, cy: H0 + geo.fixedPortLead },
    '1': { cx: MID_X, cy: H0 + geo.fixedPortLead },
    '3': { cx: RIGHT_X, cy: H0 + geo.fixedPortLead },
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

  const fixedPorts: Valve53MonoBody['fixedPorts'] = {
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

  return { gInner, cellW: W0, fixedPorts, leftGroup, rightGroup, silencer3El, silencer5El };
}

type Valve53State = 'L' | 'C' | 'R';

export function createValve53Mono(compLayer: HTMLElement, x: number, y: number): Component {
  const geo = VALVE_53_MONO_DEFAULT_GEOMETRY;
  const svgW = geo.w0 * 3 + geo.extraW;
  const svgH = geo.h0 + geo.extraH;

  // The three-cell sliding assembly is always fully drawn (no clipping window) and defaults (and
  // resets) to the center position, spring-centered - same reasoning as valve52.ts's own
  // getBounds() doc for why the tight box matches that one state's footprint rather than every
  // state's combined extent. In that rest state gInner sits one cell left of gx0, so the body
  // starts at gx0 - w0 and runs the full three cells from there; w0 * 2 would be the two-cell
  // 5/2's width and would leave this valve's right-hand cell outside its own bounds.
  const shell = buildComponentShell(
    compLayer,
    VALVE_53_MONO_TYPE,
    x,
    y,
    svgW,
    svgH,
    '5/3 valve, monostable',
    {
      x: geo.gx0 - geo.w0,
      y: geo.gy0,
      w: geo.w0 * 3,
      h: geo.h0,
    },
  );
  const svg = shell.svg;
  svg.style.overflow = 'visible';

  const arrowId = `arrow-v53m-${uid()}`;
  const { gInner, cellW, fixedPorts, leftGroup, rightGroup, silencer3El, silencer5El } =
    drawValve53MonoBody(svg, geo, arrowId);

  let silencer3: SilencerOption = 'silencer';
  let silencer5: SilencerOption = 'silencer';
  let state: Valve53State = 'C';

  function setShift(shift: number): void {
    gInner.setAttribute('transform', `translate(${geo.gx0 + shift},${geo.gy0})`);
  }
  function applyState(): void {
    setShift(state === 'L' ? 0 : state === 'C' ? -cellW : -cellW * 2);
  }
  const port14 = drawPilotActuator(leftGroup, 'left', 0, geo.h0 / 2, geo, '14');
  const port12 = drawPilotActuator(rightGroup, 'right', geo.w0 * 3, geo.h0 / 2, geo, '12');
  applyState();

  const comp: Component = {
    id: uid(),
    type: VALVE_53_MONO_TYPE,
    el: shell.el,
    x,
    y,
    svgW,
    svgH,
    gx: 0,
    gy: 0,
    ports: { ...fixedPorts, '12': port12, '14': port14 },

    // Must match the drawn artwork exactly (see drawValve53MonoBody's own cell comments), or the
    // diagram shows one routing while simulating another.
    conductivityRule(): PortConnection[] {
      if (state === 'L') {
        return [
          { a: '1', b: '4' },
          { a: '2', b: '3' },
        ];
      }
      if (state === 'R') {
        return [
          { a: '1', b: '2' },
          { a: '4', b: '5' },
        ];
      }
      return [];
    },

    // Spring-centered: with a spring pulling back on *each* end, the valve simply follows
    // whichever single pilot currently has pressure - both at once (or neither) is exactly the
    // balanced condition the two springs center it for, so it holds center either way. No
    // edge-detection or latching needed (unlike the bistable 5/2's onPressureChange), matching
    // valve52Mono.ts's own single-pilot reasoning, just with a second pilot on the other side.
    onPressureChange(ctx: ConductivityContext): void {
      const pilot12 = ctx.isPressurized('12');
      const pilot14 = ctx.isPressurized('14');
      state = pilot14 && !pilot12 ? 'L' : pilot12 && !pilot14 ? 'R' : 'C';
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
      state = (data.state as Valve53State) ?? 'C';
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      silencer3 = (data.silencer3 as SilencerOption) ?? 'silencer';
      silencer5 = (data.silencer5 as SilencerOption) ?? 'silencer';
      setSilencerState(fixedPorts['3'], silencer3El, silencer3);
      setSilencerState(fixedPorts['5'], silencer5El, silencer5);
      applyState();
    },
    reset(): void {
      state = 'C';
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
