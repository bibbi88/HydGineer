import { afterEach, describe, expect, it } from 'vitest';
import { openPlcEditorDialog } from './plcEditorDialog';
import type { PlcGraph } from '../sim/plcGraph';

function twoBlockGraph(): PlcGraph {
  return {
    nodes: [
      { id: 'i0', kind: 'signal', ref: 'I0.0', x: 0, y: 0 },
      { id: 'coil', kind: 'coil', target: 'Q0.0', x: 200, y: 0 },
    ],
    wires: [{ id: 'w1', from: { node: 'i0' }, to: { node: 'coil', pin: 0 } }],
  };
}

function removeButtons(): SVGElement[] {
  return Array.from(document.querySelectorAll<SVGElement>('.plcNodeRemove'));
}

function wireCount(): number {
  return document.querySelectorAll('.plcWire').length;
}

function diagramText(): string {
  return document.querySelector('.plcEditorDialog svg')?.textContent ?? '';
}

function clickRemove(index: number): void {
  removeButtons()[index]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

/** These cover the JS side of removing a block. The bug that prompted them was in CSS - the ✕
 * is a <text> inside .plcNode, which disables pointer-events, so the control never received the
 * mousedown at all - and jsdom does no hit-testing, so none of this would have caught that. What
 * they do protect is the handler itself: that it is wired up, drops the right block, takes its
 * wires with it, and doesn't leave a drag running behind it. */
describe('PLC editor: removing a block', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('gives every block its own remove control', () => {
    openPlcEditorDialog({ graph: twoBlockGraph(), onSave: () => {} });
    expect(removeButtons()).toHaveLength(2);
  });

  it('removes the clicked block, and the wire that ran into it', () => {
    openPlcEditorDialog({ graph: twoBlockGraph(), onSave: () => {} });
    expect(wireCount()).toBe(1);
    expect(diagramText()).toContain('I0.0');

    clickRemove(0);

    expect(removeButtons()).toHaveLength(1);
    expect(diagramText()).not.toContain('I0.0');
    // The wire ran between the two blocks, so it cannot survive one of them going.
    expect(wireCount()).toBe(0);
  });

  it('leaves the blocks it was not pointed at alone', () => {
    openPlcEditorDialog({ graph: twoBlockGraph(), onSave: () => {} });

    clickRemove(1);

    expect(removeButtons()).toHaveLength(1);
    expect(diagramText()).toContain('I0.0');
    expect(diagramText()).not.toContain('Q0.0');
  });

  it('does not start dragging the block it just removed', () => {
    // The control sits on top of the node body, whose own mousedown begins a drag - so it stops
    // propagation. Without that, the block would be removed and then a ghost drag would run for
    // the rest of the gesture.
    openPlcEditorDialog({ graph: twoBlockGraph(), onSave: () => {} });

    clickRemove(0);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 400 }));
    window.dispatchEvent(new MouseEvent('mouseup'));

    expect(removeButtons()).toHaveLength(1);
  });

  it('can empty the diagram one block at a time', () => {
    openPlcEditorDialog({ graph: twoBlockGraph(), onSave: () => {} });

    clickRemove(0);
    clickRemove(0);

    expect(removeButtons()).toHaveLength(0);
    expect(wireCount()).toBe(0);
  });
});
