/**
 * The PLC's graphical (function block diagram) program representation, and its compiler down to
 * the same `Statement[]`/`Expr` AST plcProgram.ts's text parser already produces - `runScan` never
 * needs to know whether a program was authored as text or as a diagram.
 *
 * A diagram is a set of nodes (each either a value source, a combinational gate, a stateful
 * function block instance, or an output coil) and wires connecting one node's output to another
 * node's input pin. Only `coil` and `fb` nodes become statements; `signal`/`gate`/`not` nodes are
 * pure combinational glue that gets inlined into whatever `Expr` reads them, exactly like writing
 * `(I0.0 | Q0.0) & !I0.1` inline in the text grammar rather than naming each sub-term.
 *
 * Statement order (which matters - see plcProgram.ts's own doc comment on scan order and
 * feedback) is derived, not authored directly: a function block referenced by `NAME.Q` elsewhere
 * must run before whatever reads it (a real data dependency, enforced by topological sort here),
 * while anything left ambiguous by that (independent coils, or independent function blocks with
 * no data dependency between them) falls back to top-to-bottom canvas position, so the diagram
 * reads the same way the generated program does.
 */

import {
  FB_ARG_SHAPE,
  FB_TYPES,
  PORT_RE,
  type CompiledProgram,
  type Expr,
  type FbType,
  type Statement,
} from './plcProgram';

export const SIGNAL_REFS = [
  'I0.0',
  'I0.1',
  'I0.2',
  'I0.3',
  'Q0.0',
  'Q0.1',
  'Q0.2',
  'Q0.3',
  'TRUE',
  'FALSE',
] as const;
export type SignalRef = (typeof SIGNAL_REFS)[number];
export const COIL_TARGETS = ['Q0.0', 'Q0.1', 'Q0.2', 'Q0.3'] as const;
export type CoilTarget = (typeof COIL_TARGETS)[number];
export const GATE_OPS = ['AND', 'OR', 'XOR'] as const;
export type GateOp = (typeof GATE_OPS)[number];

export type GraphNode =
  | { id: string; kind: 'signal'; ref: SignalRef; x: number; y: number }
  | { id: string; kind: 'gate'; op: GateOp; x: number; y: number }
  | { id: string; kind: 'not'; x: number; y: number }
  | {
      id: string;
      kind: 'fb';
      fbType: FbType;
      instance: string;
      params: number[];
      x: number;
      y: number;
    }
  | { id: string; kind: 'coil'; target: CoilTarget; x: number; y: number };

export interface GraphWire {
  id: string;
  from: { node: string };
  to: { node: string; pin: number };
}

export interface PlcGraph {
  nodes: GraphNode[];
  wires: GraphWire[];
}

/** How many boolean (wire-able) input pins a node kind has, in pin order. `fb` varies by type. */
export function inputPinCount(node: GraphNode): number {
  switch (node.kind) {
    case 'signal':
      return 0;
    case 'not':
    case 'coil':
      return 1;
    case 'gate':
      return 2;
    case 'fb':
      return FB_ARG_SHAPE[node.fbType].filter((s) => s === 'bool').length;
  }
}

/** For an `fb` node, which original TYPE(...) argument index each boolean pin / each `params[]`
 * entry lands at, e.g. CTU's shape `['bool','bool','num']` -> boolPins [0,1], numArgs [2]. */
function fbArgLayout(fbType: FbType): { boolArgs: number[]; numArgs: number[] } {
  const shape = FB_ARG_SHAPE[fbType];
  const boolArgs: number[] = [];
  const numArgs: number[] = [];
  shape.forEach((s, i) => (s === 'bool' ? boolArgs : numArgs).push(i));
  return { boolArgs, numArgs };
}

function signalExpr(ref: SignalRef): Expr {
  if (ref === 'TRUE') return { kind: 'const', value: true };
  if (ref === 'FALSE') return { kind: 'const', value: false };
  return { kind: 'var', name: ref };
}

class GraphCompileError extends Error {}

