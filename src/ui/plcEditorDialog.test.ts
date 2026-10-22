import { afterEach, describe, expect, it } from 'vitest';
import { openPlcEditorDialog } from './plcEditorDialog';
import type { PlcGraph } from '../sim/plcGraph';

/** I0.0 and I0.1 into an AND, into a TON, into Q0.0. */
function sampleGraph(): PlcGraph {
  return {
    nodes: [
      { id: 'i0', kind: 'signal', ref: 'I0.0', x: 70, y: 60 },
      { id: 'i1', kind: 'signal', ref: 'I0.1', x: 70, y: 120 },
      { id: 'and', kind: 'gate', op: 'AND', x: 230, y: 90 },
      { id: 'ton', kind: 'fb', fbType: 'TON', instance: 'T1', params: [2], x: 420, y: 90 },
      { id: 'q0', kind: 'coil', target: 'Q0.0', x: 600, y: 90 },
    ],
    wires: [
      { id: 'w1', from: { node: 'i0' }, to: { node: 'and', pin: 0 } },
      { id: 'w2', from: { node: 'i1' }, to: { node: 'and', pin: 1 } },
      { id: 'w3', from: { node: 'and' }, to: { node: 'ton', pin: 0 } },
      { id: 'w4', from: { node: 'ton' }, to: { node: 'q0', pin: 0 } },
    ],
  };
}

function open(graph: PlcGraph = sampleGraph()): { saved: () => PlcGraph | null } {
  let saved: PlcGraph | null = null;
  openPlcEditorDialog({ graph, onSave: (g) => (saved = g) });
  return { saved: () => saved };
}

function selectNode(id: string): void {
  document
    .querySelector(`[data-node-id="${id}"] .plcNodeHit`)
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  window.dispatchEvent(new MouseEvent('mouseup'));
}

function nodeIds(): string[] {
  return Array.from(document.querySelectorAll<SVGElement>('.plcNode')).map(
    (g) => g.dataset.nodeId ?? '',
  );
}

function wireCount(): number {
  return document.querySelectorAll('.plcWire').length;
}

function program(): string {
  return document.querySelector<HTMLTextAreaElement>('.plcProgramPreview')?.value ?? '';
}

function errorText(): string {
  return document.querySelector('.customCompError')?.textContent ?? '';
}

function propsSelect(): HTMLSelectElement {
  return document.querySelector('.plcProps select') as HTMLSelectElement;
}

function change(el: HTMLSelectElement | HTMLInputElement, value: string, event = 'change'): void {
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

function pressKey(key: string, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('PLC editor: deleting', () => {
  afterEach(() => document.body.replaceChildren());

  it('deletes the selected block with the Delete key, taking its wires with it', () => {
    open();
    selectNode('and');
    pressKey('Delete');

    expect(nodeIds()).not.toContain('and');
    expect(nodeIds()).toHaveLength(4);
    // w1, w2 and w3 all touched the AND; only TON -> Q0.0 survives.
    expect(wireCount()).toBe(1);
  });

  it('deletes the selected block with the Delete button', () => {
    open();
    selectNode('q0');
    (document.querySelector('.plcPropsDelete') as HTMLButtonElement).click();

    expect(nodeIds()).toEqual(['i0', 'i1', 'and', 'ton']);
  });

  it('does nothing on Delete when nothing is selected', () => {
    open();
    pressKey('Delete');
    expect(nodeIds()).toHaveLength(5);
  });

  it('does not delete the block while Backspace is editing its name', () => {
    open();
    selectNode('ton');
    const name = document.querySelector('.plcPropsName') as HTMLInputElement;
    pressKey('Backspace', name);

    expect(nodeIds()).toContain('ton');
  });

  it('does not start dragging after the block under the pointer is deleted', () => {
    open();
    selectNode('i0');
    pressKey('Delete');
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 400 }));
    window.dispatchEvent(new MouseEvent('mouseup'));

    expect(nodeIds()).toHaveLength(4);
  });
});

