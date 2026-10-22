/**
 * Draws a PLC function block diagram (see sim/plcGraph.ts) in IEC 61131-3 FBD style. Shared by the
 * editor (ui/plcEditorDialog.ts), which adds selection and mouse handling on top, and the live
 * monitor (ui/plcMonitor.ts), which instead colors every signal by its current value.
 */
import {
  fbArgLayout,
  gateInputCount,
  inputPinCount,
  type GateOp,
  type GraphNode,
  type GraphWire,
  type PlcGraph,
} from '../sim/plcGraph';
import { FB_ARG_SHAPE, type FbState, type FbType } from '../sim/plcProgram';
import { createSvgEl } from '../components/shared/svgHelpers';
import { pathFromPoints } from '../geometry/routing';

export type Point = { x: number; y: number };
type FbNode = Extract<GraphNode, { kind: 'fb' }>;

/** Blocks snap to this grid, and every pin sits at a multiple of it from its block's center, so
 * pins of blocks placed side by side line up and wires between them run straight. */
export const GRID = 10;
/** Height of one formal-parameter row inside a function block (and one input of a gate). */
const ROW = 20;
/** Length of the short connection line between a block's edge and its pin. */
const STUB = 10;
/** Height of a function block's header row, which holds its type name. */
const FB_HEADER = 20;
const FB_BOX_W = 100;
const GATE_BOX_W = 40;
const VAR_W = 80;

/** IEC 61131-3 formal parameter names, in TYPE(...) argument order - both the boolean inputs that
 * get a pin and the numeric ones (PT, PV) that are written as a literal beside the block. */
export const FB_INPUT_NAMES: Record<FbType, string[]> = {
  TON: ['IN', 'PT'],
  TOF: ['IN', 'PT'],
  TP: ['IN', 'PT'],
  CTU: ['CU', 'R', 'PV'],
  CTD: ['CD', 'LD', 'PV'],
  SR: ['S1', 'R'],
  RS: ['S', 'R1'],
};

/** Output parameters. Only the first (the boolean Q/Q1) can be wired; the rest (elapsed time,
 * count) are drawn so the block reads like the standard one, but the program can't use them. */
const FB_OUTPUT_NAMES: Record<FbType, string[]> = {
  TON: ['Q', 'ET'],
  TOF: ['Q', 'ET'],
  TP: ['Q', 'ET'],
  CTU: ['Q', 'CV'],
  CTD: ['Q', 'CV'],
  SR: ['Q1'],
  RS: ['Q1'],
};

/** The IEC symbol printed at the top of each logic box. */
export const GATE_SYMBOL: Record<GateOp, string> = { AND: '&', OR: '≥1', XOR: '=1' };

export function isTimer(fbType: FbType): boolean {
  return fbType === 'TON' || fbType === 'TOF' || fbType === 'TP';
}

function fbRows(fbType: FbType): number {
  return Math.max(FB_ARG_SHAPE[fbType].length, FB_OUTPUT_NAMES[fbType].length);
}

/** The block's own rectangle, centered on (node.x, node.y). Variables have no box. */
function boxSize(n: GraphNode): { w: number; h: number } {
  switch (n.kind) {
    case 'signal':
    case 'coil':
      return { w: VAR_W, h: ROW };
    case 'not':
      return { w: GATE_BOX_W, h: 30 };
    case 'gate':
      return { w: GATE_BOX_W, h: gateInputCount(n) * ROW };
    case 'fb':
      return { w: FB_BOX_W, h: FB_HEADER + fbRows(n.fbType) * ROW };
  }
}

/** y (relative to the node center) of a function block's parameter row. */
function fbRowY(n: FbNode, row: number): number {
  return -boxSize(n).h / 2 + FB_HEADER + ROW / 2 + row * ROW;
}