function compileStatements(graph: PlcGraph): Statement[] {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const wireInto = new Map<string, GraphWire>(); // key: `${nodeId}:${pin}`
  for (const w of graph.wires) wireInto.set(`${w.to.node}:${w.to.pin}`, w);

  function nodeLabel(n: GraphNode): string {
    if (n.kind === 'fb') return n.instance || n.fbType;
    if (n.kind === 'coil') return n.target || 'coil';
    if (n.kind === 'signal') return n.ref || 'signal';
    return n.kind.toUpperCase();
  }

  function exprForPin(node: GraphNode, pin: number, visiting: Set<string>): Expr {
    const wire = wireInto.get(`${node.id}:${pin}`);
    if (!wire) throw new GraphCompileError(`${nodeLabel(node)} is missing an input`);
    const source = nodesById.get(wire.from.node);
    if (!source)
      throw new GraphCompileError(`${nodeLabel(node)}'s input is wired to a missing block`);
    return exprForOutput(source, visiting);
  }

  function exprForOutput(node: GraphNode, visiting: Set<string>): Expr {
    switch (node.kind) {
      case 'signal':
        return signalExpr(node.ref);
      case 'fb':
        return { kind: 'member', instance: node.instance.toUpperCase(), field: 'Q' };
      case 'not':
      case 'gate': {
        if (visiting.has(node.id)) {
          throw new GraphCompileError(
            `${nodeLabel(node)} feeds back into its own input through gates alone`,
          );
        }
        visiting.add(node.id);
        try {
          if (node.kind === 'not') return { kind: 'not', arg: exprForPin(node, 0, visiting) };
          const left = exprForPin(node, 0, visiting);
          const right = exprForPin(node, 1, visiting);
          const op = node.op === 'AND' ? 'and' : node.op === 'OR' ? 'or' : 'xor';
          return { kind: 'bin', op, left, right };
        } finally {
          visiting.delete(node.id);
        }
      }
      case 'coil':
        throw new GraphCompileError('a coil has no output to wire elsewhere');
    }
  }

  /** Every `member` reference inside an already-built expr, for dependency-ordering statements. */
  function memberRefs(expr: Expr, out: Set<string>): void {
    switch (expr.kind) {
      case 'member':
        out.add(expr.instance);
        return;
      case 'not':
        memberRefs(expr.arg, out);
        return;
      case 'bin':
        memberRefs(expr.left, out);
        memberRefs(expr.right, out);
        return;
      default:
        return;
    }
  }

  const coilNodes = graph.nodes.filter(
    (n): n is Extract<GraphNode, { kind: 'coil' }> => n.kind === 'coil',
  );
  const fbNodes = graph.nodes.filter(
    (n): n is Extract<GraphNode, { kind: 'fb' }> => n.kind === 'fb',
  );

  const seenTargets = new Set<string>();
  for (const c of coilNodes) {
    if (!c.target) throw new GraphCompileError('a coil has no output selected');
    if (seenTargets.has(c.target))
      throw new GraphCompileError(`${c.target} has more than one coil driving it`);
    seenTargets.add(c.target);
  }
  const seenInstances = new Set<string>();
  for (const f of fbNodes) {
    const name = f.instance.trim().toUpperCase();
    if (!name) throw new GraphCompileError(`a ${f.fbType} block needs an instance name`);
    if (PORT_RE.test(name))
      throw new GraphCompileError(`"${name}" is a port name, not a valid instance name`);
    if (seenInstances.has(name))
      throw new GraphCompileError(`"${name}" is used by more than one function block`);
    seenInstances.add(name);
  }

  interface Built {
    node: GraphNode;
    statement: Statement;
    deps: Set<string>; // instance names this statement's expr(s) read via .Q
  }
  const built: Built[] = [];

  for (const f of fbNodes) {
    const { boolArgs, numArgs } = fbArgLayout(f.fbType);
    const shapeLen = FB_ARG_SHAPE[f.fbType].length;
    const args: Array<Expr | number> = new Array(shapeLen);
    const deps = new Set<string>();
    boolArgs.forEach((argIdx, pin) => {
      const expr = exprForPin(f, pin, new Set());
      memberRefs(expr, deps);
      args[argIdx] = expr;
    });
    numArgs.forEach((argIdx, i) => {
      args[argIdx] = f.params[i] ?? 0;
    });
    built.push({
      node: f,
      statement: { kind: 'fb', instance: f.instance.trim().toUpperCase(), fbType: f.fbType, args },
      deps,
    });
  }
  for (const c of coilNodes) {
    const expr = exprForPin(c, 0, new Set());
    const deps = new Set<string>();
    memberRefs(expr, deps);
    built.push({ node: c, statement: { kind: 'assign', target: c.target, expr }, deps });
  }

  // Topological sort: an edge from the fb instance a statement depends on to that statement
  // itself, so every function block a statement reads via .Q is emitted before it. Ties (no
  // dependency either way) are broken by canvas Y, then X, then insertion order, so an
  // undetermined ordering still matches how the diagram reads top-to-bottom.
  const instanceOwner = new Map<string, Built>();
  for (const b of built) if (b.statement.kind === 'fb') instanceOwner.set(b.statement.instance, b);

  const indegree = new Map<Built, number>(built.map((b) => [b, 0]));
  const dependents = new Map<Built, Built[]>(built.map((b) => [b, []]));
  for (const b of built) {
    for (const dep of b.deps) {
      const owner = instanceOwner.get(dep);
      if (!owner || owner === b) continue;
      dependents.get(owner)?.push(b);
      indegree.set(b, (indegree.get(b) ?? 0) + 1);
    }
  }

  const order = (a: Built, b: Built): number =>
    a.node.y - b.node.y || a.node.x - b.node.x || built.indexOf(a) - built.indexOf(b);

  const ready = built.filter((b) => (indegree.get(b) ?? 0) === 0).sort(order);
  const result: Built[] = [];
  while (ready.length > 0) {
    ready.sort(order);
    const next = ready.shift() as Built;
    result.push(next);
    for (const dep of dependents.get(next) ?? []) {
      const left = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, left);
      if (left === 0) ready.push(dep);
    }
  }
  if (result.length !== built.length) {
    const stuck = built.filter((b) => !result.includes(b)).map((b) => nodeLabel(b.node));
    throw new GraphCompileError(`circular function block reference between ${stuck.join(', ')}`);
  }

  return result.map((b) => b.statement);
}

