import type { Component, SimStepContext } from '../../core/types';
import { orificeKFromDiameter, orificeKFromRating, type HydElement } from '../../sim/hydraulics';
import { getSignal } from '../../sim/signals';
import { appState } from '../../app/AppState';
import { Modes } from '../../app/modes';
import { createPort, createPortLabel, createSvgEl } from '../shared/svgHelpers';
import { drawBallCheckSymbol } from '../shared/checkValveSymbol';
import { clearFlow, paintFlow, paintPaths } from './flowPaint';
import { FLOW_THRESHOLD } from '../../sim/pressureScale';
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
export const HYD_COUNTERBALANCE_TYPE = 'hydCounterbalance';
export const HYD_VALVE_LS_TYPE = 'hydValveLS';
export const HYD_SHUTTLE_TYPE = 'hydShuttle';
export const HYD_PRESSURE_COMP_TYPE = 'hydPressureCompensator';

/** Directional valves driven by named solenoids - also what project loading and the electrical
 * coil components use to pair coil names with valves. */
export const SOLENOID_VALVE_TYPES = new Set<string>([
  HYD_VALVE_43_TYPE,
  HYD_VALVE_42_TYPE,
  HYD_VALVE_LS_TYPE,
]);
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

/** The drawn lines of one valve box, keyed by the flow path they show ("P>A" = from P to A,
 * matching cellElements' orifices), each drawn in that path's own direction. */
type CellPaths = Record<string, SVGElement[]>;

function drawCell(g: SVGElement, x0: number, kind: CellKind): CellPaths {
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
      return {
        'P>A': arrowLine(g, xa, bot, xa, top + 1),
        'B>T': arrowLine(g, xb, top, xb, bot - 1),
      };
    case 'cross':
      return {
        'P>B': arrowLine(g, xa, bot, xb, top + 1),
        'A>T': arrowLine(g, xa, top, xb, bot - 1),
      };
    case 'closed':
      blocked(g, xa, top, 1);
      blocked(g, xb, top, 1);
      blocked(g, xa, bot, -1);
      blocked(g, xb, bot, -1);
      return {};
    case 'tandem':
      blocked(g, xa, top, 1);
      blocked(g, xb, top, 1);
      return { 'P>T': [path(g, `M ${xa} ${bot} V ${bot - 12} H ${xb} V ${bot}`)] };
    case 'float': {
      blocked(g, xa, bot, -1);
      const fromA = path(g, `M ${xa} ${top} V ${top + 14} H ${xb}`);
      const fromB = line(g, xb, top, xb, top + 14);
      const toT = line(g, xb, top + 14, xb, bot);
      return { 'A>T': [fromA, toT], 'B>T': [fromB, toT] };
    }
    case 'open': {
      const mid = top + CELL / 2;
      const bar = line(g, xa, mid, xb, mid);
      bar.dataset.nodash = '1';
      return {
        'P>_C': [line(g, xa, bot, xa, mid), bar],
        'A>_C': [line(g, xa, top, xa, mid), bar],
        'B>_C': [line(g, xb, top, xb, mid), bar],
        'T>_C': [line(g, xb, bot, xb, mid), bar],
      };
    }
  }
}

function allCellEls(cells: CellPaths[]): SVGElement[] {
  return cells.flatMap((c) => Object.values(c).flat());
}

/**
 * Lights up the box currently over the ports with the solved flows: each open path in the
 * colour of the pressure it carries, dashes marching the way the oil actually moves through it
 * (against the printed arrow if it flows backwards). The other boxes go back to plain ink, and
 * so do any paths of the active box carrying nothing. The port leads show what enters/leaves.
 */
