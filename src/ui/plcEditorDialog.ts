import {
  cloneGraph,
  compileGraph,
  graphToText,
  inputPinCount,
  COIL_TARGETS,
  FB_TYPES,
  GATE_OPS,
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

/** Per-fb-type input pin names, purely cosmetic (matches plcProgram.ts's own doc comment on each
 * block's arguments) - the compiler only cares about position, not these labels. */
const FB_PIN_NAMES: Record<FbType, string[]> = {
  TON: ['IN'],
  TOF: ['IN'],
  TP: ['IN'],
  CTU: ['CU', 'R'],
  CTD: ['CD', 'LD'],
  SR: ['S', 'R1'],
  RS: ['S', 'R1'],
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

function nodeDims(n: GraphNode): { w: number; h: number } {
  switch (n.kind) {
    case 'signal':
      return { w: 92, h: 28 };
    case 'not':
      return { w: 56, h: 32 };
    case 'gate':
      return { w: 64, h: 46 };
    case 'coil':
      return { w: 84, h: 32 };
    case 'fb':
      return { w: 132, h: Math.max(inputPinCount(n), 1) * 22 + 26 };
  }
}

function inputPinLocal(n: GraphNode, pin: number): { x: number; y: number } {
  const { w, h } = nodeDims(n);
  const count = inputPinCount(n);
  const extra = n.kind === 'fb' ? 8 : 0; // leave room above the pins for the instance name box
  const usableH = h - extra;
  const spacing = usableH / (count + 1);
  return { x: -w / 2, y: -h / 2 + extra + spacing * (pin + 1) };
}

function outputPinLocal(n: GraphNode): { x: number; y: number } | null {
  if (n.kind === 'coil') return null;
  const { w } = nodeDims(n);
  return { x: w / 2, y: 0 };
}

function nextInstanceName(graph: PlcGraph, fbType: FbType): string {
  const prefix = FB_NAME_PREFIX[fbType];
  const used = new Set(
    graph.nodes
      .filter((n) => n.kind === 'fb')
      .map((n) => (n as Extract<GraphNode, { kind: 'fb' }>).instance),
  );
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function newId(): string {
  return crypto.randomUUID();
}

export function openPlcEditorDialog(opts: PlcEditorOptions): void {
  const graph: PlcGraph = opts.graph ? cloneGraph(opts.graph) : { nodes: [], wires: [] };
  const isLegacy = opts.graph === null;

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
    : 'Drag from a block’s right-hand dot to another block’s left-hand dot to wire them. Drag a block to move it, click its ✕ to remove it, or click a wire and press Delete.';
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

  function addNode(node: GraphNode): void {
    graph.nodes.push(node);
    render();
  }

  function placementSpot(): { x: number; y: number } {
    placeSeq++;
    return { x: 60 + (placeSeq % 5) * 40, y: 30 + placeSeq * 26 };
  }

  const signalGroup = paletteGroup('Signal');
  const signalSelect = document.createElement('select');
  for (const ref of SIGNAL_REFS) {
    const opt = document.createElement('option');
    opt.value = ref;
    opt.textContent = ref;
    signalSelect.appendChild(opt);
  }
  const signalAddBtn = document.createElement('button');
  signalAddBtn.type = 'button';
  signalAddBtn.className = 'btn plcPaletteBtn';
  signalAddBtn.textContent = 'Add';
  signalAddBtn.addEventListener('click', () => {
    const { x, y } = placementSpot();
    addNode({ id: newId(), kind: 'signal', ref: signalSelect.value as SignalRef, x, y });
  });
  signalGroup.append(signalSelect, signalAddBtn);

  const gateGroup = paletteGroup('Gate');
  for (const op of GATE_OPS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn plcPaletteBtn';
    btn.textContent = op;
    btn.addEventListener('click', () => {
      const { x, y } = placementSpot();
      addNode({ id: newId(), kind: 'gate', op: op as GateOp, x: x + 200, y });
    });
    gateGroup.appendChild(btn);
  }
  const notBtn = document.createElement('button');
  notBtn.type = 'button';
  notBtn.className = 'btn plcPaletteBtn';
  notBtn.textContent = 'NOT';
  notBtn.addEventListener('click', () => {
    const { x, y } = placementSpot();
    addNode({ id: newId(), kind: 'not', x: x + 200, y });
  });
  gateGroup.appendChild(notBtn);

  const fbGroup = paletteGroup('Function block');
  for (const fbType of FB_TYPES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn plcPaletteBtn';
    btn.textContent = fbType;
    btn.addEventListener('click', () => {
      const { x, y } = placementSpot();
      const numCount = FB_ARG_SHAPE[fbType].filter((s) => s === 'num').length;
      addNode({
        id: newId(),
        kind: 'fb',
        fbType,
        instance: nextInstanceName(graph, fbType),
        params: new Array(numCount).fill(fbType.startsWith('C') ? 1 : 1),
        x: x + 380,
        y,
      });
    });
    fbGroup.appendChild(btn);
  }

  const coilGroup = paletteGroup('Coil');
  const coilSelect = document.createElement('select');
  const coilAddBtn = document.createElement('button');
  coilAddBtn.type = 'button';
  coilAddBtn.className = 'btn plcPaletteBtn';
  coilAddBtn.textContent = 'Add';
  coilAddBtn.addEventListener('click', () => {
    if (!coilSelect.value) return;
    const { x, y } = placementSpot();
    addNode({ id: newId(), kind: 'coil', target: coilSelect.value as CoilTarget, x: x + 620, y });
  });
  coilGroup.append(coilSelect, coilAddBtn);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'plcCanvasWrap';
  dialog.appendChild(canvasWrap);

  const svg = createSvgEl('svg', { class: 'plcCanvas', width: 780, height: 460 });
  canvasWrap.appendChild(svg);

  const overlayLayer = document.createElement('div');
  overlayLayer.className = 'plcOverlayLayer';
  canvasWrap.appendChild(overlayLayer);

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
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWireId) {
      e.preventDefault();
      graph.wires = graph.wires.filter((w) => w.id !== selectedWireId);
      selectedWireId = null;
      render();
    }
  }
  window.addEventListener('keydown', onKeydown);

  function svgLocalPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function findNode(id: string): GraphNode | undefined {
    return graph.nodes.find((n) => n.id === id);
  }

  function removeNode(id: string): void {
    graph.nodes = graph.nodes.filter((n) => n.id !== id);
    graph.wires = graph.wires.filter((w) => w.from.node !== id && w.to.node !== id);
    render();
  }

  function onWindowMouseMove(e: MouseEvent): void {
    if (dragNode) {
      const node = findNode(dragNode.id);
      if (!node) return;
      const p = svgLocalPoint(e.clientX, e.clientY);
      node.x = p.x - dragNode.dx;
      node.y = p.y - dragNode.dy;
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

  function renderGhost(to: { x: number; y: number }): void {
    if (!wireDrag) return;
    const node = findNode(wireDrag.fromNode);
    if (!node) return;
    const out = outputPinLocal(node);
    if (!out) return;
    ghost.setAttribute('d', pathFromPoints([{ x: node.x + out.x, y: node.y + out.y }, to]));
  }

  function pinCircle(
    nodeId: string,
    dir: 'in' | 'out',
    pin: number,
    pos: { x: number; y: number },
  ): SVGCircleElement {
    const c = createSvgEl('circle', { cx: pos.x, cy: pos.y, r: 5, class: 'plcPin' });
    c.dataset.pinNode = nodeId;
    c.dataset.pinDir = dir;
    c.dataset.pinIndex = String(pin);
    if (dir === 'out') {
      c.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        wireDrag = { fromNode: nodeId };
      });
    }
    return c;
  }

  function nodeLabelText(n: GraphNode): string {
    switch (n.kind) {
      case 'signal':
        return n.ref;
      case 'gate':
        return n.op;
      case 'not':
        return 'NOT';
      case 'coil':
        return `( ${n.target} )`;
      case 'fb':
        return n.fbType;
    }
  }

  function renderOverlayInputs(): void {
    overlayLayer.replaceChildren();
    for (const n of graph.nodes) {
      if (n.kind !== 'fb') continue;
      const { w } = nodeDims(n);
      const box = document.createElement('div');
      box.className = 'plcOverlayBox';
      box.style.left = `${n.x - w / 2 + 4}px`;
      box.style.top = `${n.y - nodeDims(n).h / 2 + 2}px`;
      box.style.width = `${w - 8}px`;

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'plcOverlayName';
      nameInput.value = n.instance;
      nameInput.addEventListener('change', () => {
        n.instance = nameInput.value.trim() || n.instance;
        render();
      });
      box.appendChild(nameInput);
      overlayLayer.appendChild(box);

      const { numArgs } = fbNumArgLayout(n.fbType);
      if (numArgs.length > 0) {
        const paramsBox = document.createElement('div');
        paramsBox.className = 'plcOverlayBox plcOverlayParams';
        paramsBox.style.left = `${n.x - w / 2 + 4}px`;
        paramsBox.style.top = `${n.y + nodeDims(n).h / 2 - 20}px`;
        paramsBox.style.width = `${w - 8}px`;
        numArgs.forEach((_, i) => {
          const paramInput = document.createElement('input');
          paramInput.type = 'number';
          paramInput.step = '0.1';
          paramInput.className = 'plcOverlayParam';
          paramInput.value = String(n.params[i] ?? 0);
          paramInput.addEventListener('change', () => {
            n.params[i] = Number(paramInput.value) || 0;
            render();
          });
          paramsBox.appendChild(paramInput);
        });
        overlayLayer.appendChild(paramsBox);
      }
    }
  }

  function fbNumArgLayout(fbType: FbType): { numArgs: number[] } {
    const shape = FB_ARG_SHAPE[fbType];
    const numArgs: number[] = [];
    shape.forEach((s, i) => {
      if (s === 'num') numArgs.push(i);
    });
    return { numArgs };
  }

  function render(): void {
    svg.replaceChildren();
    svg.appendChild(ghost);

    for (const w of graph.wires) {
      const from = findNode(w.from.node);
      const to = findNode(w.to.node);
      if (!from || !to) continue;
      const out = outputPinLocal(from);
      const inp = inputPinLocal(to, w.to.pin);
      if (!out) continue;
      const p1 = { x: from.x + out.x, y: from.y + out.y };
      const p2 = { x: to.x + inp.x, y: to.y + inp.y };
      const hit = createSvgEl('path', {
        d: pathFromPoints([p1, p2]),
        class: 'plcWireHit',
        fill: 'none',
      });
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedWireId = w.id;
        render();
      });
      svg.appendChild(hit);
      const visible = createSvgEl('path', {
        d: pathFromPoints([p1, p2]),
        class: w.id === selectedWireId ? 'plcWire plcWireSelected' : 'plcWire',
        fill: 'none',
      });
      svg.appendChild(visible);
    }

    for (const n of graph.nodes) {
      const { w: nw, h: nh } = nodeDims(n);
      const g = createSvgEl('g', { class: `plcNode plcNode-${n.kind}` });
      const rect = createSvgEl('rect', {
        x: n.x - nw / 2,
        y: n.y - nh / 2,
        width: nw,
        height: nh,
        rx: 6,
      });
      g.appendChild(rect);

      if (n.kind !== 'fb') {
        const label = createSvgEl('text', {
          x: n.x,
          y: n.y + 4,
          'text-anchor': 'middle',
          'font-size': 11,
        });
        label.textContent = nodeLabelText(n);
        g.appendChild(label);
      } else {
        const typeLabel = createSvgEl('text', {
          x: n.x,
          y: n.y - nh / 2 + 34,
          'text-anchor': 'middle',
          'font-size': 10,
          fill: '#666',
        });
        typeLabel.textContent = n.fbType;
        g.appendChild(typeLabel);
      }

      const count = inputPinCount(n);
      const names = n.kind === 'fb' ? FB_PIN_NAMES[n.fbType] : null;
      for (let pin = 0; pin < count; pin++) {
        const local = inputPinLocal(n, pin);
        g.appendChild(pinCircle(n.id, 'in', pin, { x: n.x + local.x, y: n.y + local.y }));
        if (names) {
          const pl = createSvgEl('text', {
            x: n.x + local.x + 8,
            y: n.y + local.y - 4,
            'font-size': 9,
            fill: '#666',
          });
          pl.textContent = names[pin] ?? '';
          g.appendChild(pl);
        }
      }
      const out = outputPinLocal(n);
      if (out) g.appendChild(pinCircle(n.id, 'out', 0, { x: n.x + out.x, y: n.y + out.y }));

      const removeBtn = createSvgEl('text', {
        x: n.x + nw / 2 - 2,
        y: n.y - nh / 2 + 10,
        'text-anchor': 'end',
        'font-size': 11,
        class: 'plcNodeRemove',
      });
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        removeNode(n.id);
      });
      g.appendChild(removeBtn);

      g.addEventListener('mousedown', (e) => {
        const t = e.target as Element;
        if (t.classList.contains('plcPin') || t.classList.contains('plcNodeRemove')) return;
        e.stopPropagation();
        const p = svgLocalPoint(e.clientX, e.clientY);
        dragNode = { id: n.id, dx: p.x - n.x, dy: p.y - n.y };
      });

      svg.appendChild(g);
    }

    renderOverlayInputs();

    // Free coil targets only, so it's harder to accidentally create the "two coils on one
    // output" error the compiler already rejects.
    const used = new Set(
      graph.nodes
        .filter((n): n is Extract<GraphNode, { kind: 'coil' }> => n.kind === 'coil')
        .map((n) => n.target),
    );
    coilSelect.replaceChildren();
    for (const target of COIL_TARGETS) {
      if (used.has(target) && target !== coilSelect.value) continue;
      const opt = document.createElement('option');
      opt.value = target;
      opt.textContent = target;
      coilSelect.appendChild(opt);
    }
    coilAddBtn.disabled = coilSelect.options.length === 0;

    const compiled = compileGraph(graph);
    previewBox.value = compiled.error ? '' : graphToText(graph);
    errorLine.textContent = compiled.error ?? '';
  }

  svg.addEventListener('click', () => {
    if (selectedWireId) {
      selectedWireId = null;
      render();
    }
  });

  saveBtn.addEventListener('click', () => {
    const compiled = compileGraph(graph);
    if (compiled.error) return;
    opts.onSave(cloneGraph(graph));
    close();
  });

  render();
  document.body.appendChild(backdrop);
}
