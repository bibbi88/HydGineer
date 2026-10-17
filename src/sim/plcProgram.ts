/**
 * A tiny PLC "program": a list of statements, evaluated top to bottom every scan like ladder
 * rungs (two kinds):
 *
 *  - `Q0.n = <boolean expression>` - a plain output assignment. Expressions use inputs (I0.n),
 *    outputs (Q0.n - the value from earlier in this scan, or the previous scan if not yet
 *    assigned, which is what makes a self-holding rung work), function block outputs (see
 *    below), the constants 0/1/TRUE/FALSE, parentheses, and NOT/!, AND/&, OR/|, XOR/^
 *    (precedence: NOT, then AND, then XOR, then OR).
 *
 *  - `NAME = TYPE(args...)` - creates/steps one instance of a standard IEC 61131-3-style
 *    function block, named `NAME` (any identifier that isn't itself a valid I0.n/Q0.n). Each
 *    instance keeps its own state (elapsed time, count, latch bit) across scans, exactly like an
 *    output does. Its outputs are read elsewhere as `NAME.Q` (every block below has a boolean
 *    `.Q`), and a block only actually runs once its own line is reached in the scan, so put it
 *    before whatever reads its output - same top-to-bottom rule plain assignments already follow.
 *
 *    TON(IN, PT)      on-delay timer: Q goes true PT seconds after IN goes true; resets the
 *                     instant IN goes false.
 *    TOF(IN, PT)      off-delay timer: Q follows IN true immediately, but stays true for PT more
 *                     seconds after IN goes false.
 *    TP(IN, PT)       pulse: a rising edge on IN starts a fixed PT-second true pulse on Q,
 *                     regardless of how long IN itself stays true.
 *    CTU(CU, R, PV)   count up: each rising edge on CU adds 1 (capped at PV); R resets to 0;
 *                     Q is true once the count reaches PV.
 *    CTD(CD, LD, PV)  count down: starts at PV; each rising edge on CD subtracts 1 (floored at
 *                     0); LD reloads it to PV; Q is true once the count reaches 0.
 *    SR(S, R1)        set-dominant latch: Q follows S/R1, but if both are true at once, S wins.
 *    RS(S, R1)        reset-dominant latch: same, but R1 wins when both are true at once.
 *
 *    PT/PV are plain numeric literals (seconds for PT, an integer count for PV), not
 *    expressions - a block's timing/preset is fixed in the program text, not computed live.
 *
 * Statements are separated by ';' or newlines.
 */

export type Expr =
  | { kind: 'const'; value: boolean }
  | { kind: 'var'; name: string }
  | { kind: 'member'; instance: string; field: string }
  | { kind: 'not'; arg: Expr }
  | { kind: 'bin'; op: 'and' | 'or' | 'xor'; left: Expr; right: Expr };

export const FB_TYPES = ['TON', 'TOF', 'TP', 'CTU', 'CTD', 'SR', 'RS'] as const;
export type FbType = (typeof FB_TYPES)[number];

/** How many arguments each block takes, and which are boolean expressions vs. plain numeric
 * literals (by position) - drives both parsing and the step function below, and (exported) lets
 * the graphical editor (plcGraph.ts) know how many wire-able pins vs. literal-number fields a
 * function block needs without duplicating this table. */
export const FB_ARG_SHAPE: Record<FbType, Array<'bool' | 'num'>> = {
  TON: ['bool', 'num'],
  TOF: ['bool', 'num'],
  TP: ['bool', 'num'],
  CTU: ['bool', 'bool', 'num'],
  CTD: ['bool', 'bool', 'num'],
  SR: ['bool', 'bool'],
  RS: ['bool', 'bool'],
};

export type Statement =
  | { kind: 'assign'; target: string; expr: Expr }
  | { kind: 'fb'; instance: string; fbType: FbType; args: Array<Expr | number> };

export interface CompiledProgram {
  statements: Statement[];
  error: string | null;
}

/** Per-instance state a function block carries across scans - which fields are meaningful
 * depends on its type (a timer uses et/running, a counter cv, a latch just q). */
export interface FbState {
  q: boolean;
  et: number;
  cv: number;
  running: boolean;
  prevIn: boolean;
}

function freshFbState(): FbState {
  return { q: false, et: 0, cv: 0, running: false, prevIn: false };
}

export const PORT_RE = /^[IQ]\d+\.\d+$/;
const MEMBER_RE = /^[A-Za-z]\w*\.[A-Za-z]\w*$/;
const NUMBER_RE = /^\d+(?:\.\d+)?$/;

function tokenize(src: string): string[] {
  const tokens: string[] = [];
  const re = /\s*([A-Za-z]\w*(?:\.\w+)?|\d+(?:\.\d+)?|[()!&|^=,])/gy;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`Unexpected character "${src.slice(pos).trim()[0]}"`);
    tokens.push(m[1] as string);
    pos = re.lastIndex;
  }
  return tokens;
}