function paintValve(
  ctx: SimStepContext,
  cells: CellPaths[],
  active: number,
  elements: HydElement[],
  leads: Record<string, SVGElement[]>,
): void {
  cells.forEach((c, i) => {
    if (i !== active) clearFlow(Object.values(c).flat());
  });
  const cell = cells[active] ?? {};
  const items: Array<{ els: SVGElement[]; p: number; q: number }> = [];
  elements.forEach((e, i) => {
    if (e.kind !== 'orifice' && e.kind !== 'flowControl') return;
    const els = cell[`${e.a}>${e.b}`];
    if (!els) return;
    const q = ctx.elementValue(i);
    const pa = ctx.pressureAt(e.a);
    const pb = ctx.pressureAt(e.b);
    const p = Math.abs(q) >= FLOW_THRESHOLD ? (q >= 0 ? pa : pb) : Math.max(pa, pb);
    items.push({ els, p, q });
  });
  paintPaths(items);
  // Leads are drawn from the port into the valve body.
  for (const [port, els] of Object.entries(leads)) {
    paintFlow(els, ctx.pressureAt(port), -ctx.flowAt(port));
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

/** Lead lines from each port into the valve body, drawn port → body (into the valve). */
function drawValveLeads(g: SVGElement): Record<string, SVGElement[]> {
  const xa = PORT_CELL_X + 10;
  const xb = PORT_CELL_X + 30;
  return {
    A: [line(g, xa, 20, xa, BODY_Y)],
    B: [line(g, xb, 20, xb, BODY_Y)],
    P: [line(g, xa, 100, xa, BODY_Y + CELL)],
    T: [line(g, xb, 100, xb, BODY_Y + CELL)],
  };
}

/** Shared port setup: A, B on top, P, T underneath the cell at PORT_CELL_X. */
function makeValvePorts(shell: HydShell): Record<string, ReturnType<typeof createPort>> {
  const g = shell.g;
  const xa = PORT_CELL_X + 10;
  const xb = PORT_CELL_X + 30;
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
    if (e.kind !== 'orifice' && e.kind !== 'flowControl') return;
    // The load-sensing signal path carries next to nothing; it isn't a working flow.
    if (e.a === 'LS' || e.b === 'LS') return;
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
  const leads = drawValveLeads(shell.g);
  const ports = makeValvePorts(shell);
  shell.setInfoSide('right');
  let cells: CellPaths[] = [];

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
    cells = [
      drawCell(slide, 60, 'parallel'),
      drawCell(slide, 100, center),
      drawCell(slide, 140, 'cross'),
    ];
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
      paintValve(ctx, cells, state + 1, lastElements, leads);
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
      clearFlow([...allCellEls(cells), ...Object.values(leads).flat()]);
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
  const leads = drawValveLeads(shell.g);
  const ports = makeValvePorts(shell);
  shell.setInfoSide('right');
  let cells: CellPaths[] = [];

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
    cells = [drawCell(slide, 100, 'parallel'), drawCell(slide, 140, 'cross')];
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
      paintValve(ctx, cells, shifted ? 0 : 1, lastElements, leads);
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
      clearFlow([...allCellEls(cells), ...Object.values(leads).flat()]);
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
  // Both leads drawn in the free-flow direction, IN (bottom) → OUT (top).
  const inLead = [line(g, 20, 70, 20, glyph.inPoint.y, { 'stroke-width': 2.4 })];
  const outLead = [line(g, glyph.outPoint.x, glyph.outPoint.y, 20, 10, { 'stroke-width': 2.4 })];
  const ports = inlinePorts(g, 20);
  shell.setInfoSide('right');
  let crack = 0.5;
  const comp = hydComponentBase(shell, HYD_CHECK_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      { kind: 'check', a: 'IN', b: 'OUT', crack, k: orificeKFromRating(40, 2) },
    ],
    step(_dt: number, ctx: SimStepContext): void {
      const q = ctx.elementValue(0);
      shell.setInfo(throughInfo(ctx, q));
      paintFlow(inLead, ctx.pressureAt('IN'), q);
      paintFlow(outLead, ctx.pressureAt('OUT'), q);
    },
    snapshot: () => ({ ...nameSnapshot(shell), crack }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      crack = readNum(data, 'crack', crack, 0, 50);
    },
    reset(): void {
      shell.setInfo([]);
      clearFlow([...inLead, ...outLead]);
    },
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
  // Leads drawn in the free-flow direction, A (bottom) → B (top).
  const aLead = [line(g, 40, 70, 40, glyph.inPoint.y, { 'stroke-width': 2.4 })];
  const bLead = [line(g, glyph.outPoint.x, glyph.outPoint.y, 40, 10, { 'stroke-width': 2.4 })];
  const pilotLine = [
    path(g, 'M 10 50 H 22 V 38 H 32', { 'stroke-dasharray': '4 3', 'stroke-width': 1.5 }),
  ];
  pilotLine[0]!.dataset.nodash = '1';
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
      paintFlow(aLead, ctx.pressureAt('A'), q);
      paintFlow(bLead, ctx.pressureAt('B'), q);
      paintFlow(pilotLine, ctx.pressureAt('X'), 0);
    },
    snapshot: () => ({ ...nameSnapshot(shell), ratio }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      ratio = readNum(data, 'ratio', ratio, 1, 20);
    },
    reset(): void {
      shell.setInfo([]);
      clearFlow([...aLead, ...bLead, ...pilotLine]);
    },
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
  // Two halves drawn IN (bottom) → OUT (top), so the drop across the orifice shows.
  const inHalf = [line(g, 20, 70, 20, 40)];
  const outHalf = [line(g, 20, 40, 20, 10)];
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
      const q = ctx.elementValue(0);
      shell.setInfo(throughInfo(ctx, q));
      paintFlow(inHalf, ctx.pressureAt('IN'), q);
      paintFlow(outHalf, ctx.pressureAt('OUT'), q);
    },
    snapshot: () => ({ ...nameSnapshot(shell), diameter }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      diameter = readNum(data, 'diameter', diameter, 0, 50);
      refresh();
    },
    reset(): void {
      shell.setInfo([]);
      clearFlow([...inHalf, ...outHalf]);
    },
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
  // Throttled path drawn IN (top) → OUT (bottom), in two halves either side of the orifice.
  const inHalf = [line(g, 20, 10, 20, 40)];
  const outHalf = [line(g, 20, 40, 20, 70)];
  drawThrottle(g, 20, 40);
  adjustArrow(g, 20, 40, 14);
  // Free flow upwards (OUT → IN) through the check; the bypass is drawn in that direction.
  const glyph = drawBallCheckSymbol(g, 52, 40, 'vertical', 1, 0.6);
  const bypassOut = [
    path(g, 'M 20 62 H 52 V 54'),
    line(g, 52, 54, 52, Math.max(glyph.inPoint.y, glyph.outPoint.y)),
  ];
  const bypassIn = [
    line(g, 52, Math.min(glyph.inPoint.y, glyph.outPoint.y), 52, 26),
    path(g, 'M 52 26 V 18 H 20'),
  ];
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
      const qThrottle = ctx.elementValue(0);
      const qBypass = ctx.elementValue(1);
      shell.setInfo(throughInfo(ctx, qThrottle - qBypass));
      const pIn = ctx.pressureAt('IN');
      const pOut = ctx.pressureAt('OUT');
      paintFlow(inHalf, pIn, qThrottle);
      paintFlow(outHalf, pOut, qThrottle);
      paintFlow(bypassOut, pOut, qBypass);
      paintFlow(bypassIn, pIn, qBypass);
    },
    snapshot: () => ({ ...nameSnapshot(shell), diameter }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      diameter = readNum(data, 'diameter', diameter, 0, 50);
      refresh();
    },
    reset(): void {
      shell.setInfo([]);
      clearFlow([...inHalf, ...outHalf, ...bypassOut, ...bypassIn]);
    },
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
  // Controlled path drawn IN (bottom) → OUT (top), in two halves.
  const inHalf = [line(g, 40, 70, 40, 40)];
  const outHalf = [line(g, 40, 40, 40, 10)];
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
  // Bypass drawn in its free-flow direction, OUT (top) → IN (bottom).
  let bypassOut: SVGElement[] = [];
  let bypassIn: SVGElement[] = [];
  function refresh(): void {
    qText.textContent = `${qSet} L/min`;
    bypassG.replaceChildren();
    bypassOut = [];
    bypassIn = [];
    if (bypass) {
      const glyph = drawBallCheckSymbol(bypassG, 72, 40, 'vertical', -1, 0.6);
      bypassOut = [
        path(bypassG, 'M 40 14 H 72 V 26'),
        line(bypassG, 72, 26, 72, Math.min(glyph.inPoint.y, glyph.outPoint.y)),
      ];
      bypassIn = [
        line(bypassG, 72, Math.max(glyph.inPoint.y, glyph.outPoint.y), 72, 54),
        path(bypassG, 'M 72 54 V 66 H 40'),
      ];
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
      const qMain = ctx.elementValue(0);
      const qBypass = bypass ? ctx.elementValue(1) : 0;
      shell.setInfo(throughInfo(ctx, qMain - qBypass));
      const pIn = ctx.pressureAt('IN');
      const pOut = ctx.pressureAt('OUT');
      paintFlow(inHalf, pIn, qMain);
      paintFlow(outHalf, pOut, qMain);
      paintFlow(bypassOut, pOut, qBypass);
      paintFlow(bypassIn, pIn, qBypass);
    },
    snapshot: () => ({ ...nameSnapshot(shell), qSet, bypass }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      qSet = readNum(data, 'qSet', qSet, 0, 2000);
      if ('bypass' in data) bypass = Boolean(data.bypass);
      refresh();
    },
    reset(): void {
      shell.setInfo([]);
      clearFlow([...inHalf, ...outHalf, ...bypassOut, ...bypassIn]);
    },
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
  // Flow path drawn P (bottom) → A (top).
  const pLead = [line(g, 40, 90, 40, 70)];
  const aLead = [line(g, 40, 30, 40, 10)];
  const arrowG = createSvgEl('g', { class: 'hydSpool' });
  g.appendChild(arrowG);
  const throughArrow = arrowLine(arrowG, 40, 66, 40, 34);
  springH(g, 55, 75, 50);
  adjustArrow(g, 65, 50, 10);
  const pilotLine = [
    path(g, 'M 40 20 H 14 V 60 H 25', { 'stroke-dasharray': '4 3', 'stroke-width': 1.5 }),
  ];
  pilotLine[0]!.dataset.nodash = '1';
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
      const pP = ctx.pressureAt('P');
      paintFlow(pLead, pP, q);
      paintFlow(throughArrow, pP, q);
      paintFlow(aLead, pA, q);
      paintFlow(pilotLine, pA, 0);
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
      clearFlow([...pLead, ...aLead, ...throughArrow, ...pilotLine]);
    },
  });
}