export function inputPinLocal(n: GraphNode, pin: number): Point {
  const { w, h } = boxSize(n);
  switch (n.kind) {
    case 'coil':
      return { x: -w / 2, y: 0 };
    case 'not':
      return { x: -w / 2 - STUB, y: 0 };
    case 'gate':
      return { x: -w / 2 - STUB, y: -h / 2 + ROW / 2 + pin * ROW };
    case 'fb':
      return { x: -w / 2 - STUB, y: fbRowY(n, fbArgLayout(n.fbType).boolArgs[pin] ?? 0) };
    case 'signal':
      return { x: 0, y: 0 };
  }
}

export function outputPinLocal(n: GraphNode): Point | null {
  const { w } = boxSize(n);
  switch (n.kind) {
    case 'coil':
      return null;
    case 'signal':
      return { x: w / 2, y: 0 };
    case 'not':
      // The negation circle sits on the box edge, so the pin is one grid step further out.
      return { x: w / 2 + 2 * STUB, y: 0 };
    case 'gate':
      return { x: w / 2 + STUB, y: 0 };
    case 'fb':
      return { x: w / 2 + STUB, y: fbRowY(n, 0) };
  }
}

/** The area a node draws into, including its pins, instance name and literals - what a view
 * needs to fit the whole diagram on screen. */
export function nodeExtent(n: GraphNode): { x1: number; y1: number; x2: number; y2: number } {
  const { w, h } = boxSize(n);
  const literal = n.kind === 'fb' && fbArgLayout(n.fbType).numArgs.length > 0 ? 50 : 0;
  const top = n.kind === 'fb' ? 18 : 4;
  const right = n.kind === 'fb' && n.fbType !== 'SR' && n.fbType !== 'RS' ? 45 : 0;
  return {
    x1: n.x - w / 2 - STUB - literal,
    y1: n.y - h / 2 - top,
    x2: n.x + w / 2 + 2 * STUB + right,
    y2: n.y + h / 2 + 4,
  };
}

/** IEC duration literal for a timer's PT, e.g. T#2s, T#500ms, T#1.25s. */
export function formatDuration(seconds: number): string {
  if (Number.isInteger(seconds)) return `T#${seconds}s`;
  const ms = seconds * 1000;
  if (Math.abs(ms - Math.round(ms)) < 1e-9 && seconds < 1) return `T#${Math.round(ms)}ms`;
  return `T#${seconds}s`;
}

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/** Orthogonal route from an output pin to an input pin: across, down/up at `midX`, across. When
 * the input is behind the output, it loops round instead of cutting back through the blocks. */
