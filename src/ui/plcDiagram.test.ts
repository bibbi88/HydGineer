import { describe, expect, it } from 'vitest';
import { drawDiagram } from './plcDiagram';
import type { PlcGraph } from '../sim/plcGraph';
import type { FbState } from '../sim/plcProgram';

const graph: PlcGraph = {
  nodes: [
    { id: 'a', kind: 'signal', ref: 'I0.0', x: 70, y: 60 },
    { id: 'b', kind: 'signal', ref: 'I0.1', x: 70, y: 120 },
    { id: 't', kind: 'fb', fbType: 'TON', instance: 'T1', params: [2], x: 260, y: 60 },
    { id: 'c', kind: 'fb', fbType: 'CTU', instance: 'C1', params: [3], x: 260, y: 200 },
  ],
  wires: [
    { id: 'w1', from: { node: 'a' }, to: { node: 't', pin: 0 } },
    { id: 'w2', from: { node: 'b' }, to: { node: 'c', pin: 0 } },
  ],
};

function svg(): SVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

const state = (et: number, cv: number): FbState => ({
  q: false,
  et,
  cv,
  running: false,
  prevIn: false,
});

describe('drawDiagram in monitor mode', () => {
  it('marks wires carrying TRUE as on and FALSE as off', () => {
    const el = svg();
    drawDiagram(el, graph, {
      live: {
        nodes: new Map([
          ['a', true],
          ['b', false],
        ]),
        fb: new Map(),
      },
    });
    expect(el.querySelectorAll('.plcWire.plcOn')).toHaveLength(1);
    expect(el.querySelectorAll('.plcWire.plcOff')).toHaveLength(1);
    expect(el.querySelector('[data-node-id="a"] .plcVarOn')?.textContent).toBe('I0.0');
  });

  it('shows a timer’s elapsed time and a counter’s count beside ET and CV', () => {
    const el = svg();
    drawDiagram(el, graph, {
      live: {
        nodes: new Map(),
        fb: new Map([
          ['T1', state(1.25, 0)],
          ['C1', state(0, 2)],
        ]),
      },
    });
    const readings = [...el.querySelectorAll('.plcLiveValue')].map((t) => t.textContent);
    expect(readings).toEqual(['1.3s', '2']);
  });

  it('is read-only without editor hooks', () => {
    const el = svg();
    drawDiagram(el, graph, { live: { nodes: new Map(), fb: new Map() } });
    expect(el.querySelector('.plcPinHit')).toBeNull();
    expect(el.querySelector('.plcWireHit')).toBeNull();
  });
});