function parseExpression(tokens: string[]): Expr {
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const upper = (): string | undefined => tokens[i]?.toUpperCase();

  function parseOr(): Expr {
    let left = parseXor();
    while (upper() === 'OR' || peek() === '|') {
      i++;
      left = { kind: 'bin', op: 'or', left, right: parseXor() };
    }
    return left;
  }
  function parseXor(): Expr {
    let left = parseAnd();
    while (upper() === 'XOR' || peek() === '^') {
      i++;
      left = { kind: 'bin', op: 'xor', left, right: parseAnd() };
    }
    return left;
  }
  function parseAnd(): Expr {
    let left = parseNot();
    while (upper() === 'AND' || peek() === '&') {
      i++;
      left = { kind: 'bin', op: 'and', left, right: parseNot() };
    }
    return left;
  }
  function parseNot(): Expr {
    if (upper() === 'NOT' || peek() === '!') {
      i++;
      return { kind: 'not', arg: parseNot() };
    }
    return parseAtom();
  }
  function parseAtom(): Expr {
    const t = peek();
    if (t === undefined) throw new Error('Expression ends unexpectedly');
    i++;
    if (t === '(') {
      const inner = parseOr();
      if (peek() !== ')') throw new Error('Missing ")"');
      i++;
      return inner;
    }
    const u = t.toUpperCase();
    if (u === '1' || u === 'TRUE') return { kind: 'const', value: true };
    if (u === '0' || u === 'FALSE') return { kind: 'const', value: false };
    if (PORT_RE.test(u)) return { kind: 'var', name: u };
    if (MEMBER_RE.test(t)) {
      const [instance, field] = t.split('.') as [string, string];
      return { kind: 'member', instance: instance.toUpperCase(), field: field.toUpperCase() };
    }
    throw new Error(`Unknown name "${t}" (use I0.n, Q0.n, or NAME.Q)`);
  }

  const expr = parseOr();
  if (i < tokens.length) throw new Error(`Unexpected "${tokens[i]}"`);
  return expr;
}

/** Parses a comma-separated `TYPE(...)` call already positioned right after the type name -
 * `tokens` starts at '(' and must end with the matching ')'. */
function parseFbArgs(fbType: FbType, tokens: string[]): Array<Expr | number> {
  if (tokens[0] !== '(') throw new Error(`Expected "(" after ${fbType}`);
  const shape = FB_ARG_SHAPE[fbType];
  const args: Array<Expr | number> = [];
  let i = 1;
  for (let argIdx = 0; argIdx < shape.length; argIdx++) {
    const start = i;
    let depth = 0;
    while (i < tokens.length && !(depth === 0 && (tokens[i] === ',' || tokens[i] === ')'))) {
      if (tokens[i] === '(') depth++;
      if (tokens[i] === ')') depth--;
      i++;
    }
    const argTokens = tokens.slice(start, i);
    if (argTokens.length === 0) {
      throw new Error(`${fbType} needs ${shape.length} argument(s), got fewer`);
    }
    if (shape[argIdx] === 'num') {
      if (argTokens.length !== 1 || !NUMBER_RE.test(argTokens[0] as string)) {
        throw new Error(
          `${fbType}'s ${argIdx + 1}${ordinalSuffix(argIdx + 1)} argument must be a plain number`,
        );
      }
      args.push(Number(argTokens[0]));
    } else {
      args.push(parseExpression(argTokens));
    }
    if (argIdx < shape.length - 1) {
      if (tokens[i] !== ',')
        throw new Error(`${fbType} needs ${shape.length} arguments, got fewer`);
      i++;
    }
  }
  if (tokens[i] !== ')') throw new Error(`${fbType} takes exactly ${shape.length} argument(s)`);
  if (i + 1 !== tokens.length)
    throw new Error(`Unexpected "${tokens[i + 1]}" after ${fbType}(...)`);
  return args;
}

function ordinalSuffix(n: number): string {
  return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
}

export function compileProgram(text: string): CompiledProgram {
  const statements: Statement[] = [];
  try {
    for (const raw of text.split(/[;\n]/)) {
      if (raw.trim() === '') continue;
      const tokens = tokenize(raw);
      const target = tokens[0] ?? '';
      const targetU = target.toUpperCase();
      if (tokens[1] !== '=') {
        throw new Error(
          `Each line must look like "Q0.0 = ..." or "NAME = TON(...)" (got "${raw.trim()}")`,
        );
      }
      const rhsHead = tokens[2]?.toUpperCase();
      if (rhsHead && (FB_TYPES as readonly string[]).includes(rhsHead) && tokens[3] === '(') {
        if (PORT_RE.test(targetU)) {
          throw new Error(`"${target}" is a port name, not a valid function block instance name`);
        }
        const fbType = rhsHead as FbType;
        const args = parseFbArgs(fbType, tokens.slice(3));
        statements.push({ kind: 'fb', instance: targetU, fbType, args });
        continue;
      }
      if (!PORT_RE.test(targetU) || !targetU.startsWith('Q')) {
        throw new Error(`Each line must look like "Q0.0 = ..." (got "${raw.trim()}")`);
      }
      statements.push({ kind: 'assign', target: targetU, expr: parseExpression(tokens.slice(2)) });
    }
  } catch (e) {
    return { statements: [], error: e instanceof Error ? e.message : String(e) };
  }
  return { statements, error: null };
}

