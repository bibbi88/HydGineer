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
  type GraphNode,
  type PlcGraph,
  type SignalRef,
} from '../sim/plcGraph';
import { type FbType } from '../sim/plcProgram';
import { createSvgEl } from '../components/shared/svgHelpers';
import { pathFromPoints } from '../geometry/routing';
import {
  drawDiagram,
  FB_INPUT_NAMES,
  GATE_SYMBOL,
  isTimer,
  outputPinLocal,
  snap,
  wireRoute,
  type Point,
} from './plcDiagram';

export interface PlcEditorOptions {
  /** null when this PLC was saved before the graphical editor existed and only has legacy text -
   * the dialog starts from a blank diagram rather than guessing one back out of that text. */
  graph: PlcGraph | null;
  onSave(graph: PlcGraph): void;
}

type FbNode = Extract<GraphNode, { kind: 'fb' }>;

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

/** Which choices the "Function" picker offers a logic block - NOT is a different node kind, but
 * to the user it's just another logic function, so switching to and from it is allowed. */
const LOGIC_FUNCTIONS = [...GATE_OPS, 'NOT'] as const;
type LogicFunction = (typeof LOGIC_FUNCTIONS)[number];

/** What the Input list offers: the PLC's inputs and the constants, not its outputs (Q0.x). A
 * diagram saved with an output read back as an input still loads and runs; its own picker keeps
 * that value listed so selecting the block doesn't silently change it. */
const INPUT_REFS = SIGNAL_REFS.filter((ref) => !ref.startsWith('Q'));

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

  function render(): void {
    drawDiagram(svg, graph, {
      selectedNodeId,
      selectedWireId,
      onWireMouseDown(w, e) {
        e.stopPropagation();
        select(null, w.id);
      },
      onOutPinMouseDown(n, e) {
        e.stopPropagation();
        wireDrag = { fromNode: n.id };
      },
      onNodeMouseDown(n, e) {
        e.stopPropagation();
        const p = svgLocalPoint(e.clientX, e.clientY);
        dragNode = { id: n.id, dx: p.x - n.x, dy: p.y - n.y };
        if (selectedNodeId !== n.id) select(n.id, null);
      },
      onNodeDblClick(_n, e) {
        e.stopPropagation();
        propsBar.querySelector<HTMLElement>('input, select')?.focus();
      },
    });

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