/**
 * Counterbalance valve (overcentre valve) for an overrunning load - a load that would run away
 * if its return oil were let out freely, like a lifted weight being lowered. Fitted between the
 * directional valve (V) and the load-holding side of the actuator (L). Lifting: free flow V → L
 * through the check. Holding: shut, as long as the load pressure is below the setting (set
 * ~1.3 × the holding pressure). Lowering: the pilot (X), taken from the other side of the
 * actuator, opens it together with the load pressure, p_L + ratio·p_X ≥ setting - so the load
 * only comes down while the pump is actively driving it down, and never faster.
 */
export function createHydCounterbalance(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 100;
  const svgH = 100;
  const shell = createHydShell(
    compLayer,
    HYD_COUNTERBALANCE_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Counterbalance valve',
    { x: 12, y: 18, w: 82, h: 64 },
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
  // Controlled path drawn L (top) → V (bottom), the lowering direction.
  const lLead = [line(g, 40, 10, 40, 30)];
  const vLead = [line(g, 40, 70, 40, 90)];
  const arrowG = createSvgEl('g', { class: 'hydSpool' });
  g.appendChild(arrowG);
  const throughArrow = arrowLine(arrowG, 47, 36, 47, 64);
  springH(g, 55, 70, 40, 4);
  adjustArrow(g, 63, 40, 8);
  // Internal pilot from the load side, external pilot X.
  const pilotL = [
    path(g, 'M 40 20 H 18 V 40 H 25', { 'stroke-dasharray': '4 3', 'stroke-width': 1.5 }),
  ];
  const pilotX = [
    path(g, 'M 10 50 H 18 V 60 H 25', { 'stroke-dasharray': '4 3', 'stroke-width': 1.5 }),
  ];
  for (const el of [...pilotL, ...pilotX]) el.dataset.nodash = '1';
  // Bypass check for free flow V → L, drawn in that direction.
  const glyph = drawBallCheckSymbol(g, 84, 50, 'vertical', 1, 0.6);
  const bypassV = [
    path(g, 'M 40 80 H 84 V 66'),
    line(g, 84, 66, 84, Math.max(glyph.inPoint.y, glyph.outPoint.y)),
  ];
  const bypassL = [
    line(g, 84, Math.min(glyph.inPoint.y, glyph.outPoint.y), 84, 34),
    path(g, 'M 84 34 V 20 H 40'),
  ];
  createPortLabel(g, 47, 14, 'L', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, 47, 96, 'V', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, 8, 62, 'X', { anchor: 'middle', fontSize: 10 });
  const setText = createSvgEl('text', { x: 2, y: 86, 'font-size': 9 });
  g.appendChild(setText);
  const ports = {
    L: createPort(g, 'L', 40, 10, 'V'),
    V: createPort(g, 'V', 40, 90, 'V'),
    X: createPort(g, 'X', 10, 50, 'H', { isPilot: true, pilotDir: -1 }),
  };
  shell.setInfoSide('right');

  let setting = 100;
  let ratio = 4;
  let qNom = 30;
  function refresh(): void {
    setText.textContent = `${setting} bar`;
  }
  refresh();

  const comp = hydComponentBase(shell, HYD_COUNTERBALANCE_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      {
        kind: 'counterbalance',
        a: 'V',
        b: 'L',
        x: 'X',
        set: setting,
        ratio,
        k: orificeKFromRating(qNom, VALVE_RATING_DP),
        band: 5,
      },
    ],
    step(_dt: number, ctx: SimStepContext): void {
      const q = ctx.elementValue(0); // + = free V → L, − = controlled L → V
      const pL = ctx.pressureAt('L');
      const pV = ctx.pressureAt('V');
      const pX = ctx.pressureAt('X');
      const lowering = q < -FLOW_THRESHOLD;
      arrowG.setAttribute('transform', lowering ? 'translate(-7,0)' : '');
      const lines: string[] = [];
      if (lowering) lines.push(`lowering ${fmtFlow(-q)}`);
      else if (q > FLOW_THRESHOLD) lines.push(`free flow ${fmtFlow(q)}`);
      else if (pL > 1) lines.push(`holding ${fmtBar(pL)}`);
      if (pL > 1 && !lowering) {
        const pilotNeeded = Math.max(0, (setting - pL) / ratio);
        lines.push(`opens at X ${fmtBar(pilotNeeded)}`);
      }
      shell.setInfo(lines);
      paintFlow(lLead, pL, -q);
      paintFlow(vLead, pV, -q);
      paintFlow(throughArrow, pL, lowering ? -q : 0);
      paintFlow(bypassV, pV, Math.max(0, q));
      paintFlow(bypassL, pL, Math.max(0, q));
      paintFlow(pilotL, pL, 0);
      paintFlow(pilotX, pX, 0);
    },
    snapshot: () => ({ ...nameSnapshot(shell), setting, ratio, qNom }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      setting = readNum(data, 'setting', setting, 1, 700);
      ratio = readNum(data, 'ratio', ratio, 1, 20);
      qNom = readNum(data, 'qNom', qNom, 0.5, 2000);
      refresh();
    },
    reset(): void {
      arrowG.setAttribute('transform', '');
      shell.setInfo([]);
      clearFlow([
        ...lLead,
        ...vLead,
        ...throughArrow,
        ...bypassV,
        ...bypassL,
        ...pilotL,
        ...pilotX,
      ]);
    },
  });
}

