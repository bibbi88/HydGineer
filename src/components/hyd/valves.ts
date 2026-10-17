import type { Component, SimStepContext } from '../../core/types';
import { orificeKFromDiameter, orificeKFromRating, type HydElement } from '../../sim/hydraulics';
import { getSignal } from '../../sim/signals';
import { appState } from '../../app/AppState';
import { Modes } from '../../app/modes';
import { createPort, createPortLabel, createSvgEl } from '../shared/svgHelpers';
import { drawBallCheckSymbol } from '../shared/checkValveSymbol';
import {
  INK,
  STROKE,
  adjustArrow,
  arrowLine,
  blocked,
  createHydShell,
  fmtBar,
  fmtFlow,
  hydComponentBase,
  line,
  nameSnapshot,
  path,
  readNum,
  restoreName,
  springH,
  type HydShell,
} from './base';

export const HYD_VALVE_43_TYPE = 'hydValve43';
export const HYD_VALVE_42_TYPE = 'hydValve42';
export const HYD_CHECK_TYPE = 'hydCheck';
export const HYD_PILOT_CHECK_TYPE = 'hydPilotCheck';
export const HYD_THROTTLE_TYPE = 'hydThrottle';
export const HYD_ONE_WAY_FC_TYPE = 'hydOneWayFlowControl';
export const HYD_FLOW_CONTROL_TYPE = 'hydFlowControl';
export const HYD_REDUCING_TYPE = 'hydReducing';

/** Directional valves driven by named solenoids - also what project loading and the electrical
 * coil components use to pair coil names with valves. */
export const SOLENOID_VALVE_TYPES = new Set<string>([HYD_VALVE_43_TYPE, HYD_VALVE_42_TYPE]);
/** Snapshot fields that hold a solenoid name on those valves. */
export const SOLENOID_KEY_FIELDS = ['key', 'keyLeft', 'keyRight'] as const;

/** Pressure drop (bar) at which a directional valve's nominal flow rating is quoted, per path. */
export const VALVE_RATING_DP = 5;

/** What one position (box) of a directional valve connects. */
export type CellKind = 'parallel' | 'cross' | 'closed' | 'tandem' | 'float' | 'open';

export const CENTER_OPTIONS: Array<{ value: CellKind; label: string }> = [
  { value: 'closed', label: 'Closed centre (all ports blocked)' },
  { value: 'tandem', label: 'Tandem centre (P→T, A/B blocked)' },
  { value: 'float', label: 'Float centre (A/B→T, P blocked)' },
  { value: 'open', label: 'Open centre (all connected)' },
];

const CELL = 40;
/** x of the cell that sits over the ports. */
const PORT_CELL_X = 100;
const BODY_Y = 40;

/** Flow paths of one valve position, as orifices between the valve's own ports. */
export function cellElements(kind: CellKind, k: number): HydElement[] {
  const o = (a: string, b: string, kk = k): HydElement => ({ kind: 'orifice', a, b, k: kk });
  switch (kind) {
    case 'parallel':
      return [o('P', 'A'), o('B', 'T')];
    case 'cross':
      return [o('P', 'B'), o('A', 'T')];
    case 'closed':
      return [];
    case 'tandem':
      return [o('P', 'T')];
    case 'float':
      return [o('A', 'T'), o('B', 'T')];
    case 'open':
      // All four ports meet in the middle of the box; each leg gets √2·k so that any
      // port-to-port path through two legs has the rated k.
      return ['P', 'A', 'B', 'T'].map((p) => o(p, '_C', k * Math.SQRT2));
  }
}