interface EvalEnv {
  bits: Map<string, boolean>;
  fb: Map<string, FbState>;
}

export function evaluate(expr: Expr, env: EvalEnv): boolean {
  switch (expr.kind) {
    case 'const':
      return expr.value;
    case 'var':
      return env.bits.get(expr.name) ?? false;
    case 'member':
      return env.fb.get(expr.instance)?.q ?? false;
    case 'not':
      return !evaluate(expr.arg, env);
    case 'bin': {
      const l = evaluate(expr.left, env);
      const r = evaluate(expr.right, env);
      return expr.op === 'and' ? l && r : expr.op === 'or' ? l || r : l !== r;
    }
  }
}

/** Advances one function block instance by `dt` seconds, given its already-evaluated arguments
 * (booleans for edge/level inputs, plain numbers for PT/PV) and its state from last scan -
 * mutates and returns that same state object. */
function stepFb(fbType: FbType, args: Array<boolean | number>, dt: number, s: FbState): FbState {
  switch (fbType) {
    case 'TON': {
      const [inp, pt] = args as [boolean, number];
      s.et = inp ? Math.min(s.et + dt, pt) : 0;
      s.q = inp && s.et >= pt;
      return s;
    }
    case 'TOF': {
      const [inp, pt] = args as [boolean, number];
      if (inp) {
        s.et = 0;
        s.q = true;
      } else {
        s.et = Math.min(s.et + dt, pt);
        s.q = s.et < pt;
      }
      return s;
    }
    case 'TP': {
      const [inp, pt] = args as [boolean, number];
      if (inp && !s.prevIn) {
        s.running = true;
        s.et = 0;
      }
      s.prevIn = inp;
      if (s.running) {
        s.et += dt;
        if (s.et >= pt) s.running = false;
      }
      s.q = s.running;
      return s;
    }
    case 'CTU': {
      const [cu, r, pv] = args as [boolean, boolean, number];
      if (r) s.cv = 0;
      else if (cu && !s.prevIn) s.cv = Math.min(s.cv + 1, pv);
      s.prevIn = cu;
      s.q = s.cv >= pv;
      return s;
    }
    case 'CTD': {
      const [cd, ld, pv] = args as [boolean, boolean, number];
      if (ld) s.cv = pv;
      else if (cd && !s.prevIn) s.cv = Math.max(s.cv - 1, 0);
      s.prevIn = cd;
      s.q = s.cv <= 0;
      return s;
    }
    case 'SR': {
      const [set, reset] = args as [boolean, boolean];
      if (set) s.q = true;
      else if (reset) s.q = false;
      return s;
    }
    case 'RS': {
      const [set, reset] = args as [boolean, boolean];
      if (reset) s.q = false;
      else if (set) s.q = true;
      return s;
    }
  }
}

export interface ScanResult {
  outputs: Map<string, boolean>;
  fb: Map<string, FbState>;
}

/** Runs one scan: `inputs` and the previous `outputs`/`fb` state seed the environment; `dt` is
 * the real elapsed seconds since the last scan (0 is fine for a settling re-run within the same
 * frame - see sim/electrical.ts - a function block's own time/count only advances once per
 * frame). Returns the new output values (every output named in the program; unassigned ones
 * keep their old value) and the new per-instance function block state. */
export function runScan(
  program: CompiledProgram,
  inputs: Map<string, boolean>,
  outputs: Map<string, boolean>,
  fb: Map<string, FbState>,
  dt: number,
): ScanResult {
  const env: EvalEnv = { bits: new Map([...outputs, ...inputs]), fb: new Map(fb) };
  for (const st of program.statements) {
    if (st.kind === 'assign') {
      env.bits.set(st.target, evaluate(st.expr, env));
      continue;
    }
    const prev = env.fb.get(st.instance) ?? freshFbState();
    const argValues = st.args.map((a) => (typeof a === 'number' ? a : evaluate(a, env)));
    const next = stepFb(st.fbType, argValues, dt, { ...prev });
    env.fb.set(st.instance, next);
  }
  return {
    outputs: new Map([...outputs.keys()].map((k) => [k, env.bits.get(k) ?? false])),
    fb: env.fb,
  };
}
