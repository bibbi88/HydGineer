import { describe, expect, it } from 'vitest';
import { compileProgram, runScan, type FbState } from './plcProgram';

const bools = (o: Record<string, boolean>): Map<string, boolean> => new Map(Object.entries(o));

function scanOnce(
  programText: string,
  inputs: Record<string, boolean>,
  outputs: Map<string, boolean>,
  fb: Map<string, FbState>,
  dt = 0,
): { outputs: Map<string, boolean>; fb: Map<string, FbState> } {
  const program = compileProgram(programText);
  expect(program.error).toBeNull();
  return runScan(program, bools(inputs), outputs, fb, dt);
}

describe('compileProgram / runScan (plain boolean rungs)', () => {
  it('evaluates AND/OR/NOT with the usual precedence, in words or symbols', () => {
    const p = compileProgram('Q0.0 = I0.0 AND NOT I0.1 OR I0.2; Q0.1 = !(I0.0 | I0.1) ^ I0.2');
    expect(p.error).toBeNull();
    const out = bools({ 'Q0.0': false, 'Q0.1': false });
    const fb = new Map<string, FbState>();
    expect(runScan(p, bools({ 'I0.0': true, 'I0.1': true, 'I0.2': false }), out, fb, 0).outputs.get('Q0.0')).toBe(false);
    expect(runScan(p, bools({ 'I0.0': true, 'I0.1': false, 'I0.2': false }), out, fb, 0).outputs.get('Q0.0')).toBe(true);
    expect(runScan(p, bools({ 'I0.0': false, 'I0.1': true, 'I0.2': true }), out, fb, 0).outputs.get('Q0.0')).toBe(true);
  });

  it('a self-holding rung keeps its output after the start input drops', () => {
    const p = compileProgram('Q0.0 = (I0.0 | Q0.0) & !I0.1');
    let out = bools({ 'Q0.0': false });
    const fb = new Map<string, FbState>();
    out = runScan(p, bools({ 'I0.0': true, 'I0.1': false }), out, fb, 0).outputs;
    expect(out.get('Q0.0')).toBe(true);
    out = runScan(p, bools({ 'I0.0': false, 'I0.1': false }), out, fb, 0).outputs;
    expect(out.get('Q0.0')).toBe(true);
    out = runScan(p, bools({ 'I0.0': false, 'I0.1': true }), out, fb, 0).outputs;
    expect(out.get('Q0.0')).toBe(false);
  });

  it('reports a readable error and runs nothing for a bad program', () => {
    expect(compileProgram('Q0.0 = I0.0 &').error).toMatch(/ends unexpectedly/);
    expect(compileProgram('X = 1').error).toMatch(/Q0\.0/);
    expect(compileProgram('Q0.0 = foo').error).toMatch(/Unknown name/);
    expect(compileProgram('Q0.0 = foo').statements).toEqual([]);
  });
});