function drawCell(g: SVGElement, x0: number, kind: CellKind): void {
  const y0 = BODY_Y;
  g.appendChild(
    createSvgEl('rect', {
      x: x0,
      y: y0,
      width: CELL,
      height: CELL,
      fill: '#fff',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  const xa = x0 + 10;
  const xb = x0 + 30;
  const top = y0;
  const bot = y0 + CELL;
  switch (kind) {
    case 'parallel':
      arrowLine(g, xa, bot, xa, top + 1);
      arrowLine(g, xb, top, xb, bot - 1);
      break;
    case 'cross':
      arrowLine(g, xa, bot, xb, top + 1);
      arrowLine(g, xa, top, xb, bot - 1);
      break;
    case 'closed':
      blocked(g, xa, top, 1);
      blocked(g, xb, top, 1);
      blocked(g, xa, bot, -1);
      blocked(g, xb, bot, -1);
      break;
    case 'tandem':
      blocked(g, xa, top, 1);
      blocked(g, xb, top, 1);
      path(g, `M ${xa} ${bot} V ${bot - 12} H ${xb} V ${bot}`);
      break;
    case 'float':
      blocked(g, xa, bot, -1);
      path(g, `M ${xa} ${top} V ${top + 14} H ${xb}`);
      line(g, xb, top, xb, bot);
      break;
    case 'open':
      line(g, xa, top, xa, bot);
      line(g, xb, top, xb, bot);
      line(g, xa, top + CELL / 2, xb, top + CELL / 2);
      break;
  }
}

/** ISO single-winding solenoid on the end face at `edgeX`, its name above it. */
function drawSolenoid(g: SVGElement, edgeX: number, dir: 1 | -1, name: string): void {
  const w = 22;
  const y = BODY_Y + 2;
  const h = 18;
  const far = edgeX + dir * w;
  g.appendChild(
    createSvgEl('rect', {
      x: Math.min(edgeX, far),
      y,
      width: w,
      height: h,
      fill: '#fff',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  line(g, far, y + h, edgeX, y);
  const t = createSvgEl('text', {
    x: (edgeX + far) / 2,
    y: y - 5,
    'text-anchor': 'middle',
    'font-size': 11,
  });
  t.textContent = name;
  g.appendChild(t);
}

function drawSpring(g: SVGElement, edgeX: number, dir: 1 | -1, y = BODY_Y + 31): void {
  springH(g, edgeX, edgeX + dir * 22, y, 5);
}

/** Hand lever with detent: a lever arm off the end face plus a notched detent rod. */
function drawLever(g: SVGElement, edgeX: number, dir: 1 | -1): void {
  line(g, edgeX, BODY_Y + 12, edgeX + dir * 10, BODY_Y + 12);
  line(g, edgeX + dir * 10, BODY_Y + 12, edgeX + dir * 22, BODY_Y - 2);
  g.appendChild(
    createSvgEl('circle', {
      cx: edgeX + dir * 22,
      cy: BODY_Y - 2,
      r: 3,
      fill: INK,
    }),
  );
  // Detent: a rod with notches.
  line(g, edgeX, BODY_Y + 30, edgeX + dir * 22, BODY_Y + 30, { 'stroke-width': 1.5 });
  for (const off of [7, 15]) {
    path(
      g,
      `M ${edgeX + dir * (off - 3)} ${BODY_Y + 30} L ${edgeX + dir * off} ${BODY_Y + 25} L ${edgeX + dir * (off + 3)} ${BODY_Y + 30}`,
      { 'stroke-width': 1.5 },
    );
  }
}

/** Shared port setup: A, B on top, P, T underneath the cell at PORT_CELL_X. */
function makeValvePorts(shell: HydShell): Record<string, ReturnType<typeof createPort>> {
  const g = shell.g;
  const xa = PORT_CELL_X + 10;
  const xb = PORT_CELL_X + 30;
  line(g, xa, 20, xa, BODY_Y);
  line(g, xb, 20, xb, BODY_Y);
  line(g, xa, 100, xa, BODY_Y + CELL);
  line(g, xb, 100, xb, BODY_Y + CELL);
  createPortLabel(g, xa - 8, 24, 'A', { anchor: 'end', fontSize: 10 });
  createPortLabel(g, xb + 8, 24, 'B', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, xa - 8, 102, 'P', { anchor: 'end', fontSize: 10 });
  createPortLabel(g, xb + 8, 102, 'T', { anchor: 'start', fontSize: 10 });
  return {
    A: createPort(g, 'A', xa, 20, 'V'),
    B: createPort(g, 'B', xb, 20, 'V'),
    P: createPort(g, 'P', xa, 100, 'V'),
    T: createPort(g, 'T', xb, 100, 'V'),
  };
}

function nextFreeSolenoidKeys(count: number): string[] {
  const used = new Set<string>();
  for (const c of appState.components) {
    if (!SOLENOID_VALVE_TYPES.has(c.type)) continue;
    const snap = c.snapshot() as Record<string, unknown>;
    for (const field of SOLENOID_KEY_FIELDS) {
      const v = snap[field];
      if (typeof v === 'string' && v.trim()) used.add(v.trim().toUpperCase());
    }
  }
  const names: string[] = [];
  for (let n = 1; names.length < count; n++) {
    const name = `Y${n}`;
    if (used.has(name)) continue;
    used.add(name);
    names.push(name);
  }
  return names;
}

type Actuation = 'solenoid' | 'lever';

/** One line per flow path that is carrying oil, e.g. "P→A 14.2 L/min", in the direction it
 * actually flows. */
function valveInfo(ctx: SimStepContext, elements: HydElement[]): string[] {
  const lines: string[] = [];
  if (elements.some((e) => e.kind === 'orifice' && e.b === '_C')) {
    // Open centre: report what each port exchanges with the centre.
    for (const port of ['P', 'A', 'B', 'T']) {
      const q = ctx.flowAt(port);
      if (Math.abs(q) >= 0.005)
        lines.push(`${port} ${q < 0 ? 'in' : 'out'} ${fmtFlow(Math.abs(q))}`);
    }
    return lines;
  }
  elements.forEach((e, i) => {
    if (e.kind !== 'orifice') return;
    const q = ctx.elementValue(i);
    if (Math.abs(q) < 0.005) return;
    lines.push(`${q >= 0 ? `${e.a}→${e.b}` : `${e.b}→${e.a}`} ${fmtFlow(Math.abs(q))}`);
  });
  return lines;
}

/**
 * 4/3 directional valve, spring-centred with a solenoid at each end ("Y1" shifts it to the left
 * box: P→A, B→T; "Y2" to the right box: P→B, A→T) or hand-lever operated with detents (click
 * the left/right half of the symbol while simulating). The centre position is selectable.
 * Each flow path is an orifice rated `qNom` L/min at 5 bar.
 */
export function createHydValve43(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 240;
  const svgH = 120;
  const shell = createHydShell(compLayer, HYD_VALVE_43_TYPE, x, y, svgW, svgH, '4/3 valve', {
    x: 60,
    y: 38,
    w: 120,
    h: 44,
  });
  const slide = createSvgEl('g', { class: 'hydSpool' });
  shell.g.appendChild(slide);
  const ports = makeValvePorts(shell);
  shell.setInfoSide('right');

  const [k1, k2] = nextFreeSolenoidKeys(2);
  let keyLeft = k1 ?? 'Y1';
  let keyRight = k2 ?? 'Y2';
  let center: CellKind = 'closed';
  let actuation: Actuation = 'solenoid';
  let qNom = 30;
  /** -1 = left box (P→A), 0 = centre, 1 = right box (P→B). */
  let state: -1 | 0 | 1 = 0;
  let lastElements: HydElement[] = [];

  function draw(): void {
    slide.replaceChildren();
    drawCell(slide, 60, 'parallel');
    drawCell(slide, 100, center);
    drawCell(slide, 140, 'cross');
    if (actuation === 'solenoid') {
      drawSolenoid(slide, 60, -1, keyLeft);
      drawSolenoid(slide, 180, 1, keyRight);
      drawSpring(slide, 60, -1);
      drawSpring(slide, 180, 1);
    } else {
      drawLever(slide, 60, -1);
    }
    applyState();
  }
  function applyState(): void {
    slide.setAttribute('transform', `translate(${-state * CELL},0)`);
  }
  draw();

  shell.svg.addEventListener('mousedown', (e) => {
    if (actuation !== 'lever' || appState.mode === Modes.STOP) return;
    e.stopPropagation();
    const rect = shell.svg.getBoundingClientRect();
    const left = e.clientX - rect.left < rect.width / 2;
    const target = left ? -1 : 1;
    state = state === target ? 0 : target;
    applyState();
  });

  const comp = hydComponentBase(shell, HYD_VALVE_43_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    recompute(): void {
      if (actuation !== 'solenoid') return;
      const l = keyLeft.trim() !== '' && getSignal(keyLeft);
      const r = keyRight.trim() !== '' && getSignal(keyRight);
      const next: -1 | 0 | 1 = l && !r ? -1 : r && !l ? 1 : 0;
      if (next !== state) {
        state = next;
        applyState();
      }
    },
    hydElements(): HydElement[] {
      const k = orificeKFromRating(qNom, VALVE_RATING_DP);
      lastElements = cellElements(state === -1 ? 'parallel' : state === 1 ? 'cross' : center, k);
      return lastElements;
    },
    step(_dt: number, ctx: SimStepContext): void {
      shell.setInfo(valveInfo(ctx, lastElements));
    },
    snapshot: () => ({ ...nameSnapshot(shell), keyLeft, keyRight, center, actuation, qNom }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      if (typeof data.keyLeft === 'string') keyLeft = data.keyLeft;
      if (typeof data.keyRight === 'string') keyRight = data.keyRight;
      if (CENTER_OPTIONS.some((o) => o.value === data.center)) center = data.center as CellKind;
      if (data.actuation === 'solenoid' || data.actuation === 'lever') actuation = data.actuation;
      qNom = readNum(data, 'qNom', qNom, 0.1, 2000);
      draw();
    },
    reset(): void {
      state = 0;
      applyState();
      shell.setInfo([]);
    },
  });
}

/**
 * 4/2 directional valve: single solenoid with spring return (at rest P→B, A→T; energized P→A,
 * B→T) or hand lever with detent (click to toggle while simulating).
 */
export function createHydValve42(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 240;
  const svgH = 120;
  const shell = createHydShell(compLayer, HYD_VALVE_42_TYPE, x, y, svgW, svgH, '4/2 valve', {
    x: 60,
    y: 38,
    w: 80,
    h: 44,
  });
  const slide = createSvgEl('g', { class: 'hydSpool' });
  shell.g.appendChild(slide);
  const ports = makeValvePorts(shell);
  shell.setInfoSide('right');

  let key = nextFreeSolenoidKeys(1)[0] ?? 'Y1';
  let actuation: Actuation = 'solenoid';
  let qNom = 30;
  /** true = left box (P→A, B→T) over the ports. */
  let shifted = false;
  let lastElements: HydElement[] = [];

  function draw(): void {
    slide.replaceChildren();
    // Boxes sit at 100 (left, shifted) and 140 (right, rest); at rest the whole slide is moved
    // left one box so the rest box is over the ports.
    drawCell(slide, 100, 'parallel');
    drawCell(slide, 140, 'cross');
    if (actuation === 'solenoid') {
      drawSolenoid(slide, 100, -1, key);
      drawSpring(slide, 180, 1, BODY_Y + 20);
    } else {
      drawLever(slide, 100, -1);
    }
    applyState();
  }
  function applyState(): void {
    slide.setAttribute('transform', `translate(${shifted ? 0 : -CELL},0)`);
  }
  draw();

  shell.svg.addEventListener('mousedown', (e) => {
    if (actuation !== 'lever' || appState.mode === Modes.STOP) return;
    e.stopPropagation();
    shifted = !shifted;
    applyState();
  });

  const comp = hydComponentBase(shell, HYD_VALVE_42_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    recompute(): void {
      if (actuation !== 'solenoid') return;
      const next = key.trim() !== '' && getSignal(key);
      if (next !== shifted) {
        shifted = next;
        applyState();
      }
    },
    hydElements(): HydElement[] {
      const k = orificeKFromRating(qNom, VALVE_RATING_DP);
      lastElements = cellElements(shifted ? 'parallel' : 'cross', k);
      return lastElements;
    },
    step(_dt: number, ctx: SimStepContext): void {
      shell.setInfo(valveInfo(ctx, lastElements));
    },
    snapshot: () => ({ ...nameSnapshot(shell), key, actuation, qNom }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      if (typeof data.key === 'string') key = data.key;
      if (data.actuation === 'solenoid' || data.actuation === 'lever') actuation = data.actuation;
      qNom = readNum(data, 'qNom', qNom, 0.1, 2000);
      draw();
    },
    reset(): void {
      shifted = false;
      applyState();
      shell.setInfo([]);
    },
  });
}

/** Two-port inline valve layout: IN at the bottom, OUT at the top, 60 px apart. */
function inlinePorts(g: SVGElement, cx: number): Record<string, ReturnType<typeof createPort>> {
  return {
    IN: createPort(g, 'IN', cx, 70, 'V'),
    OUT: createPort(g, 'OUT', cx, 10, 'V'),
  };
}

function throughInfo(ctx: SimStepContext, q: number): string[] {
  if (Math.abs(q) < 0.005) return [];
  return [`Q ${fmtFlow(q)}`, `Δp ${fmtBar(ctx.pressureAt('IN') - ctx.pressureAt('OUT'))}`];
}

/** Spring-loaded check valve: free flow IN → OUT once the cracking pressure is exceeded. */
export function createHydCheck(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 40;
  const svgH = 80;
  const shell = createHydShell(compLayer, HYD_CHECK_TYPE, x, y, svgW, svgH, 'Check valve', {
    x: 6,
    y: 24,
    w: 28,
    h: 32,
  });
  const g = shell.g;
  const glyph = drawBallCheckSymbol(g, 20, 40, 'vertical', 1, 0.8);
  line(g, 20, 10, glyph.outPoint.x, glyph.outPoint.y, { 'stroke-width': 2.4 });
  line(g, 20, glyph.inPoint.y, 20, 70, { 'stroke-width': 2.4 });
  const ports = inlinePorts(g, 20);
  shell.setInfoSide('right');
  let crack = 0.5;
  const comp = hydComponentBase(shell, HYD_CHECK_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      { kind: 'check', a: 'IN', b: 'OUT', crack, k: orificeKFromRating(40, 2) },
    ],
    step(_dt: number, ctx: SimStepContext): void {
      shell.setInfo(throughInfo(ctx, ctx.elementValue(0)));
    },
    snapshot: () => ({ ...nameSnapshot(shell), crack }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      crack = readNum(data, 'crack', crack, 0, 50);
    },
    reset: () => shell.setInfo([]),
  });
}

/**
 * Pilot-operated check valve (load-holding valve): free flow A → B; B → A only while the pilot
 * pressure at X, times the pilot ratio, exceeds the load pressure at B.
 */
export function createHydPilotCheck(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 80;
  const svgH = 80;
  const shell = createHydShell(
    compLayer,
    HYD_PILOT_CHECK_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Pilot-operated check valve',
    { x: 10, y: 20, w: 50, h: 40 },
  );
  const g = shell.g;
  const glyph = drawBallCheckSymbol(g, 40, 40, 'vertical', 1, 0.8);
  line(g, 40, 10, glyph.outPoint.x, glyph.outPoint.y, { 'stroke-width': 2.4 });
  line(g, 40, glyph.inPoint.y, 40, 70, { 'stroke-width': 2.4 });
  path(g, 'M 10 50 H 22 V 38 H 32', { 'stroke-dasharray': '4 3', 'stroke-width': 1.5 });
  createPortLabel(g, 47, 72, 'A', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, 47, 16, 'B', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, 8, 62, 'X', { anchor: 'middle', fontSize: 10 });
  const ports = {
    A: createPort(g, 'A', 40, 70, 'V'),
    B: createPort(g, 'B', 40, 10, 'V'),
    X: createPort(g, 'X', 10, 50, 'H', { isPilot: true, pilotDir: -1 }),
  };
  shell.setInfoSide('right');
  let ratio = 4;
  const comp = hydComponentBase(shell, HYD_PILOT_CHECK_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      {
        kind: 'pilotCheck',
        a: 'A',
        b: 'B',
        x: 'X',
        crack: 0.5,
        ratio,
        k: orificeKFromRating(40, 2),
      },
    ],
    step(_dt: number, ctx: SimStepContext): void {
      const q = ctx.elementValue(0);
      shell.setInfo(Math.abs(q) >= 0.005 ? [`Q ${fmtFlow(q)}`] : []);
    },
    snapshot: () => ({ ...nameSnapshot(shell), ratio }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      ratio = readNum(data, 'ratio', ratio, 1, 20);
    },
    reset: () => shell.setInfo([]),
  });
}