export function wireRoute(p1: Point, p2: Point, midX: number): Point[] {
  if (p2.x - p1.x >= 2 * GRID) {
    return [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
  }
  const ym = p1.y === p2.y ? p1.y + 4 * GRID : (p1.y + p2.y) / 2;
  return [
    p1,
    { x: p1.x + GRID, y: p1.y },
    { x: p1.x + GRID, y: ym },
    { x: p2.x - GRID, y: ym },
    { x: p2.x - GRID, y: p2.y },
    p2,
  ];
}

/** Current values to color the diagram with (monitor mode). */
export interface LiveValues {
  /** Each node's output value (a coil: its input), from `evaluateGraphNodes`. */
  nodes: Map<string, boolean>;
  /** Function block states by upper-case instance name, for ET/CV readouts. */
  fb: Map<string, FbState>;
}

export interface DrawOptions {
  selectedNodeId?: string | null;
  selectedWireId?: string | null;
  live?: LiveValues;
  /** Editor hooks - the monitor passes none, which leaves the diagram read-only. */
  onNodeMouseDown?(node: GraphNode, e: MouseEvent): void;
  onNodeDblClick?(node: GraphNode, e: MouseEvent): void;
  onWireMouseDown?(wire: GraphWire, e: MouseEvent): void;
  onOutPinMouseDown?(node: GraphNode, e: MouseEvent): void;
}

function line(g: SVGElement, x1: number, y1: number, x2: number, y2: number, cls: string): void {
  g.appendChild(createSvgEl('line', { x1, y1, x2, y2, class: cls }));
}

function text(
  g: SVGElement,
  x: number,
  y: number,
  content: string,
  attrs: Record<string, string | number> = {},
): SVGElement {
  const t = createSvgEl('text', { x, y, 'font-size': 11, ...attrs });
  t.textContent = content;
  g.appendChild(t);
  return t;
}

/** Stroke class for a line carrying a signal: plain in the editor, on/off in the monitor. */
function signalClass(live: LiveValues | undefined, value: boolean | undefined): string {
  if (!live) return 'plcStroke';
  return value ? 'plcStroke plcOn' : 'plcStroke plcOff';
}

function formatSeconds(s: number): string {
  return `${s.toFixed(s < 10 ? 1 : 0)}s`;
}

function drawNodeBody(
  g: SVGElement,
  n: GraphNode,
  live: LiveValues | undefined,
  inputValue: (pin: number) => boolean | undefined,
): void {
  const { w, h } = boxSize(n);
  const left = n.x - w / 2;
  const top = n.y - h / 2;
  const out = live?.nodes.get(n.id);

  // Invisible hit area, so a variable (which is just a name on a line) can still be grabbed
  // anywhere along it, and so the selection outline has something to draw round.
  g.appendChild(
    createSvgEl('rect', {
      x: left - (n.kind === 'fb' || n.kind === 'gate' || n.kind === 'not' ? STUB : 0),
      y: top - (n.kind === 'fb' ? 16 : 3),
      width:
        w + (n.kind === 'fb' || n.kind === 'gate' ? 2 * STUB : n.kind === 'not' ? 3 * STUB : 0),
      height: h + (n.kind === 'fb' ? 19 : 6),
      class: 'plcNodeHit',
    }),
  );

  switch (n.kind) {
    case 'signal': {
      // An input variable: its name, then a line out to the pin.
      line(g, n.x + w / 2 - STUB * 2, n.y, n.x + w / 2, n.y, signalClass(live, out));
      text(g, n.x + w / 2 - STUB * 2 - 3, n.y + 4, n.ref, {
        'text-anchor': 'end',
        class: live && out ? 'plcVarText plcVarOn' : 'plcVarText',
      });
      return;
    }
    case 'coil': {
      // An output variable: a line in from the pin, then its name.
      line(g, left, n.y, left + STUB * 2, n.y, signalClass(live, out));
      text(g, left + STUB * 2 + 3, n.y + 4, n.target, {
        class: live && out ? 'plcVarText plcVarOn' : 'plcVarText',
      });
      return;
    }
    case 'not':
    case 'gate': {
      g.appendChild(createSvgEl('rect', { x: left, y: top, width: w, height: h, class: 'plcBox' }));
      text(g, n.x, top + 13, n.kind === 'not' ? '1' : GATE_SYMBOL[n.op], {
        'text-anchor': 'middle',
        'font-size': 12,
        class: 'plcBoxTitle',
      });
      const count = inputPinCount(n);
      for (let p = 0; p < count; p++) {
        const pl = inputPinLocal(n, p);
        line(g, n.x + pl.x, n.y + pl.y, left, n.y + pl.y, signalClass(live, inputValue(p)));
      }
      if (n.kind === 'not') {
        // Negated output: the IEC inversion circle on the box edge.
        g.appendChild(
          createSvgEl('circle', { cx: left + w + 4, cy: n.y, r: 4, class: 'plcNegation' }),
        );
        line(g, left + w + 8, n.y, n.x + w / 2 + 2 * STUB, n.y, signalClass(live, out));
      } else {
        line(g, left + w, n.y, left + w + STUB, n.y, signalClass(live, out));
      }
      return;
    }
    case 'fb': {
      g.appendChild(createSvgEl('rect', { x: left, y: top, width: w, height: h, class: 'plcBox' }));
      text(g, n.x, top - 5, n.instance, { 'text-anchor': 'middle', class: 'plcInstanceName' });
      text(g, n.x, top + 14, n.fbType, {
        'text-anchor': 'middle',
        'font-weight': 'bold',
        class: 'plcBoxTitle',
      });
      const { boolArgs, numArgs } = fbArgLayout(n.fbType);
      FB_INPUT_NAMES[n.fbType].forEach((name, argIdx) => {
        const y = n.y + fbRowY(n, argIdx);
        const boolPin = boolArgs.indexOf(argIdx);
        line(
          g,
          left - STUB,
          y,
          left,
          y,
          boolPin >= 0 ? signalClass(live, inputValue(boolPin)) : 'plcStroke',
        );
        text(g, left + 4, y + 4, name, { 'font-size': 10, class: 'plcParamName' });
        const paramIdx = numArgs.indexOf(argIdx);
        if (paramIdx >= 0) {
          // A literal (PT/PV) is written beside the input the way IEC FBD shows a constant.
          const value = n.params[paramIdx] ?? 0;
          text(
            g,
            left - STUB - 3,
            y + 4,
            isTimer(n.fbType) ? formatDuration(value) : String(value),
            { 'text-anchor': 'end', class: 'plcLiteral' },
          );
        }
      });
      const state = live?.fb.get(n.instance.trim().toUpperCase());
      FB_OUTPUT_NAMES[n.fbType].forEach((name, row) => {
        const y = n.y + fbRowY(n, row);
        line(
          g,
          left + w,
          y,
          left + w + STUB,
          y,
          row === 0 ? signalClass(live, out) : 'plcStroke plcUnused',
        );
        text(g, left + w - 4, y + 4, name, {
          'text-anchor': 'end',
          'font-size': 10,
          class: 'plcParamName',
        });
        if (live && row > 0) {
          // The monitor's readout of the elapsed time / count, beside the unwired ET/CV output.
          const reading = isTimer(n.fbType)
            ? formatSeconds(state?.et ?? 0)
            : String(state?.cv ?? 0);
          text(g, left + w + STUB + 3, y + 4, reading, { class: 'plcLiveValue' });
        }
      });
      return;
    }
  }
}

/** Replaces `svg`'s contents with `graph` drawn in FBD style. */
export function drawDiagram(svg: SVGElement, graph: PlcGraph, opts: DrawOptions = {}): void {
  svg.replaceChildren();
  const { live } = opts;
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const sourceOf = new Map(graph.wires.map((w) => [`${w.to.node}:${w.to.pin}`, w.from.node]));
  const valueAt = (nodeId: string, pin: number): boolean | undefined => {
    const src = sourceOf.get(`${nodeId}:${pin}`);
    return src === undefined ? undefined : live?.nodes.get(src);
  };

  // Wires leaving the same output share one vertical run (at the nearest target's midpoint),
  // with a junction dot wherever a branch leaves it - how a fanned-out signal is drawn by hand.
  const bySource = new Map<string, GraphWire[]>();
  for (const w of graph.wires) {
    const list = bySource.get(w.from.node) ?? [];
    list.push(w);
    bySource.set(w.from.node, list);
  }
  for (const [sourceId, wires] of bySource) {
    const from = nodesById.get(sourceId);
    const out = from && outputPinLocal(from);
    if (!from || !out) continue;
    const p1 = { x: from.x + out.x, y: from.y + out.y };
    const value = live?.nodes.get(sourceId);
    const ends: Point[] = [];
    for (const w of wires) {
      const to = nodesById.get(w.to.node);
      if (!to) continue;
      const inp = inputPinLocal(to, w.to.pin);
      ends.push({ x: to.x + inp.x, y: to.y + inp.y });
    }
    const forward = ends.filter((p) => p.x - p1.x >= 2 * GRID);
    const midX =
      forward.length > 0 ? Math.min(...forward.map((p) => snap((p1.x + p.x) / 2))) : p1.x;

    for (const w of wires) {
      const to = nodesById.get(w.to.node);
      if (!to) continue;
      const inp = inputPinLocal(to, w.to.pin);
      const d = pathFromPoints(wireRoute(p1, { x: to.x + inp.x, y: to.y + inp.y }, midX));
      if (opts.onWireMouseDown) {
        const hit = createSvgEl('path', { d, class: 'plcWireHit', fill: 'none' });
        hit.addEventListener('mousedown', (e) => opts.onWireMouseDown?.(w, e));
        svg.appendChild(hit);
      }
      let cls = 'plcWire';
      if (w.id === opts.selectedWireId) cls += ' plcWireSelected';
      if (live) cls += value ? ' plcOn' : ' plcOff';
      svg.appendChild(createSvgEl('path', { d, class: cls, fill: 'none' }));
    }

    // A dot marks a real junction - three or more segments meeting on the shared vertical run -
    // not a plain corner where it just turns.
    if (forward.length > 1) {
      const ys = [p1.y, ...forward.map((p) => p.y)];
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      for (const y of new Set(ys)) {
        const horizontals = ys.filter((v) => v === y).length;
        const verticals = (y > lo ? 1 : 0) + (y < hi ? 1 : 0);
        if (horizontals + verticals >= 3) {
          svg.appendChild(
            createSvgEl('circle', {
              cx: midX,
              cy: y,
              r: 2.5,
              class: live && value ? 'plcJunction plcOn' : 'plcJunction',
            }),
          );
        }
      }
    }
  }

  for (const n of graph.nodes) {
    const selected = n.id === opts.selectedNodeId;
    const g = createSvgEl('g', {
      class: `plcNode plcNode-${n.kind}${selected ? ' plcNodeSelected' : ''}`,
    });
    g.dataset.nodeId = n.id;
    drawNodeBody(g, n, live, (p) => valueAt(n.id, p));

    const count = inputPinCount(n);
    for (let p = 0; p < count; p++) {
      const local = inputPinLocal(n, p);
      const wired = sourceOf.has(`${n.id}:${p}`);
      let cls = wired ? 'plcPin' : 'plcPin plcPinOpen';
      if (live && wired) cls += valueAt(n.id, p) ? ' plcOn' : ' plcOff';
      drawPin(g, n, 'in', p, { x: n.x + local.x, y: n.y + local.y }, cls, opts);
    }
    const out = outputPinLocal(n);
    if (out) {
      let cls = 'plcPin';
      if (live) cls += live.nodes.get(n.id) ? ' plcOn' : ' plcOff';
      drawPin(g, n, 'out', 0, { x: n.x + out.x, y: n.y + out.y }, cls, opts);
    }

    if (opts.onNodeMouseDown) {
      g.addEventListener('mousedown', (e) => {
        if ((e.target as Element).classList.contains('plcPinHit')) return;
        opts.onNodeMouseDown?.(n, e);
      });
    }
    if (opts.onNodeDblClick) g.addEventListener('dblclick', (e) => opts.onNodeDblClick?.(n, e));

    svg.appendChild(g);
  }
}

/** A pin is a small visible dot plus (when editing) a larger invisible circle on top that
 * actually catches the mouse, so it doesn't take pixel-perfect aim to start or finish a wire. */
function drawPin(
  g: SVGElement,
  node: GraphNode,
  dir: 'in' | 'out',
  index: number,
  pos: Point,
  cls: string,
  opts: DrawOptions,
): void {
  g.appendChild(createSvgEl('circle', { cx: pos.x, cy: pos.y, r: 3, class: cls }));
  if (!opts.onNodeMouseDown) return;
  const hit = createSvgEl('circle', { cx: pos.x, cy: pos.y, r: 7, class: 'plcPinHit' });
  hit.dataset.pinNode = node.id;
  hit.dataset.pinDir = dir;
  hit.dataset.pinIndex = String(index);
  if (dir === 'out') hit.addEventListener('mousedown', (e) => opts.onOutPinMouseDown?.(node, e));
  g.appendChild(hit);
}
