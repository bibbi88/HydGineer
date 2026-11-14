/**
 * Where each wire's live pressure/flow label goes (sim/render.ts sets the text). A label at the
 * wire's midpoint used to straddle its own line on a vertical run, and land on other wires,
 * symbols and readouts. Instead, a few spots along each of the wire's runs are tried - above or
 * below a horizontal run, beside a vertical one - and the one that covers least of everything
 * else on the drawing wins. Labels are placed one after another, so later ones keep clear of
 * the earlier ones too.
 */
import type { Connection } from '../core/types';
import type { Point } from '../geometry/routing';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LabelPlacement {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

/** Text height (px, 10 px font) and the gap kept between a label and its own line. */
const TEXT_H = 10;
const GAP = 4;
/** Runs shorter than this get no label of their own - there's no room beside them. */
const MIN_RUN = 16;

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Length of the axis-aligned segment p-q inside `r` (0 for a diagonal one that misses). */
function segmentInside(p: Point, q: Point, r: Rect): number {
  if (p.y === q.y) {
    if (p.y < r.y0 || p.y > r.y1) return 0;
    return Math.max(0, Math.min(Math.max(p.x, q.x), r.x1) - Math.max(Math.min(p.x, q.x), r.x0));
  }
  if (p.x === q.x) {
    if (p.x < r.x0 || p.x > r.x1) return 0;
    return Math.max(0, Math.min(Math.max(p.y, q.y), r.y1) - Math.max(Math.min(p.y, q.y), r.y0));
  }
  return 0;
}

interface Candidate {
  place: LabelPlacement;
  box: Rect;
  /** Small preferences between otherwise equally clear spots. */
  bias: number;
}

/** The spots tried for a label `w` px wide on a wire running through `points`. */
function candidates(points: Point[], w: number): Candidate[] {
  const out: Candidate[] = [];
  let longest = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    longest = Math.max(longest, Math.hypot(b.x - a.x, b.y - a.y));
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < MIN_RUN && len < longest) continue;
    // Shorter runs and spots away from a run's middle are a little less good, other things
    // being equal.
    const runBias = (longest - len) * 0.02;
    for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const bias = runBias + Math.abs(t - 0.5) * 6;
      if (a.y === b.y) {
        // Horizontal run: above it, or below it. A label longer than the run spills past its
        // ends - only a slight penalty, as the spot is still plainly this wire's.
        const spill = Math.max(0, w - len) * 0.05;
        out.push({
          place: { x: m.x, y: m.y - GAP, anchor: 'middle' },
          box: { x0: m.x - w / 2, y0: m.y - GAP - TEXT_H, x1: m.x + w / 2, y1: m.y - GAP + 2 },
          bias: bias + spill,
        });
        out.push({
          place: { x: m.x, y: m.y + GAP + TEXT_H - 2, anchor: 'middle' },
          box: { x0: m.x - w / 2, y0: m.y + GAP - 1, x1: m.x + w / 2, y1: m.y + GAP + TEXT_H },
          bias: bias + spill + 1,
        });
      } else {
        // Vertical (or slanted) run: beside it, right or left, centred on the spot.
        const baseline = m.y + TEXT_H / 2 - 1.5;
        out.push({
          place: { x: m.x + GAP + 1, y: baseline, anchor: 'start' },
          box: {
            x0: m.x + GAP,
            y0: m.y - TEXT_H / 2 - 1,
            x1: m.x + GAP + 1 + w,
            y1: m.y + TEXT_H / 2,
          },
          bias,
        });
        out.push({
          place: { x: m.x - GAP - 1, y: baseline, anchor: 'end' },
          box: {
            x0: m.x - GAP - 1 - w,
            y0: m.y - TEXT_H / 2 - 1,
            x1: m.x - GAP,
            y1: m.y + TEXT_H / 2,
          },
          bias: bias + 1,
        });
      }
    }
  }
  return out;
}

export interface LabelRequest {
  conn: Connection;
  points: Point[];
  /** The label's width, px. */
  width: number;
}

/**
 * Places every requested label. `routes` are all the wires' runs (each label keeps off them,
 * its own included), `obstacles` the symbols and readouts on the drawing.
 */
export function placeLabels(
  requests: LabelRequest[],
  routes: Point[][],
  obstacles: Rect[],
): Map<number, LabelPlacement> {
  const placed: Rect[] = [];
  const result = new Map<number, LabelPlacement>();
  // Longest labels first: they have the fewest spots that fit.
  const ordered = [...requests].sort((p, q) => q.width - p.width);
  for (const req of ordered) {
    let best: Candidate | null = null;
    let bestScore = Infinity;
    for (const c of candidates(req.points, req.width)) {
      let score = c.bias;
      for (const route of routes) {
        for (let i = 0; i < route.length - 1; i++) {
          // A line through a label hides part of it: weigh it heavily.
          score += segmentInside(route[i]!, route[i + 1]!, c.box) * 20;
        }
      }
      for (const o of obstacles) score += overlapArea(c.box, o) * 2;
      for (const p of placed) score += overlapArea(c.box, p) * 4;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
      if (score === 0) break;
    }
    if (!best) continue;
    placed.push(best.box);
    result.set(req.conn.id, best.place);
  }
  return result;
}