/** Pressure drop (bar) across a load-sensing valve's metering notch at which its rated flow is
 * quoted (full spool stroke) - in a load-sensing circuit this is about the pump's margin. */
export const LS_VALVE_RATING_DP = 15;
/** Δp (bar) a section pressure compensator holds across the metering notch. */
export const LS_SECTION_COMP_DP = 10;
/** LS signal passage (L/min per √bar): work port ↔ LS port, or LS port ↔ tank in neutral. */
const LS_SIGNAL_K = 1;

/** Box width of the load-sensing valve: wider than a plain 4/3's, as it carries a fifth port
 * (LS) beside P and T. Ports sit 10, 30 and 50 px into a box; LS_MID_X is the neutral box. */
const LS_CELL = 60;
const LS_MID_X = 110;

/**
 * One box of the load-sensing valve, in ISO form: the working paths as on a 4/3 valve, plus the
 * LS passage - a thin line from the LS port (bottom right of the box) to the open work port,
 * with a dot where it joins it; in neutral it joins T, venting the LS line. Keys as drawCell's,
 * with the LS passage keyed like the solver element that models it ("A>LS", "B>LS", "LS>T").
 */
function drawLSCell(g: SVGElement, x0: number, kind: 'parallel' | 'closed' | 'cross'): CellPaths {
  const top = BODY_Y;
  const bot = BODY_Y + CELL;
  g.appendChild(
    createSvgEl('rect', {
      x: x0,
      y: top,
      width: LS_CELL,
      height: CELL,
      fill: '#fff',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  const xa = x0 + 10;
  const xb = x0 + 30;
  const xl = x0 + 50;
  const signal = { 'stroke-width': 1.5, class: 'lsPassage' };
  const dot = (cx: number, cy: number): SVGElement => {
    const c = createSvgEl('circle', { cx, cy, r: 2.5, fill: INK });
    g.appendChild(c);
    return c;
  };
  switch (kind) {
    case 'parallel': {
      const yJ = top + 12;
      return {
        'P>A': arrowLine(g, xa, bot, xa, top + 1),
        'B>T': arrowLine(g, xb, top, xb, bot - 1),
        // Drawn from the work port's junction to the LS port, the way the signal goes.
        'A>LS': [path(g, `M ${xa} ${yJ} H ${xl} V ${bot}`, signal), dot(xa, yJ)],
      };
    }
    case 'cross': {
      const yJ = top + 12;
      // Where the P→B arrow passes that height.
      const xJ = xa + ((xb - xa) * (bot - yJ)) / (bot - top);
      return {
        'P>B': arrowLine(g, xa, bot, xb, top + 1),
        'A>T': arrowLine(g, xa, top, xb, bot - 1),
        'B>LS': [path(g, `M ${xJ} ${yJ} H ${xl} V ${bot}`, signal), dot(xJ, yJ)],
      };
    }
    case 'closed':
      blocked(g, xa, top, 1);
      blocked(g, xb, top, 1);
      blocked(g, xa, bot, -1);
      return {
        // Neutral: LS joined to T inside the box, so the LS line vents to tank.
        'LS>T': [path(g, `M ${xl} ${bot} V ${bot - 12} H ${xb} V ${bot}`, signal)],
      };
  }
}

/**
 * Load-sensing proportional directional valve (4/3, closed centre, with LS port). The spool is
 * proportional: its stroke (−100 % … +100 %) opens the metering notch P→A or P→B - and the
 * matching return notch to T - in proportion. Whichever work port is open is connected to the
 * LS port, which tells the load-sensing pump the load pressure; in neutral the LS port is vented
 * to tank, so the pump drops to standby.
 *
 * Flow through the notch is Q = k·stroke·√Δp, and a load-sensing pump keeps Δp at its margin -
 * so the flow depends on the lever position only, not on the load. With several sections, the
 * lighter load still gets more oil unless each section has its own pressure compensator, which
 * holds a fixed Δp across its notch (enable "Section compensator").
 *
 * Operated by its lever (a slider under the symbol while simulating) or by two solenoids
 * driving it to a set stroke.
 */
export function createHydValveLS(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 280;
  const svgH = 120;
  const left = LS_MID_X - LS_CELL; // left edge of the left box when in neutral
  const right = LS_MID_X + 2 * LS_CELL;
  const shell = createHydShell(compLayer, HYD_VALVE_LS_TYPE, x, y, svgW, svgH, 'LS valve', {
    x: left,
    y: 34,
    w: right - left,
    h: 52,
  });
  const slide = createSvgEl('g');
  shell.g.appendChild(slide);
  const g = shell.g;
  // Port leads, drawn port → body (into the valve), under the neutral box.
  const xa = LS_MID_X + 10;
  const xb = LS_MID_X + 30;
  const xl = LS_MID_X + 50;
  const bot = BODY_Y + CELL;
  const leads: Record<string, SVGElement[]> = {
    A: [line(g, xa, 20, xa, BODY_Y)],
    B: [line(g, xb, 20, xb, BODY_Y)],
    P: [line(g, xa, 100, xa, bot)],
    T: [line(g, xb, 100, xb, bot)],
    LS: [line(g, xl, 100, xl, bot, { 'stroke-width': 1.5, class: 'lsPassage' })],
  };
  createPortLabel(g, xa - 8, 24, 'A', { anchor: 'end', fontSize: 10 });
  createPortLabel(g, xb + 8, 24, 'B', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, xa - 8, 102, 'P', { anchor: 'end', fontSize: 10 });
  createPortLabel(g, xb + 6, 102, 'T', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, xl + 8, 102, 'LS', { anchor: 'start', fontSize: 10 });
  const ports: Record<string, ReturnType<typeof createPort>> = {
    A: createPort(g, 'A', xa, 20, 'V'),
    B: createPort(g, 'B', xb, 20, 'V'),
    P: createPort(g, 'P', xa, 100, 'V'),
    T: createPort(g, 'T', xb, 100, 'V'),
    LS: createPort(g, 'LS', xl, 100, 'V'),
  };
  // Proportional valve: a line above and below the body.
  line(g, left, BODY_Y - 5, right, BODY_Y - 5, { 'stroke-width': 1.5 });
  line(g, left, bot + 5, right, bot + 5, { 'stroke-width': 1.5 });
  const compLabel = createSvgEl('text', { x: left, y: 30, 'font-size': 9 });
  g.appendChild(compLabel);
  shell.setInfoSide('right');
  let cells: CellPaths[] = [];

  // The lever: a slider under the symbol, shown while simulating (see app.css).
  const lever = document.createElement('input');
  lever.type = 'range';
  lever.min = '-100';
  lever.max = '100';
  lever.step = '5';
  lever.value = '0';
  lever.className = 'lsLever';
  lever.title = 'Lever: left = P→A, right = P→B, middle = closed (double-click to centre)';
  for (const ev of ['mousedown', 'pointerdown', 'click', 'dblclick'] as const) {
    lever.addEventListener(ev, (e) => e.stopPropagation());
  }
  shell.el.appendChild(lever);

  const [k1, k2] = nextFreeSolenoidKeys(2);
  let keyLeft = k1 ?? 'Y1';
  let keyRight = k2 ?? 'Y2';
  let actuation: Actuation = 'lever';
  let qNom = 40; // L/min at full stroke, Δp LS_VALVE_RATING_DP
  let solenoidStroke = 100; // % the solenoids drive the spool to
  let compensated = false;
  /** Spool stroke, −1 (P→A, left box) … +1 (P→B, right box). */
  let stroke = 0;
  let lastElements: HydElement[] = [];

  function draw(): void {
    slide.replaceChildren();
    cells = [
      drawLSCell(slide, left, 'parallel'),
      drawLSCell(slide, LS_MID_X, 'closed'),
      drawLSCell(slide, LS_MID_X + LS_CELL, 'cross'),
    ];
    if (actuation === 'solenoid') {
      drawSolenoid(slide, left, -1, keyLeft);
      drawSolenoid(slide, right, 1, keyRight);
    } else {
      drawLever(slide, left, -1);
    }
    drawSpring(slide, left, -1);
    drawSpring(slide, right, 1);
    lever.style.display = actuation === 'lever' ? '' : 'none';
    compLabel.textContent = compensated ? 'comp.' : '';
    applyState();
  }
  function applyState(): void {
    // Proportional: the boxes slide as far as the spool actually strokes.
    slide.setAttribute('transform', `translate(${(stroke * LS_CELL).toFixed(1)},0)`);
  }
  draw();

  lever.addEventListener('input', () => {
    stroke = Number(lever.value) / 100;
    applyState();
  });
  lever.addEventListener('dblclick', () => {
    stroke = 0;
    lever.value = '0';
    applyState();
  });

  const comp = hydComponentBase(shell, HYD_VALVE_LS_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    recompute(): void {
      if (actuation !== 'solenoid') return;
      const l = keyLeft.trim() !== '' && getSignal(keyLeft);
      const r = keyRight.trim() !== '' && getSignal(keyRight);
      const next = l && !r ? -solenoidStroke / 100 : r && !l ? solenoidStroke / 100 : 0;
      if (next !== stroke) {
        stroke = next;
        applyState();
      }
    },
    hydElements(): HydElement[] {
      const open = Math.abs(stroke);
      if (open < 0.005) {
        lastElements = [{ kind: 'orifice', a: 'LS', b: 'T', k: LS_SIGNAL_K }];
        return lastElements;
      }
      const work = stroke < 0 ? 'A' : 'B';
      const other = stroke < 0 ? 'B' : 'A';
      const kMeter = orificeKFromRating(qNom, LS_VALVE_RATING_DP) * open;
      const meter: HydElement = compensated
        ? {
            kind: 'flowControl',
            a: 'P',
            b: work,
            q: kMeter * Math.sqrt(LS_SECTION_COMP_DP),
            dpMin: 2,
          }
        : { kind: 'orifice', a: 'P', b: work, k: kMeter };
      lastElements = [
        meter,
        // Return notch: larger than the metering notch, so it doesn't hold the load back.
        { kind: 'orifice', a: other, b: 'T', k: kMeter * 2 },
        { kind: 'orifice', a: work, b: 'LS', k: LS_SIGNAL_K },
      ];
      return lastElements;
    },
    step(_dt: number, ctx: SimStepContext): void {
      const pct = Math.round(Math.abs(stroke) * 100);
      const lines = valveInfo(ctx, lastElements);
      if (pct > 0) lines.unshift(`${stroke < 0 ? 'P→A' : 'P→B'} open ${pct} %`);
      lines.push(`LS ${fmtBar(ctx.pressureAt('LS'))}`);
      shell.setInfo(lines);
      const active = stroke < -0.005 ? 0 : stroke > 0.005 ? 2 : 1;
      paintValve(ctx, cells, active, lastElements, leads);
    },
    snapshot: () => ({
      ...nameSnapshot(shell),
      keyLeft,
      keyRight,
      actuation,
      qNom,
      solenoidStroke,
      compensated,
    }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      if (typeof data.keyLeft === 'string') keyLeft = data.keyLeft;
      if (typeof data.keyRight === 'string') keyRight = data.keyRight;
      if (data.actuation === 'solenoid' || data.actuation === 'lever') actuation = data.actuation;
      qNom = readNum(data, 'qNom', qNom, 0.1, 2000);
      solenoidStroke = readNum(data, 'solenoidStroke', solenoidStroke, 0, 100);
      if ('compensated' in data) compensated = Boolean(data.compensated);
      draw();
    },
    reset(): void {
      stroke = 0;
      lever.value = '0';
      applyState();
      shell.setInfo([]);
      clearFlow([...allCellEls(cells), ...Object.values(leads).flat()]);
    },
  });
}

/**
 * Shuttle valve (OR valve): the outlet takes the higher of the two inlet pressures - the ball is
 * pushed onto the seat of the lower one. In load-sensing circuits it picks the highest load
 * signal of two sections for the pump.
 */
export function createHydShuttle(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 80;
  const svgH = 80;
  const shell = createHydShell(compLayer, HYD_SHUTTLE_TYPE, x, y, svgW, svgH, 'Shuttle valve', {
    x: 18,
    y: 28,
    w: 44,
    h: 24,
  });
  const g = shell.g;
  g.appendChild(
    createSvgEl('rect', {
      x: 20,
      y: 30,
      width: 40,
      height: 20,
      fill: '#fff',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  // Seats at both ends, the ball between them.
  path(g, 'M 24 33 L 30 40 L 24 47');
  path(g, 'M 56 33 L 50 40 L 56 47');
  const ball = createSvgEl('circle', {
    cx: 40,
    cy: 40,
    r: 5,
    fill: '#fff',
    stroke: INK,
    'stroke-width': 1.5,
  });
  g.appendChild(ball);
  // Drawn from each inlet towards the outlet.
  const in1 = [line(g, 10, 40, 20, 40)];
  const in2 = [line(g, 70, 40, 60, 40)];
  const out = [line(g, 40, 30, 40, 10)];
  createPortLabel(g, 10, 54, '1', { anchor: 'middle', fontSize: 9 });
  createPortLabel(g, 70, 54, '2', { anchor: 'middle', fontSize: 9 });
  const ports = {
    X1: createPort(g, 'X1', 10, 40, 'H'),
    X2: createPort(g, 'X2', 70, 40, 'H'),
    OUT: createPort(g, 'OUT', 40, 10, 'V'),
  };
  shell.setInfoSide('right');
  const comp = hydComponentBase(shell, HYD_SHUTTLE_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [{ kind: 'shuttle', a: 'X1', b: 'X2', x: 'OUT', k: 1 }],
    step(_dt: number, ctx: SimStepContext): void {
      // The ball sits on the seat of the lower-pressure inlet.
      const w = ctx.elementValue(0);
      ball.setAttribute('cx', String(32 + 16 * w));
      const p1 = ctx.pressureAt('X1');
      const p2 = ctx.pressureAt('X2');
      paintFlow(in1, p1, -ctx.flowAt('X1'));
      paintFlow(in2, p2, -ctx.flowAt('X2'));
      paintFlow(out, ctx.pressureAt('OUT'), ctx.flowAt('OUT'));
      shell.setInfo(Math.max(p1, p2) > 1 ? [`out ${fmtBar(ctx.pressureAt('OUT'))}`] : []);
    },
    snapshot: () => nameSnapshot(shell),
    restore: (data: Record<string, unknown>) => restoreName(shell, data),
    reset(): void {
      ball.setAttribute('cx', '40');
      shell.setInfo([]);
      clearFlow([...in1, ...in2, ...out]);
    },
  });
}

/**
 * 2-way pressure compensator (as fitted ahead of a load-sensing valve section). Normally open
 * IN → OUT; the outlet pressure pushes it towards closing, the spring and the LS pilot (the load
 * pressure of its section) push it open. It settles where
 *   p_OUT = p_LS + Δp setting
 * so the section's metering notch, between OUT and the load, always sees the same Δp - and the
 * section gets the flow its lever asks for, whatever the other sections or the pump pressure do.
 * The surplus pressure is throttled away here (as heat).
 */
export function createHydPressureCompensator(
  compLayer: HTMLElement,
  x: number,
  y: number,
): Component {
  const svgW = 80;
  const svgH = 100;
  const shell = createHydShell(
    compLayer,
    HYD_PRESSURE_COMP_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Pressure compensator',
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
  // Flow path drawn IN (bottom) → OUT (top); normally open, so the arrow sits on the line.
  const inLead = [line(g, 40, 90, 40, 70)];
  const outLead = [line(g, 40, 30, 40, 10)];
  const arrowG = createSvgEl('g', { class: 'hydSpool' });
  g.appendChild(arrowG);
  const throughArrow = arrowLine(arrowG, 40, 66, 40, 34);
  // Outlet pressure pilot against the spring side's LS pilot + spring.
  const pilotOut = [
    path(g, 'M 40 20 H 14 V 40 H 25', { 'stroke-dasharray': '4 3', 'stroke-width': 1.5 }),
  ];
  springH(g, 55, 72, 44, 4);
  adjustArrow(g, 63, 44, 8);
  const pilotLS = [
    path(g, 'M 70 80 V 60 H 55', { 'stroke-dasharray': '4 3', 'stroke-width': 1.5 }),
  ];
  for (const el of [...pilotOut, ...pilotLS]) el.dataset.nodash = '1';
  createPortLabel(g, 33, 96, 'IN', { anchor: 'end', fontSize: 10 });
  createPortLabel(g, 47, 14, 'OUT', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, 76, 92, 'LS', { anchor: 'start', fontSize: 10 });
  const setText = createSvgEl('text', { x: 58, y: 34, 'font-size': 9 });
  g.appendChild(setText);
  const ports = {
    IN: createPort(g, 'IN', 40, 90, 'V'),
    OUT: createPort(g, 'OUT', 40, 10, 'V'),
    LS: createPort(g, 'LS', 70, 80, 'V', { isPilot: true, pilotDir: 1 }),
  };
  shell.setInfoSide('left');

  let setting = 10; // bar held above the LS pressure
  let qNom = 40; // L/min fully open at Δp 5 bar
  function refresh(): void {
    setText.textContent = `Δp ${setting}`;
  }
  refresh();

  const comp = hydComponentBase(shell, HYD_PRESSURE_COMP_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      {
        kind: 'reducing',
        a: 'IN',
        b: 'OUT',
        set: setting,
        k: orificeKFromRating(qNom, VALVE_RATING_DP),
        band: 1,
        x: 'LS',
      },
    ],
    step(_dt: number, ctx: SimStepContext): void {
      const q = ctx.elementValue(0);
      const pIn = ctx.pressureAt('IN');
      const pOut = ctx.pressureAt('OUT');
      const pLS = ctx.pressureAt('LS');
      const throttled = pIn - pOut;
      const regulating = pOut > pLS + setting - 1 && throttled > 0.5;
      arrowG.setAttribute('transform', regulating ? 'translate(7,0)' : '');
      const lines: string[] = [];
      if (Math.abs(q) >= FLOW_THRESHOLD) lines.push(`Q ${fmtFlow(q)}`);
      if (pIn > 1 || pLS > 1) lines.push(`OUT − LS ${fmtBar(pOut - pLS)}`);
      if (throttled >= 0.5 && Math.abs(q) >= FLOW_THRESHOLD)
        lines.push(`throttles ${fmtBar(throttled)}`);
      shell.setInfo(lines);
      paintFlow(inLead, pIn, q);
      paintFlow(throughArrow, pIn, q);
      paintFlow(outLead, pOut, q);
      paintFlow(pilotOut, pOut, 0);
      paintFlow(pilotLS, pLS, 0);
    },
    snapshot: () => ({ ...nameSnapshot(shell), setting, qNom }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      setting = readNum(data, 'setting', setting, 0.5, 100);
      qNom = readNum(data, 'qNom', qNom, 0.5, 2000);
      refresh();
    },
    reset(): void {
      arrowG.setAttribute('transform', '');
      shell.setInfo([]);
      clearFlow([...inLead, ...outLead, ...throughArrow, ...pilotOut, ...pilotLS]);
    },
  });
}
