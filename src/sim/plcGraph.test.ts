import { describe, expect, it } from 'vitest';
import {
  compileGraph,
  graphToText,
  type GraphNode,
  type GraphWire,
  type PlcGraph,
} from './plcGraph';
import { runScan, type FbState } from './plcProgram';

const bools = (o: Record<string, boolean>): Map<string, boolean> => new Map(Object.entries(o));

function wire(fromNode: string, toNode: string, pin: number): GraphWire {
  return {
    id: `${fromNode}->${toNode}:${pin}`,
    from: { node: fromNode },
    to: { node: toNode, pin },
  };
}

describe('compileGraph', () => {
  it('compiles the same self-holding circuit as the text default program', () => {
    const nodes: GraphNode[] = [
      { id: 'i0', kind: 'signal', ref: 'I0.0', x: 0, y: 0 },
      { id: 'qfb', kind: 'signal', ref: 'Q0.0', x: 0, y: 20 },
      { id: 'orGate', kind: 'gate', op: 'OR', x: 100, y: 10 },
      { id: 'i1', kind: 'signal', ref: 'I0.1', x: 0, y: 60 },
      { id: 'notGate', kind: 'not', x: 100, y: 60 },
      { id: 'andGate', kind: 'gate', op: 'AND', x: 200, y: 30 },
      { id: 'coil', kind: 'coil', target: 'Q0.0', x: 300, y: 30 },
    ];
    const wires: GraphWire[] = [
      wire('i0', 'orGate', 0),
      wire('qfb', 'orGate', 1),
      wire('i1', 'notGate', 0),
      wire('orGate', 'andGate', 0),
      wire('notGate', 'andGate', 1),
      wire('andGate', 'coil', 0),
    ];
    const graph: PlcGraph = { nodes, wires };

    const compiled = compileGraph(graph);
    expect(compiled.error).toBeNull();
    expect(graphToText(graph)).toBe('Q0.0 = (I0.0 | Q0.0) & !I0.1');

    let out = bools({ 'Q0.0': false });
    const fb = new Map<string, FbState>();
    out = runScan(compiled, bools({ 'I0.0': true, 'I0.1': false }), out, fb, 0).outputs;
    expect(out.get('Q0.0')).toBe(true);
    out = runScan(compiled, bools({ 'I0.0': false, 'I0.1': false }), out, fb, 0).outputs;
    expect(out.get('Q0.0')).toBe(true); // self-held
    out = runScan(compiled, bools({ 'I0.0': false, 'I0.1': true }), out, fb, 0).outputs;
    expect(out.get('Q0.0')).toBe(false);
  });

  it('an XOR gate compiles and evaluates correctly', () => {
    const graph: PlcGraph = {
      nodes: [
        { id: 'a', kind: 'signal', ref: 'I0.0', x: 0, y: 0 },
        { id: 'b', kind: 'signal', ref: 'I0.1', x: 0, y: 20 },
        { id: 'xor', kind: 'gate', op: 'XOR', x: 100, y: 10 },
        { id: 'coil', kind: 'coil', target: 'Q0.0', x: 200, y: 10 },
      ],
      wires: [wire('a', 'xor', 0), wire('b', 'xor', 1), wire('xor', 'coil', 0)],
    };
    const compiled = compileGraph(graph);
    expect(compiled.error).toBeNull();
    const out = runScan(
      compiled,
      bools({ 'I0.0': true, 'I0.1': false }),
      bools({ 'Q0.0': false }),
      new Map(),
      0,
    );
    expect(out.outputs.get('Q0.0')).toBe(true);
  });

  it('a TON function block feeds a coil, and the graph runs it before the coil that reads it', () => {
    const graph: PlcGraph = {
      nodes: [
        { id: 'i0', kind: 'signal', ref: 'I0.0', x: 0, y: 100 }, // placed below the coil on purpose
        { id: 'ton', kind: 'fb', fbType: 'TON', instance: 'T1', params: [1.0], x: 100, y: 100 },
        { id: 'coil', kind: 'coil', target: 'Q0.0', x: 200, y: 0 }, // above the block that feeds it
      ],
      wires: [wire('i0', 'ton', 0), wire('ton', 'coil', 0)],
    };
    const compiled = compileGraph(graph);
    expect(compiled.error).toBeNull();
    // Dependency ordering must win over the Y-position tiebreak: T1 first, coil second.
    expect(compiled.statements.map((s) => (s.kind === 'fb' ? s.instance : s.target))).toEqual([
      'T1',
      'Q0.0',
    ]);
    expect(graphToText(graph)).toBe('T1 = TON(I0.0, 1)\nQ0.0 = T1.Q');

    let out = bools({ 'Q0.0': false });
    let fb = new Map<string, FbState>();
    let r = runScan(compiled, bools({ 'I0.0': true }), out, fb, 0.5);
    out = r.outputs;
    fb = r.fb;
    expect(out.get('Q0.0')).toBe(false);
    r = runScan(compiled, bools({ 'I0.0': true }), out, fb, 0.6);
    expect(r.outputs.get('Q0.0')).toBe(true);
  });

  it('breaks ties between independent coils by canvas Y (top to bottom)', () => {
    const graph: PlcGraph = {
      nodes: [
        { id: 'lower', kind: 'coil', target: 'Q0.1', x: 0, y: 200 },
        { id: 'src1', kind: 'signal', ref: 'I0.1', x: 0, y: 190 },
        { id: 'upper', kind: 'coil', target: 'Q0.0', x: 0, y: 10 },
        { id: 'src0', kind: 'signal', ref: 'I0.0', x: 0, y: 0 },
      ],
      wires: [wire('src0', 'upper', 0), wire('src1', 'lower', 0)],
    };
    const compiled = compileGraph(graph);
    expect(compiled.error).toBeNull();
    expect(compiled.statements.map((s) => (s.kind === 'assign' ? s.target : ''))).toEqual([
      'Q0.0',
      'Q0.1',
    ]);
  });

  it('reports a circular function-block reference', () => {
    const graph: PlcGraph = {
      nodes: [
        { id: 'a', kind: 'fb', fbType: 'SR', instance: 'A', params: [], x: 0, y: 0 },
        { id: 'b', kind: 'fb', fbType: 'SR', instance: 'B', params: [], x: 100, y: 0 },
      ],
      wires: [wire('b', 'a', 0), wire('b', 'a', 1), wire('a', 'b', 0), wire('a', 'b', 1)],
    };
    expect(compileGraph(graph).error).toMatch(/circular/);
  });

  it('reports two coils driving the same output', () => {
    const graph: PlcGraph = {
      nodes: [
        { id: 'a', kind: 'signal', ref: 'TRUE', x: 0, y: 0 },
        { id: 'c1', kind: 'coil', target: 'Q0.0', x: 100, y: 0 },
        { id: 'c2', kind: 'coil', target: 'Q0.0', x: 100, y: 50 },
      ],
      wires: [wire('a', 'c1', 0), wire('a', 'c2', 0)],
    };
    expect(compileGraph(graph).error).toMatch(/more than one coil/);
  });

  it('reports an unwired coil input', () => {
    const graph: PlcGraph = {
      nodes: [{ id: 'c', kind: 'coil', target: 'Q0.0', x: 0, y: 0 }],
      wires: [],
    };
    expect(compileGraph(graph).error).toMatch(/missing an input/);
  });

  it('reports a duplicate function block instance name', () => {
    const graph: PlcGraph = {
      nodes: [
        { id: 'a', kind: 'fb', fbType: 'SR', instance: 'M1', params: [], x: 0, y: 0 },
        { id: 'b', kind: 'fb', fbType: 'SR', instance: 'M1', params: [], x: 0, y: 50 },
      ],
      wires: [],
    };
    expect(compileGraph(graph).error).toMatch(/more than one function block/);
  });
});
