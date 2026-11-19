/** Drawing checks on every component in the library. */
import { expect, it } from 'vitest';
import { componentRegistry } from './registry';

type Seg = [number, number, number, number];

function pathSegs(d: string): Seg[] {
  const toks = d.match(/[MLHVZmlhvzCQAcqa]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const segs: Seg[] = [];
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0,
    cmd = '';
  let i = 0;
  const num = () => Number(toks[i++]);
  while (i < toks.length) {
    const t = toks[i]!;
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        segs.push([x, y, sx, sy]);
        x = sx;
        y = sy;
      }
      continue;
    }
    if (cmd === 'M') {
      x = num();
      y = num();
      sx = x;
      sy = y;
      cmd = 'L';
    } else if (cmd === 'L') {
      const nx = num(),
        ny = num();
      segs.push([x, y, nx, ny]);
      x = nx;
      y = ny;
    } else if (cmd === 'H') {
      const nx = num();
      segs.push([x, y, nx, y]);
      x = nx;
    } else if (cmd === 'V') {
      const ny = num();
      segs.push([x, y, x, ny]);
      y = ny;
    } else {
      return segs;
    } // curves etc: stop
  }
  return segs;
}

function hasTransform(el: Element, root: Element): boolean {
  for (let n: Element | null = el.parentElement; n && n !== root; n = n.parentElement) {
    const t = n.getAttribute('transform');
    if (t && t.trim() && !/^translate\(\s*0\s*,\s*0\s*\)$/.test(t)) return true;
  }
  return false;
}

/** Every port's line starts exactly at the port, straight - so wires meet the symbol's lines
 * without a jog (see the 10 px grid test for where the ports themselves sit). */
it('every port has its line starting exactly at it', () => {
  const out: string[] = [];
  for (const [type, entry] of componentRegistry) {
    let comp;
    try {
      comp = entry.factory({ compLayer: document.createElement('div') } as never, 0, 0);
    } catch {
      continue;
    }
    const root = comp.el;
    const segs: Seg[] = [];
    root.querySelectorAll('line').forEach((l) => {
      if (hasTransform(l, root)) return;
      segs.push([
        +l.getAttribute('x1')!,
        +l.getAttribute('y1')!,
        +l.getAttribute('x2')!,
        +l.getAttribute('y2')!,
      ]);
    });
    root.querySelectorAll('path').forEach((p) => {
      if (hasTransform(p, root)) return;
      segs.push(...pathSegs(p.getAttribute('d') ?? ''));
    });
    for (const port of Object.values(comp.ports)) {
      const { cx, cy } = port;
      const exact = segs.some(
        ([a, b, c, d]) =>
          (Math.abs(a - cx) < 0.01 && Math.abs(b - cy) < 0.01) ||
          (Math.abs(c - cx) < 0.01 && Math.abs(d - cy) < 0.01),
      );
      if (exact) continue;
      // a segment passing through the port?
      const through = segs.some(
        ([a, b, c, d]) =>
          (a === c && Math.abs(a - cx) < 0.01 && Math.min(b, d) <= cy && cy <= Math.max(b, d)) ||
          (b === d && Math.abs(b - cy) < 0.01 && Math.min(a, c) <= cx && cx <= Math.max(a, c)),
      );
      if (through) continue;
      const near = segs.filter(
        ([a, b, c, d]) => Math.hypot(a - cx, b - cy) < 8 || Math.hypot(c - cx, d - cy) < 8,
      );
      out.push(
        `${type}.${port.key} @(${cx},${cy}) ${near.length ? 'near: ' + near.map((s) => s.map((v) => +v.toFixed(2)).join(',')).join(' | ') : 'no lead'}`,
      );
    }
  }
  expect(out).toEqual(['junction.P @(7,7) no lead']);
});