function drawThrottle(g: SVGElement, cx: number, cy: number): void {
  path(g, `M ${cx - 9} ${cy - 13} Q ${cx - 1} ${cy} ${cx - 9} ${cy + 13}`);
  path(g, `M ${cx + 9} ${cy - 13} Q ${cx + 1} ${cy} ${cx + 9} ${cy + 13}`);
}

/** Adjustable throttle (needle valve): a sharp-edged orifice of the set diameter, both ways. */
export function createHydThrottle(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 40;
  const svgH = 80;
  const shell = createHydShell(compLayer, HYD_THROTTLE_TYPE, x, y, svgW, svgH, 'Throttle valve', {
    x: 4,
    y: 22,
    w: 32,
    h: 36,
  });
  const g = shell.g;
  line(g, 20, 10, 20, 70);
  drawThrottle(g, 20, 40);
  adjustArrow(g, 20, 40, 14);
  const ports = inlinePorts(g, 20);
  shell.setInfoSide('right');
  const dText = createSvgEl('text', { x: 34, y: 44, 'font-size': 10 });
  g.appendChild(dText);
  let diameter = 2;
  function refresh(): void {
    dText.textContent = `⌀${diameter}`;
  }
  refresh();
  const comp = hydComponentBase(shell, HYD_THROTTLE_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      { kind: 'orifice', a: 'IN', b: 'OUT', k: orificeKFromDiameter(diameter) },
    ],
    step(_dt: number, ctx: SimStepContext): void {
      shell.setInfo(throughInfo(ctx, ctx.elementValue(0)));
    },
    snapshot: () => ({ ...nameSnapshot(shell), diameter }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      diameter = readNum(data, 'diameter', diameter, 0, 50);
      refresh();
    },
    reset: () => shell.setInfo([]),
  });
}