export function compileGraph(graph: PlcGraph): CompiledProgram {
  try {
    return { statements: compileStatements(graph), error: null };
  } catch (e) {
    return { statements: [], error: e instanceof Error ? e.message : String(e) };
  }
}

function atomText(e: Expr): string {
  const t = exprToText(e);
  return e.kind === 'bin' ? `(${t})` : t;
}

function exprToText(e: Expr): string {
  switch (e.kind) {
    case 'const':
      return e.value ? '1' : '0';
    case 'var':
      return e.name;
    case 'member':
      return `${e.instance}.${e.field}`;
    case 'not':
      return `!${atomText(e.arg)}`;
    case 'bin': {
      const sym = e.op === 'and' ? '&' : e.op === 'or' ? '|' : '^';
      return `${atomText(e.left)} ${sym} ${atomText(e.right)}`;
    }
  }
}

function statementToText(s: Statement): string {
  if (s.kind === 'assign') return `${s.target} = ${exprToText(s.expr)}`;
  const args = s.args.map((a) => (typeof a === 'number' ? String(a) : exprToText(a))).join(', ');
  return `${s.instance} = ${s.fbType}(${args})`;
}

/** Read-only text preview of a diagram's generated program - never parsed back, purely display. */
export function graphToText(graph: PlcGraph): string {
  const compiled = compileGraph(graph);
  if (compiled.error) return '';
  return compiled.statements.map(statementToText).join('\n');
}

export { FB_TYPES };

/** A graph's nodes/wires arrays are mutated in place while the editor dialog is open, and
 * `snapshot()`/`restore()` pass graphs across component <-> history/persistence boundaries - both
 * sides always work on their own deep copy so editing one can never retroactively corrupt an
 * already-recorded undo entry or the other side's live state. */
export function cloneGraph(g: PlcGraph): PlcGraph {
  return JSON.parse(JSON.stringify(g)) as PlcGraph;
}