describe('function blocks', () => {
  it('TON: Q goes true only after IN has held for PT seconds, and resets the instant IN drops', () => {
    let out = bools({ 'Q0.0': false });
    let fb = new Map<string, FbState>();
    let r = scanOnce('T1 = TON(I0.0, 1.0)\nQ0.0 = T1.Q', { 'I0.0': true }, out, fb, 0.4);
    out = r.outputs;
    fb = r.fb;
    expect(out.get('Q0.0')).toBe(false); // 0.4s in, not yet at 1.0s

    r = scanOnce('T1 = TON(I0.0, 1.0)\nQ0.0 = T1.Q', { 'I0.0': true }, out, fb, 0.7);
    out = r.outputs;
    fb = r.fb;
    expect(out.get('Q0.0')).toBe(true); // 1.1s in total, past 1.0s

    r = scanOnce('T1 = TON(I0.0, 1.0)\nQ0.0 = T1.Q', { 'I0.0': false }, out, fb, 0.1);
    expect(r.outputs.get('Q0.0')).toBe(false); // IN dropped - resets immediately
  });

  it('TOF: Q stays true for PT seconds after IN drops', () => {
    let out = bools({ 'Q0.0': false });
    let fb = new Map<string, FbState>();
    let r = scanOnce('T1 = TOF(I0.0, 1.0)\nQ0.0 = T1.Q', { 'I0.0': true }, out, fb, 0);
    out = r.outputs;
    fb = r.fb;
    expect(out.get('Q0.0')).toBe(true);

    r = scanOnce('T1 = TOF(I0.0, 1.0)\nQ0.0 = T1.Q', { 'I0.0': false }, out, fb, 0.5);
    out = r.outputs;
    fb = r.fb;
    expect(out.get('Q0.0')).toBe(true); // still within the 1.0s off-delay

    r = scanOnce('T1 = TOF(I0.0, 1.0)\nQ0.0 = T1.Q', { 'I0.0': false }, out, fb, 0.6);
    expect(r.outputs.get('Q0.0')).toBe(false); // 1.1s since IN dropped
  });

  it('TP: a rising edge fires a fixed-length pulse regardless of how long IN stays high', () => {
    let out = bools({ 'Q0.0': false });
    let fb = new Map<string, FbState>();
    let r = scanOnce('T1 = TP(I0.0, 0.5)\nQ0.0 = T1.Q', { 'I0.0': true }, out, fb, 0.1);
    out = r.outputs;
    fb = r.fb;
    expect(out.get('Q0.0')).toBe(true);

    // IN already dropped, but the pulse keeps running on its own.
    r = scanOnce('T1 = TP(I0.0, 0.5)\nQ0.0 = T1.Q', { 'I0.0': false }, out, fb, 0.3);
    out = r.outputs;
    fb = r.fb;
    expect(out.get('Q0.0')).toBe(true); // 0.4s into the 0.5s pulse

    r = scanOnce('T1 = TP(I0.0, 0.5)\nQ0.0 = T1.Q', { 'I0.0': false }, out, fb, 0.2);
    expect(r.outputs.get('Q0.0')).toBe(false); // pulse finished
  });

  it('CTU: counts rising edges on CU, resets on R, Q true once CV reaches PV', () => {
    let out = bools({ 'Q0.0': false });
    let fb = new Map<string, FbState>();
    const prog = 'C1 = CTU(I0.0, I0.1, 3)\nQ0.0 = C1.Q';
    for (const cu of [true, false, true, false]) {
      const r = scanOnce(prog, { 'I0.0': cu, 'I0.1': false }, out, fb, 0);
      out = r.outputs;
      fb = r.fb;
    }
    expect(out.get('Q0.0')).toBe(false); // 2 rising edges so far
    let r = scanOnce(prog, { 'I0.0': true, 'I0.1': false }, out, fb, 0);
    out = r.outputs;
    fb = r.fb;
    expect(out.get('Q0.0')).toBe(true); // 3rd rising edge reaches PV
    r = scanOnce(prog, { 'I0.0': false, 'I0.1': true }, out, fb, 0);
    expect(r.outputs.get('Q0.0')).toBe(false); // reset
  });

  it('SR is set-dominant and RS is reset-dominant when both inputs are true at once', () => {
    const out = bools({ 'Q0.0': false, 'Q0.1': false });
    const fb = new Map<string, FbState>();
    const r = scanOnce('M1 = SR(I0.0, I0.1)\nM2 = RS(I0.0, I0.1)\nQ0.0 = M1.Q\nQ0.1 = M2.Q', {
      'I0.0': true,
      'I0.1': true,
    }, out, fb, 0);
    expect(r.outputs.get('Q0.0')).toBe(true); // SR: set wins
    expect(r.outputs.get('Q0.1')).toBe(false); // RS: reset wins
  });

  it('rejects a function block instance named like a port, and reports bad argument counts', () => {
    expect(compileProgram('I0.0 = TON(I0.1, 1.0)').error).toMatch(/port name/);
    expect(compileProgram('T1 = TON(I0.0)').error).toBeTruthy();
    expect(compileProgram('T1 = TON(I0.0, I0.1)').error).toMatch(/plain number/);
  });
});