/** One-way flow control: throttled IN (top) → OUT (bottom), free flow OUT → IN through the
 * bypass check. */
export function createHydOneWayFlowControl(
  compLayer: HTMLElement,
  x: number,
  y: number,
): Component {
  const svgW = 80;
  const svgH = 80;
  const shell = createHydShell(
    compLayer,
    HYD_ONE_WAY_FC_TYPE,
    x,
    y,
    svgW,
    svgH,
    'One-way flow control',
    { x: 4, y: 14, w: 66, h: 52 },
  );
  const g = shell.g;
  line(g, 20, 10, 20, 70);
  drawThrottle(g, 20, 40);
  adjustArrow(g, 20, 40, 14);
  path(g, 'M 20 18 H 52 V 26');
  path(g, 'M 20 62 H 52 V 54');
  // Free flow upwards (OUT → IN) through the check.
  const glyph = drawBallCheckSymbol(g, 52, 40, 'vertical', 1, 0.6);
  line(g, 52, 26, 52, Math.min(glyph.inPoint.y, glyph.outPoint.y) + 0);
  line(g, 52, 54, 52, Math.max(glyph.inPoint.y, glyph.outPoint.y));
  // IN on top, OUT underneath: throttled flow runs downwards, which is meter-out for a
  // cylinder drawn above its valve.
  const ports = {
    IN: createPort(g, 'IN', 20, 10, 'V'),
    OUT: createPort(g, 'OUT', 20, 70, 'V'),
  };
  shell.setInfoSide('right');
  const dText = createSvgEl('text', { x: 62, y: 78, 'font-size': 10 });
  g.appendChild(dText);
  let diameter = 2;
  function refresh(): void {
    dText.textContent = `⌀${diameter}`;
  }
  refresh();
  const comp = hydComponentBase(shell, HYD_ONE_WAY_FC_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      { kind: 'orifice', a: 'IN', b: 'OUT', k: orificeKFromDiameter(diameter) },
      { kind: 'check', a: 'OUT', b: 'IN', crack: 0.5, k: orificeKFromRating(40, 2) },
    ],
    step(_dt: number, ctx: SimStepContext): void {
      shell.setInfo(throughInfo(ctx, ctx.elementValue(0) - ctx.elementValue(1)));
    },
    snapshot: () => ({ ...nameSnapshot(shell), diameter }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      diameter = readNum(data, 'diameter', diameter, 0, 50);
      refresh();
    },
    reset: () => shell.setInfo([]),
  });
}