describe('PLC editor: editing a block', () => {
  afterEach(() => document.body.replaceChildren());

  it('changes a gate’s function', () => {
    open();
    selectNode('and');
    change(propsSelect(), 'OR');

    expect(program()).toBe('T1 = TON(I0.0 | I0.1, 2)\nQ0.0 = T1.Q');
  });

  it('turns a gate into NOT, keeping the wire on its first input only', () => {
    open();
    selectNode('and');
    change(propsSelect(), 'NOT');

    expect(program()).toBe('T1 = TON(!I0.0, 2)\nQ0.0 = T1.Q');
    expect(wireCount()).toBe(3);
  });

  it('adds inputs to a gate, and reports them until they are wired', () => {
    open();
    selectNode('and');
    const inputs = document.querySelector('.plcProps input[type=number]') as HTMLInputElement;
    change(inputs, '3', 'input');

    expect(document.querySelectorAll('[data-node-id="and"] [data-pin-dir="in"]')).toHaveLength(3);
    expect(errorText()).toBe('An AND block is missing an input');
  });

  it('changes a function block’s type, renaming an automatic name and keeping a typed one', () => {
    open();
    selectNode('ton');
    change(propsSelect(), 'CTU');

    const name = document.querySelector('.plcPropsName') as HTMLInputElement;
    expect(name.value).toBe('C1');
    // CTU's reset input is new and unwired.
    expect(errorText()).toBe('C1 is missing an input');

    change(name, 'COUNT', 'input');
    change(propsSelect(), 'TOF');
    expect((document.querySelector('.plcPropsName') as HTMLInputElement).value).toBe('COUNT');
    expect(program()).toBe('COUNT = TOF(I0.0 & I0.1, 2)\nQ0.0 = COUNT.Q');
  });

  it('drops the wire on an input the new block type no longer has', () => {
    const graph = sampleGraph();
    graph.nodes[3] = {
      id: 'ton',
      kind: 'fb',
      fbType: 'SR',
      instance: 'M1',
      params: [],
      x: 420,
      y: 90,
    };
    graph.wires.push({ id: 'w5', from: { node: 'i1' }, to: { node: 'ton', pin: 1 } });
    open(graph);
    selectNode('ton');
    change(propsSelect(), 'TON');

    expect(wireCount()).toBe(4);
    expect(program()).toBe('T1 = TON(I0.0 & I0.1, 1)\nQ0.0 = T1.Q');
  });

  it('sets a timer’s preset time and shows it as an IEC duration', () => {
    open();
    selectNode('ton');
    const pt = document.querySelector('.plcProps input[type=number]') as HTMLInputElement;
    change(pt, '0.5', 'input');

    expect(program()).toBe('T1 = TON(I0.0 & I0.1, 0.5)\nQ0.0 = T1.Q');
    expect(document.querySelector('.plcLiteral')?.textContent).toBe('T#500ms');
  });

  it('changes an input variable', () => {
    open();
    selectNode('i1');
    change(propsSelect(), 'I0.3');

    expect(program()).toBe('T1 = TON(I0.0 & I0.3, 2)\nQ0.0 = T1.Q');
  });

  it('offers only inputs and constants as input variables, not outputs', () => {
    open();
    const options = (sel: HTMLSelectElement): string[] => [...sel.options].map((o) => o.value);
    const allowed = ['I0.0', 'I0.1', 'I0.2', 'I0.3', 'TRUE', 'FALSE'];

    expect(options(document.querySelector('.plcPalette select') as HTMLSelectElement)).toEqual(
      allowed,
    );
    selectNode('i1');
    expect(options(propsSelect())).toEqual(allowed);
  });

  it('still shows an output an older diagram reads back as an input', () => {
    const graph = sampleGraph();
    graph.nodes[1] = { id: 'i1', kind: 'signal', ref: 'Q0.0', x: 70, y: 120 };
    open(graph);
    selectNode('i1');

    expect(propsSelect().value).toBe('Q0.0');
    expect(program()).toBe('T1 = TON(I0.0 & Q0.0, 2)\nQ0.0 = T1.Q');
  });

  it('saves the edited diagram', () => {
    const { saved } = open();
    selectNode('and');
    change(propsSelect(), 'XOR');
    (
      Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'Save',
      ) as HTMLButtonElement
    ).click();

    const node = saved()?.nodes.find((n) => n.id === 'and');
    expect(node).toMatchObject({ kind: 'gate', op: 'XOR' });
  });
});

describe('PLC editor: IEC symbols', () => {
  afterEach(() => document.body.replaceChildren());

  it('labels logic boxes with their IEC symbols', () => {
    const graph = sampleGraph();
    graph.nodes.push(
      { id: 'or', kind: 'gate', op: 'OR', x: 230, y: 200 },
      { id: 'xor', kind: 'gate', op: 'XOR', x: 230, y: 280 },
      { id: 'not', kind: 'not', x: 230, y: 360 },
    );
    open(graph);
    const title = (id: string): string =>
      document.querySelector(`[data-node-id="${id}"] .plcBoxTitle`)?.textContent ?? '';

    expect([title('and'), title('or'), title('xor'), title('not')]).toEqual(['&', '≥1', '=1', '1']);
    expect(document.querySelector('[data-node-id="not"] .plcNegation')).not.toBeNull();
  });

  it('draws a function block with its instance name above and formal parameters inside', () => {
    open();
    const texts = Array.from(document.querySelectorAll('[data-node-id="ton"] text')).map(
      (t) => t.textContent,
    );
    expect(texts).toEqual(expect.arrayContaining(['T1', 'TON', 'IN', 'PT', 'Q', 'ET', 'T#2s']));
  });

  it('marks unwired input pins', () => {
    const graph = sampleGraph();
    graph.wires = graph.wires.filter((w) => w.id !== 'w2');
    open(graph);
    expect(document.querySelectorAll('.plcPinOpen')).toHaveLength(1);
  });
});
