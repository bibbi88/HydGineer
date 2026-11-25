/**
 * Working out from a recorded run (sim/recorder.ts): when an event happened, and over a window
 * between two events each quantity's start and end value, minimum, maximum, time average and
 * integral over time - energy for a power, volume for a flow, distance for a speed - and ratios
 * between quantities, such as an efficiency (energy out / energy in).
 */
import type { DiagramEvent, RatioMeasure } from '../app/diagrams';
import type { RecordedSeries, Run } from './recorder';

/** When `e` happened in `run` (s), or null if it didn't. A signal event counts its occurrences
 * from `after` on (the window's start, for its end). */
export function eventTime(run: Run, e: DiagramEvent, after = 0): number | null {
  const t = run.t;
  if (t.length === 0) return null;
  switch (e.kind) {
    case 'start':
      return 0;
    case 'end':
      return t[t.length - 1]!;
    case 'time':
      return e.t >= 0 && e.t <= t[t.length - 1]! ? e.t : null;
    case 'signal': {
      const changes = run.signals.get(e.name.trim().toUpperCase()) ?? [];
      let count = 0;
      for (let i = 0; i < changes.length; i++) {
        const c = changes[i]!;
        if (c.t < after) continue;
        // The state a signal starts the run in isn't a change - unless it starts on, which
        // counts as switching on at the start.
        if (i === 0 && !c.on) continue;
        if (c.on === (e.edge === 'on') && ++count >= Math.max(1, e.n)) return c.t;
      }
      return null;
    }
  }
}

/** The window [from, to] (s), or null if an event didn't happen or `to` comes before `from`. */
export function eventWindow(
  run: Run,
  from: DiagramEvent,
  to: DiagramEvent,
): { t0: number; t1: number } | null {
  const t0 = eventTime(run, from);
  if (t0 === null) return null;
  // A window's end that is the same kind of event as its start is the next one after it.
  const t1 = eventTime(run, to, t0 + (sameSignal(from, to) ? 1e-9 : 0));
  if (t1 === null || t1 < t0) return null;
  return { t0, t1 };
}

function sameSignal(a: DiagramEvent, b: DiagramEvent): boolean {
  return a.kind === 'signal' && b.kind === 'signal' && a.name === b.name && a.edge === b.edge;
}

export interface SeriesStats {
  start: number;
  end: number;
  min: number;
  max: number;
  /** Time average. */
  mean: number;
  /** ∫ value dt, in the integral's unit (integralUnit), or NaN where it means nothing. */
  integral: number;
}

/** What the integral over time of a quantity in `unit` is, and the factor from value·s to it. */
export function integralUnit(unit: string): { unit: string; factor: number; name: string } | null {
  switch (unit) {
    case 'kW':
      return { unit: 'kJ', factor: 1, name: 'Energy' };
    case 'L/min':
      return { unit: 'L', factor: 1 / 60, name: 'Volume' };
    case 'm/s':
      return { unit: 'm', factor: 1, name: 'Distance' };
    case 'rpm':
      return { unit: 'rev', factor: 1 / 60, name: 'Revolutions' };
    default:
      return null;
  }
}

/** The value of `s` at time `time`, interpolated between samples. */
export function valueAtTime(run: Run, s: RecordedSeries, time: number): number {
  const t = run.t;
  let lo = 0;
  let hi = t.length - 1;
  if (hi < 0) return Number.NaN;
  if (time <= t[0]!) return s.values[0] ?? Number.NaN;
  if (time >= t[hi]!) return s.values[hi] ?? Number.NaN;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= time) lo = mid;
    else hi = mid;
  }
  const a = s.values[lo] ?? Number.NaN;
  const b = s.values[hi] ?? Number.NaN;
  const f = (time - t[lo]!) / (t[hi]! - t[lo]! || 1);
  return a + (b - a) * f;
}

/** Statistics of `s` over [t0, t1]. */
export function seriesStats(run: Run, s: RecordedSeries, t0: number, t1: number): SeriesStats {
  const t = run.t;
  const pts: Array<[number, number]> = [[t0, valueAtTime(run, s, t0)]];
  for (let i = 0; i < t.length; i++) {
    const ti = t[i]!;
    if (ti > t0 && ti < t1) pts.push([ti, s.values[i] ?? Number.NaN]);
  }
  if (t1 > t0) pts.push([t1, valueAtTime(run, s, t1)]);
  let min = Infinity;
  let max = -Infinity;
  let area = 0;
  let span = 0;
  for (let i = 0; i < pts.length; i++) {
    const v = pts[i]![1];
    if (Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    if (i === 0) continue;
    const [ta, va] = pts[i - 1]!;
    const [tb, vb] = pts[i]!;
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    area += ((va + vb) / 2) * (tb - ta);
    span += tb - ta;
  }
  const iu = integralUnit(s.unit);
  return {
    start: pts[0]![1],
    end: pts[pts.length - 1]![1],
    min: Number.isFinite(min) ? min : Number.NaN,
    max: Number.isFinite(max) ? max : Number.NaN,
    mean: span > 0 ? area / span : pts[0]![1],
    integral: iu ? area * iu.factor : Number.NaN,
  };
}

/** numerator / denominator over [t0, t1], by `measure`; NaN if the denominator is 0. */
export function ratio(
  run: Run,
  num: RecordedSeries,
  den: RecordedSeries,
  measure: RatioMeasure,
  t0: number,
  t1: number,
): number {
  const a = seriesStats(run, num, t0, t1);
  const b = seriesStats(run, den, t0, t1);
  const pick = (st: SeriesStats): number =>
    measure === 'mean' ? st.mean : measure === 'max' ? st.max : st.integral;
  // An integral that means nothing (no unit for it) falls back to the time average: for two
  // quantities measured over the same window, their ratio is the same.
  const x = measure === 'integral' && Number.isNaN(a.integral) ? a.mean : pick(a);
  const y = measure === 'integral' && Number.isNaN(b.integral) ? b.mean : pick(b);
  return y === 0 || !Number.isFinite(y) ? Number.NaN : x / y;
}