/**
 * Pressure-compensated 2-way flow control valve: holds the set flow IN → OUT regardless of load
 * pressure, as long as at least a few bar are available across it. Optional bypass check for
 * free reverse flow.
 */
export function createHydFlowControl(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 80;
  const svgH = 80;
  const shell = createHydShell(
    compLayer,
    HYD_FLOW_CONTROL_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Flow control valve (pressure compensated)',
    { x: 14, y: 16, w: 62, h: 48 },
  );
  const g = shell.g;
  g.appendChild(
    createSvgEl('rect', {
      x: 18,
      y: 20,
      width: 44,
      height: 40,
      fill: '#fff',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  line(g, 40, 10, 40, 70);
  drawThrottle(g, 40, 40);
  adjustArrow(g, 40, 40, 12);
  // Compensator: a short arrow beside the throttle.
  arrowLine(g, 26, 52, 26, 30);
  const bypassG = createSvgEl('g');
  g.appendChild(bypassG);
  const ports = inlinePorts(g, 40);
  shell.setInfoSide('right');
  const qText = createSvgEl('text', { x: 64, y: 16, 'font-size': 10 });
  g.appendChild(qText);
  let qSet = 5;
  let bypass = false;
  function refresh(): void {
    qText.textContent = `${qSet} L/min`;
    bypassG.replaceChildren();
    if (bypass) {
      path(bypassG, 'M 40 14 H 72 V 26');
      path(bypassG, 'M 40 66 H 72 V 54');
      const glyph = drawBallCheckSymbol(bypassG, 72, 40, 'vertical', -1, 0.6);
      line(bypassG, 72, 26, 72, Math.min(glyph.inPoint.y, glyph.outPoint.y));
      line(bypassG, 72, 54, 72, Math.max(glyph.inPoint.y, glyph.outPoint.y));
    }
  }
  refresh();
  const comp = hydComponentBase(shell, HYD_FLOW_CONTROL_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements(): HydElement[] {
      const els: HydElement[] = [{ kind: 'flowControl', a: 'IN', b: 'OUT', q: qSet, dpMin: 3 }];
      if (bypass) {
        els.push({ kind: 'check', a: 'OUT', b: 'IN', crack: 0.5, k: orificeKFromRating(40, 2) });
      }
      return els;
    },
    step(_dt: number, ctx: SimStepContext): void {
      const q = ctx.elementValue(0) - (bypass ? ctx.elementValue(1) : 0);
      shell.setInfo(throughInfo(ctx, q));
    },
    snapshot: () => ({ ...nameSnapshot(shell), qSet, bypass }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      qSet = readNum(data, 'qSet', qSet, 0, 2000);
      if ('bypass' in data) bypass = Boolean(data.bypass);
      refresh();
    },
    reset: () => shell.setInfo([]),
  });
}

/**
 * Direct-operated pressure-reducing valve, P → A: open while the outlet pressure is below the
 * setting, throttling down to hold it there as it is reached.
 */
export function createHydReducing(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 80;
  const svgH = 100;
  const shell = createHydShell(
    compLayer,
    HYD_REDUCING_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Pressure reducing valve',
    { x: 10, y: 26, w: 66, h: 48 },
  );
  const g = shell.g;
  g.appendChild(
    createSvgEl('rect', {
      x: 25,
      y: 30,
      width: 30,
      height: 40,
      fill: '#fff',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  line(g, 40, 90, 40, 70);
  line(g, 40, 10, 40, 30);
  const arrowG = createSvgEl('g', { class: 'hydSpool' });
  g.appendChild(arrowG);
  arrowLine(arrowG, 40, 66, 40, 34);
  springH(g, 55, 75, 50);
  adjustArrow(g, 65, 50, 10);
  path(g, 'M 40 20 H 14 V 60 H 25', { 'stroke-dasharray': '4 3', 'stroke-width': 1.5 });
  createPortLabel(g, 47, 96, 'P', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, 47, 14, 'A', { anchor: 'start', fontSize: 10 });
  const setText = createSvgEl('text', { x: 58, y: 86, 'font-size': 10 });
  g.appendChild(setText);
  const ports = {
    P: createPort(g, 'P', 40, 90, 'V'),
    A: createPort(g, 'A', 40, 10, 'V'),
  };
  shell.setInfoSide('right');
  let setting = 50;
  function refresh(): void {
    setText.textContent = `${setting} bar`;
  }
  refresh();
  const comp = hydComponentBase(shell, HYD_REDUCING_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      {
        kind: 'reducing',
        a: 'P',
        b: 'A',
        set: setting,
        k: orificeKFromRating(30, VALVE_RATING_DP),
        band: 2,
      },
    ],
    step(_dt: number, ctx: SimStepContext): void {
      const pA = ctx.pressureAt('A');
      const regulating = pA > setting - 2 && ctx.pressureAt('P') > pA + 0.5;
      arrowG.setAttribute('transform', regulating ? 'translate(7,0)' : '');
      const q = ctx.elementValue(0);
      shell.setInfo([`out ${fmtBar(pA)}`, ...(Math.abs(q) >= 0.005 ? [`Q ${fmtFlow(q)}`] : [])]);
    },
    snapshot: () => ({ ...nameSnapshot(shell), setting }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      setting = readNum(data, 'setting', setting, 0, 700);
      refresh();
    },
    reset(): void {
      arrowG.setAttribute('transform', '');
      shell.setInfo([]);
    },
  });
}
