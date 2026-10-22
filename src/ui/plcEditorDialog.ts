import {
  cloneGraph,
  compileGraph,
  fbArgLayout,
  gateInputCount,
  graphToText,
  inputPinCount,
  COIL_TARGETS,
  FB_TYPES,
  GATE_OPS,
  MAX_GATE_INPUTS,
  MIN_GATE_INPUTS,
  SIGNAL_REFS,
  type CoilTarget,
  type GateOp,
  type GraphNode,
  type PlcGraph,
  type SignalRef,
} from '../sim/plcGraph';
import { FB_ARG_SHAPE, type FbType } from '../sim/plcProgram';
import { createSvgEl } from '../components/shared/svgHelpers';
import { pathFromPoints } from '../geometry/routing';

export interface PlcEditorOptions {
  /** null when this PLC was saved before the graphical editor existed and only has legacy text -
   * the dialog starts from a blank diagram rather than guessing one back out of that text. */
  graph: PlcGraph | null;
  onSave(graph: PlcGraph): void;
}

type Point = { x: number; y: number };
type FbNode = Extract<GraphNode, { kind: 'fb' }>;

/** Blocks snap to this grid, and every pin sits at a multiple of it from its block's center, so
 * pins of blocks placed side by side line up and wires between them run straight. */
const GRID = 10;
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
const FB_INPUT_NAMES: Record<FbType, string[]> = {
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

const FB_DESCRIPTIONS: Record<FbType, string> = {
  TON: 'On-delay timer',
  TOF: 'Off-delay timer',
  TP: 'Pulse timer',
  CTU: 'Up counter',
  CTD: 'Down counter',
  SR: 'Set-dominant latch',
  RS: 'Reset-dominant latch',
};

const FB_NAME_PREFIX: Record<FbType, string> = {
  TON: 'T',
  TOF: 'T',
  TP: 'T',
  CTU: 'C',
  CTD: 'C',
  SR: 'M',
  RS: 'M',
};

/** The IEC symbol printed at the top of each logic box. */
const GATE_SYMBOL: Record<GateOp, string> = { AND: '&', OR: '≥1', XOR: '=1' };

/** Which choices the "Function" picker offers a logic block - NOT is a different node kind, but
 * to the user it's just another logic function, so switching to and from it is allowed. */
const LOGIC_FUNCTIONS = [...GATE_OPS, 'NOT'] as const;
type LogicFunction = (typeof LOGIC_FUNCTIONS)[number];

/** What the Input list offers: the PLC's inputs and the constants, not its outputs (Q0.x). A
 * diagram saved with an output read back as an input still loads and runs; its own picker keeps
 * that value listed so selecting the block doesn't silently change it. */
const INPUT_REFS = SIGNAL_REFS.filter((ref) => !ref.startsWith('Q'));

function isTimer(fbType: FbType): boolean {
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

function inputPinLocal(n: GraphNode, pin: number): Point {
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

function outputPinLocal(n: GraphNode): Point | null {
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

/** IEC duration literal for a timer's PT, e.g. T#2s, T#500ms, T#1.25s. */
function formatDuration(seconds: number): string {
  if (Number.isInteger(seconds)) return `T#${seconds}s`;
  const ms = seconds * 1000;
  if (Math.abs(ms - Math.round(ms)) < 1e-9 && seconds < 1) return `T#${Math.round(ms)}ms`;
  return `T#${seconds}s`;
}

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/** Orthogonal route from an output pin to an input pin: across, down/up at `midX`, across. When
 * the input is behind the output, it loops round instead of cutting back through the blocks. */
function wireRoute(p1: Point, p2: Point, midX: number): Point[] {
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

function nextInstanceName(graph: PlcGraph, fbType: FbType, except?: FbNode): string {
  const prefix = FB_NAME_PREFIX[fbType];
  const used = new Set(
    graph.nodes
      .filter((n): n is FbNode => n.kind === 'fb' && n !== except)
      .map((n) => n.instance.toUpperCase()),
  );
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function defaultParams(fbType: FbType): number[] {
  return new Array(fbArgLayout(fbType).numArgs.length).fill(1);
}

function newId(): string {
  return crypto.randomUUID();
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

export function openPlcEditorDialog(opts: PlcEditorOptions): void {
  const graph: PlcGraph = opts.graph ? cloneGraph(opts.graph) : { nodes: [], wires: [] };
  const isLegacy = opts.graph === null;

  let selectedNodeId: string | null = null;
  let selectedWireId: string | null = null;
  let dragNode: { id: string; dx: number; dy: number } | null = null;
  let wireDrag: { fromNode: string } | null = null;
  let placeSeq = 0; // spreads freshly-placed nodes out instead of stacking them at one point

  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const dialog = document.createElement('div');
  dialog.className = 'exportDialog plcEditorDialog';
  backdrop.appendChild(dialog);

  const header = document.createElement('div');
  header.className = 'exportDialogHeader';
  const title = document.createElement('h2');
  title.textContent = 'PLC program';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'exportDialogClose';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', () => close());
  header.append(title, closeBtn);
  dialog.appendChild(header);

  const hint = document.createElement('p');
  hint.className = 'exportDialogHint';
  hint.textContent = isLegacy
    ? 'This program predates the graphical editor and was written as text - starting from a blank diagram here; saving replaces the old text program.'
    : 'Drag from a block’s output pin (right) to another block’s input pin (left) to wire them. Click a block or wire to select it - change it in the bar below the palette, or press Delete to remove it.';
  dialog.appendChild(hint);

  const palette = document.createElement('div');
  palette.className = 'plcPalette';
  dialog.appendChild(palette);

  function paletteGroup(labelText: string): HTMLElement {
    const group = document.createElement('div');
    group.className = 'plcPaletteGroup';
    const label = document.createElement('span');
    label.className = 'plcPaletteGroupLabel';
    label.textContent = labelText;
    group.appendChild(label);
    palette.appendChild(group);
    return group;
  }

  function paletteButton(text: string, tooltip: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn plcPaletteBtn';
    btn.textContent = text;
    btn.title = tooltip;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function addNode(node: GraphNode): void {
    graph.nodes.push(node);
    select(node.id, null);
  }

  function placementSpot(column: number): Point {
    placeSeq++;
    return { x: snap(70 + column * 170 + (placeSeq % 3) * 20), y: snap(40 + (placeSeq % 12) * 30) };
  }

  const signalGroup = paletteGroup('Input');
  const signalSelect = document.createElement('select');
  for (const ref of INPUT_REFS) signalSelect.appendChild(new Option(ref, ref));
  signalGroup.append(
    signalSelect,
    paletteButton('Add', 'Add an input variable', () => {
      const { x, y } = placementSpot(0);
      addNode({ id: newId(), kind: 'signal', ref: signalSelect.value as SignalRef, x, y });
    }),
  );

  const gateGroup = paletteGroup('Logic');
  for (const op of GATE_OPS) {
    gateGroup.appendChild(
      paletteButton(`${GATE_SYMBOL[op]} ${op}`, `${op} function`, () => {
        const { x, y } = placementSpot(1);
        addNode({ id: newId(), kind: 'gate', op, x, y });
      }),
    );
  }
  gateGroup.appendChild(
    paletteButton('1○ NOT', 'NOT function (inverter)', () => {
      const { x, y } = placementSpot(1);
      addNode({ id: newId(), kind: 'not', x, y });
    }),
  );

  const fbGroup = paletteGroup('Function block');
  for (const fbType of FB_TYPES) {
    fbGroup.appendChild(
      paletteButton(fbType, FB_DESCRIPTIONS[fbType], () => {
        const { x, y } = placementSpot(2);
        addNode({
          id: newId(),
          kind: 'fb',
          fbType,
          instance: nextInstanceName(graph, fbType),
          params: defaultParams(fbType),
          x,
          y,
        });
      }),
    );
  }

  const coilGroup = paletteGroup('Output');
  const coilSelect = document.createElement('select');
  const coilAddBtn = paletteButton('Add', 'Add an output variable', () => {
    if (!coilSelect.value) return;
    const { x, y } = placementSpot(3);
    addNode({ id: newId(), kind: 'coil', target: coilSelect.value as CoilTarget, x, y });
  });
  coilGroup.append(coilSelect, coilAddBtn);

  // Properties of whatever is selected. Rebuilt only when the selection or a block's shape
  // changes - not on every render - so typing in one of its fields never loses focus.
  const propsBar = document.createElement('div');
  propsBar.className = 'plcProps';
  dialog.appendChild(propsBar);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'plcCanvasWrap';
  dialog.appendChild(canvasWrap);

  const svg = createSvgEl('svg', { class: 'plcCanvas', width: 780, height: 420 });
  canvasWrap.appendChild(svg);

  const previewLabel = document.createElement('div');
  previewLabel.className = 'inspectorSectionHeading';
  previewLabel.textContent = 'Generated program';
  dialog.appendChild(previewLabel);

  const previewBox = document.createElement('textarea');
  previewBox.className = 'plcProgramPreview';
  previewBox.readOnly = true;
  previewBox.rows = 3;
  dialog.appendChild(previewBox);

  const errorLine = document.createElement('p');
  errorLine.className = 'exportDialogHint customCompError';
  dialog.appendChild(errorLine);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'exportDialogButtons';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn';
  saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => close());
  buttonRow.append(saveBtn, cancelBtn);
  dialog.appendChild(buttonRow);

  function close(): void {
    backdrop.remove();
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('mouseup', onWindowMouseUp);
  }

  function deleteSelection(): void {
    if (selectedNodeId) {
      const id = selectedNodeId;
      graph.nodes = graph.nodes.filter((n) => n.id !== id);
      graph.wires = graph.wires.filter((w) => w.from.node !== id && w.to.node !== id);
    } else if (selectedWireId) {
      const id = selectedWireId;
      graph.wires = graph.wires.filter((w) => w.id !== id);
    } else {
      return;
    }
    select(null, null);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      close();
      return;
    }
    // Backspace in the instance-name field is editing the name, not deleting the block.
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextEntry(e.target)) {
      if (!selectedNodeId && !selectedWireId) return;
      e.preventDefault();
      deleteSelection();
    }
  }
  window.addEventListener('keydown', onKeydown);

  function svgLocalPoint(clientX: number, clientY: number): Point {
    const rect = svg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function findNode(id: string): GraphNode | undefined {
    return graph.nodes.find((n) => n.id === id);
  }

  function select(nodeId: string | null, wireId: string | null): void {
    selectedNodeId = nodeId;
    selectedWireId = wireId;
    render();
    renderProps();
  }

  /** Swaps `node` for `replacement` in place (same id, same position), keeping only the wires
   * that still have a pin to land on. */
  function replaceNode(node: GraphNode, replacement: GraphNode): void {
    const idx = graph.nodes.indexOf(node);
    if (idx >= 0) graph.nodes[idx] = replacement;
    dropOrphanWires(replacement);
  }

  function dropOrphanWires(node: GraphNode): void {
    const pins = inputPinCount(node);
    const hasOutput = outputPinLocal(node) !== null;
    graph.wires = graph.wires.filter(
      (w) =>
        !(w.to.node === node.id && w.to.pin >= pins) && !(w.from.node === node.id && !hasOutput),
    );
  }

  function onWindowMouseMove(e: MouseEvent): void {
    if (dragNode) {
      const node = findNode(dragNode.id);
      if (!node) return;
      const p = svgLocalPoint(e.clientX, e.clientY);
      const nx = Math.max(0, snap(p.x - dragNode.dx));
      const ny = Math.max(0, snap(p.y - dragNode.dy));
      if (nx === node.x && ny === node.y) return;
      node.x = nx;
      node.y = ny;
      render();
    } else if (wireDrag) {
      renderGhost(svgLocalPoint(e.clientX, e.clientY));
    }
  }
  function onWindowMouseUp(e: MouseEvent): void {
    if (dragNode) {
      dragNode = null;
    } else if (wireDrag) {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const pinEl = target?.closest('[data-pin-dir="in"]') as SVGElement | null;
      const fromNode = wireDrag.fromNode;
      wireDrag = null;
      ghost.setAttribute('d', '');
      if (pinEl) {
        const toNode = pinEl.dataset.pinNode as string;
        const toPin = Number(pinEl.dataset.pinIndex);
        if (toNode !== fromNode) {
          graph.wires = graph.wires.filter((w) => !(w.to.node === toNode && w.to.pin === toPin));
          graph.wires.push({
            id: newId(),
            from: { node: fromNode },
            to: { node: toNode, pin: toPin },
          });
        }
      }
      render();
    }
  }
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);

  const ghost = createSvgEl('path', { class: 'plcWireGhost', fill: 'none' });

  function renderGhost(to: Point): void {
    if (!wireDrag) return;
    const node = findNode(wireDrag.fromNode);
    if (!node) return;
    const out = outputPinLocal(node);
    if (!out) return;
    const p1 = { x: node.x + out.x, y: node.y + out.y };
    ghost.setAttribute('d', pathFromPoints(wireRoute(p1, to, snap((p1.x + to.x) / 2))));
  }

  function line(g: SVGElement, x1: number, y1: number, x2: number, y2: number, cls?: string): void {
    g.appendChild(createSvgEl('line', { x1, y1, x2, y2, class: cls ?? 'plcStroke' }));
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

  /** A pin is a small visible dot plus a larger invisible circle on top that actually catches the
   * mouse, so it doesn't take pixel-perfect aim to start or finish a wire. */
  function pin(
    g: SVGElement,
    nodeId: string,
    dir: 'in' | 'out',
    index: number,
    pos: Point,
    open: boolean,
  ): void {
    g.appendChild(
      createSvgEl('circle', {
        cx: pos.x,
        cy: pos.y,
        r: 3,
        class: open ? 'plcPin plcPinOpen' : 'plcPin',
      }),
    );
    const hit = createSvgEl('circle', { cx: pos.x, cy: pos.y, r: 7, class: 'plcPinHit' });
    hit.dataset.pinNode = nodeId;
    hit.dataset.pinDir = dir;
    hit.dataset.pinIndex = String(index);
    if (dir === 'out') {
      hit.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        wireDrag = { fromNode: nodeId };
      });
    }
    g.appendChild(hit);
  }

  function renderNodeBody(g: SVGElement, n: GraphNode): void {
    const { w, h } = boxSize(n);
    const left = n.x - w / 2;
    const top = n.y - h / 2;

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
        line(g, n.x + w / 2 - STUB * 2, n.y, n.x + w / 2, n.y);
        text(g, n.x + w / 2 - STUB * 2 - 3, n.y + 4, n.ref, {
          'text-anchor': 'end',
          class: 'plcVarText',
        });
        return;
      }
      case 'coil': {
        // An output variable: a line in from the pin, then its name.
        line(g, left, n.y, left + STUB * 2, n.y);
        text(g, left + STUB * 2 + 3, n.y + 4, n.target, { class: 'plcVarText' });
        return;
      }
      case 'not':
      case 'gate': {
        g.appendChild(
          createSvgEl('rect', { x: left, y: top, width: w, height: h, class: 'plcBox' }),
        );
        text(g, n.x, top + 13, n.kind === 'not' ? '1' : GATE_SYMBOL[n.op], {
          'text-anchor': 'middle',
          'font-size': 12,
          class: 'plcBoxTitle',
        });
        const count = inputPinCount(n);
        for (let p = 0; p < count; p++) {
          const pl = inputPinLocal(n, p);
          line(g, n.x + pl.x, n.y + pl.y, left, n.y + pl.y);
        }
        if (n.kind === 'not') {
          // Negated output: the IEC inversion circle on the box edge.
          g.appendChild(
            createSvgEl('circle', { cx: left + w + 4, cy: n.y, r: 4, class: 'plcNegation' }),
          );
          line(g, left + w + 8, n.y, n.x + w / 2 + 2 * STUB, n.y);
        } else {
          line(g, left + w, n.y, left + w + STUB, n.y);
        }
        return;
      }
      case 'fb': {
        g.appendChild(
          createSvgEl('rect', { x: left, y: top, width: w, height: h, class: 'plcBox' }),
        );
        text(g, n.x, top - 5, n.instance, { 'text-anchor': 'middle', class: 'plcInstanceName' });
        text(g, n.x, top + 14, n.fbType, {
          'text-anchor': 'middle',
          'font-weight': 'bold',
          class: 'plcBoxTitle',
        });
        const { numArgs } = fbArgLayout(n.fbType);
        FB_INPUT_NAMES[n.fbType].forEach((name, argIdx) => {
          const y = n.y + fbRowY(n, argIdx);
          line(g, left - STUB, y, left, y);
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
              {
                'text-anchor': 'end',
                class: 'plcLiteral',
              },
            );
          }
        });
        FB_OUTPUT_NAMES[n.fbType].forEach((name, row) => {
          const y = n.y + fbRowY(n, row);
          line(g, left + w, y, left + w + STUB, y, row === 0 ? 'plcStroke' : 'plcStroke plcUnused');
          text(g, left + w - 4, y + 4, name, {
            'text-anchor': 'end',
            'font-size': 10,
            class: 'plcParamName',
          });
        });
        return;
      }
    }
  }

  function render(): void {
    svg.replaceChildren();

    const wiredPins = new Set(graph.wires.map((w) => `${w.to.node}:${w.to.pin}`));

    // Wires leaving the same output share one vertical run (at the nearest target's midpoint),
    // with a junction dot wherever a branch leaves it - how a fanned-out signal is drawn by hand.
    const bySource = new Map<string, typeof graph.wires>();
    for (const w of graph.wires) {
      const list = bySource.get(w.from.node) ?? [];
      list.push(w);
      bySource.set(w.from.node, list);
    }
    for (const [sourceId, wires] of bySource) {
      const from = findNode(sourceId);
      const out = from && outputPinLocal(from);
      if (!from || !out) continue;
      const p1 = { x: from.x + out.x, y: from.y + out.y };
      const ends: Point[] = [];
      for (const w of wires) {
        const to = findNode(w.to.node);
        if (!to) continue;
        const inp = inputPinLocal(to, w.to.pin);
        ends.push({ x: to.x + inp.x, y: to.y + inp.y });
      }
      const forward = ends.filter((p) => p.x - p1.x >= 2 * GRID);
      const midX =
        forward.length > 0 ? Math.min(...forward.map((p) => snap((p1.x + p.x) / 2))) : p1.x;

      wires.forEach((w) => {
        const to = findNode(w.to.node);
        if (!to) return;
        const inp = inputPinLocal(to, w.to.pin);
        const d = pathFromPoints(wireRoute(p1, { x: to.x + inp.x, y: to.y + inp.y }, midX));
        const hit = createSvgEl('path', { d, class: 'plcWireHit', fill: 'none' });
        hit.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          select(null, w.id);
        });
        svg.appendChild(hit);
        svg.appendChild(
          createSvgEl('path', {
            d,
            class: w.id === selectedWireId ? 'plcWire plcWireSelected' : 'plcWire',
            fill: 'none',
          }),
        );
      });

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
              createSvgEl('circle', { cx: midX, cy: y, r: 2.5, class: 'plcJunction' }),
            );
          }
        }
      }
    }

    for (const n of graph.nodes) {
      const selected = n.id === selectedNodeId;
      const g = createSvgEl('g', {
        class: `plcNode plcNode-${n.kind}${selected ? ' plcNodeSelected' : ''}`,
      });
      g.dataset.nodeId = n.id;
      renderNodeBody(g, n);

      const count = inputPinCount(n);
      for (let p = 0; p < count; p++) {
        const local = inputPinLocal(n, p);
        pin(
          g,
          n.id,
          'in',
          p,
          { x: n.x + local.x, y: n.y + local.y },
          !wiredPins.has(`${n.id}:${p}`),
        );
      }
      const out = outputPinLocal(n);
      if (out) pin(g, n.id, 'out', 0, { x: n.x + out.x, y: n.y + out.y }, false);

      g.addEventListener('mousedown', (e) => {
        if ((e.target as Element).classList.contains('plcPinHit')) return;
        e.stopPropagation();
        const p = svgLocalPoint(e.clientX, e.clientY);
        dragNode = { id: n.id, dx: p.x - n.x, dy: p.y - n.y };
        if (selectedNodeId !== n.id) select(n.id, null);
      });
      g.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        propsBar.querySelector<HTMLElement>('input, select')?.focus();
      });

      svg.appendChild(g);
    }

    svg.appendChild(ghost);

    // Free coil targets only, so it's harder to accidentally create the "two coils on one
    // output" error the compiler already rejects.
    const used = usedCoilTargets();
    const previous = coilSelect.value;
    coilSelect.replaceChildren();
    for (const target of COIL_TARGETS) {
      if (used.has(target)) continue;
      coilSelect.appendChild(new Option(target, target));
    }
    if ([...coilSelect.options].some((o) => o.value === previous)) coilSelect.value = previous;
    coilAddBtn.disabled = coilSelect.options.length === 0;

    const compiled = compileGraph(graph);
    previewBox.value = compiled.error ? '' : graphToText(graph);
    errorLine.textContent = compiled.error ?? '';
  }

  function usedCoilTargets(except?: GraphNode): Set<CoilTarget> {
    return new Set(
      graph.nodes
        .filter((n): n is Extract<GraphNode, { kind: 'coil' }> => n.kind === 'coil' && n !== except)
        .map((n) => n.target),
    );
  }

  function field(labelText: string, control: HTMLElement): void {
    const label = document.createElement('label');
    label.className = 'plcPropsField';
    const span = document.createElement('span');
    span.textContent = labelText;
    label.append(span, control);
    propsBar.appendChild(label);
  }

  function selectControl<T extends string>(
    options: readonly T[],
    value: T,
    onChange: (v: T) => void,
    labelFor: (v: T) => string = (v) => v,
  ): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = 'plcPropsControl';
    for (const o of options) sel.appendChild(new Option(labelFor(o), o));
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value as T));
    return sel;
  }

  function numberControl(
    value: number,
    attrs: { min: number; max?: number; step: number },
    onChange: (v: number) => void,
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'plcPropsControl plcPropsNumber';
    input.min = String(attrs.min);
    if (attrs.max !== undefined) input.max = String(attrs.max);
    input.step = String(attrs.step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (input.value === '' || !Number.isFinite(v)) return;
      onChange(v);
    });
    return input;
  }

  function renderProps(): void {
    propsBar.replaceChildren();
    const node = selectedNodeId ? findNode(selectedNodeId) : undefined;

    const heading = document.createElement('span');
    heading.className = 'plcPropsHeading';
    propsBar.appendChild(heading);

    if (!node) {
      if (selectedWireId) {
        heading.textContent = 'Wire';
      } else {
        heading.textContent = 'Click a block to edit it';
        propsBar.classList.add('plcPropsEmpty');
        return;
      }
    }
    propsBar.classList.remove('plcPropsEmpty');

    if (node) {
      switch (node.kind) {
        case 'signal':
          heading.textContent = 'Input';
          field(
            'Variable',
            selectControl(
              INPUT_REFS.includes(node.ref) ? INPUT_REFS : [node.ref, ...INPUT_REFS],
              node.ref,
              (v) => {
                node.ref = v;
                render();
              },
            ),
          );
          break;
        case 'coil': {
          heading.textContent = 'Output';
          const free = COIL_TARGETS.filter(
            (t) => t === node.target || !usedCoilTargets(node).has(t),
          );
          field(
            'Variable',
            selectControl(free, node.target, (v) => {
              node.target = v;
              render();
            }),
          );
          break;
        }
        case 'not':
        case 'gate': {
          heading.textContent = 'Logic';
          const current: LogicFunction = node.kind === 'not' ? 'NOT' : node.op;
          field(
            'Function',
            selectControl(
              LOGIC_FUNCTIONS,
              current,
              (v) => {
                const base = { id: node.id, x: node.x, y: node.y };
                const inputs = node.kind === 'gate' ? node.inputs : undefined;
                replaceNode(
                  node,
                  v === 'NOT'
                    ? { ...base, kind: 'not' }
                    : { ...base, kind: 'gate', op: v, ...(inputs ? { inputs } : {}) },
                );
                render();
                renderProps();
              },
              (v) => (v === 'NOT' ? '1○ NOT' : `${GATE_SYMBOL[v]} ${v}`),
            ),
          );
          if (node.kind === 'gate' && node.op !== 'XOR') {
            field(
              'Inputs',
              numberControl(
                gateInputCount(node),
                { min: MIN_GATE_INPUTS, max: MAX_GATE_INPUTS, step: 1 },
                (v) => {
                  node.inputs = Math.max(MIN_GATE_INPUTS, Math.min(MAX_GATE_INPUTS, Math.round(v)));
                  dropOrphanWires(node);
                  render();
                },
              ),
            );
          }
          break;
        }
        case 'fb': {
          heading.textContent = 'Function block';
          field(
            'Type',
            selectControl(
              FB_TYPES,
              node.fbType,
              (v) => {
                const oldPrefix = FB_NAME_PREFIX[node.fbType];
                const oldNumCount = fbArgLayout(node.fbType).numArgs.length;
                node.fbType = v;
                // An auto-generated name follows the type (T1 -> C1 for a timer turned counter);
                // a name the user typed themselves is left alone.
                if (
                  FB_NAME_PREFIX[v] !== oldPrefix &&
                  new RegExp(`^${oldPrefix}\\d+$`, 'i').test(node.instance)
                ) {
                  node.instance = nextInstanceName(graph, v, node);
                }
                if (fbArgLayout(v).numArgs.length !== oldNumCount) node.params = defaultParams(v);
                dropOrphanWires(node);
                render();
                renderProps();
              },
              (v) => `${v} – ${FB_DESCRIPTIONS[v]}`,
            ),
          );
          const nameInput = document.createElement('input');
          nameInput.type = 'text';
          nameInput.className = 'plcPropsControl plcPropsName';
          nameInput.value = node.instance;
          nameInput.addEventListener('input', () => {
            node.instance = nameInput.value.trim();
            render();
          });
          field('Name', nameInput);
          fbArgLayout(node.fbType).numArgs.forEach((argIdx, i) => {
            const timer = isTimer(node.fbType);
            const name = FB_INPUT_NAMES[node.fbType][argIdx] ?? '';
            field(
              timer ? `${name} (s)` : name,
              numberControl(node.params[i] ?? 0, { min: 0, step: timer ? 0.1 : 1 }, (v) => {
                node.params[i] = timer ? Math.max(0, v) : Math.max(0, Math.round(v));
                render();
              }),
            );
          });
          break;
        }
      }
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn plcPaletteBtn plcPropsDelete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.title = 'Delete (Del)';
    deleteBtn.addEventListener('click', () => deleteSelection());
    propsBar.appendChild(deleteBtn);
  }

  svg.addEventListener('mousedown', () => {
    if (selectedNodeId || selectedWireId) select(null, null);
  });

  saveBtn.addEventListener('click', () => {
    const compiled = compileGraph(graph);
    if (compiled.error) return;
    opts.onSave(cloneGraph(graph));
    close();
  });

  render();
  renderProps();
  document.body.appendChild(backdrop);
}
