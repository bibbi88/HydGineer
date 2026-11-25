/**
 * The diagram recorder: while the simulation runs, every step's simulated time, every
 * component's measured quantities (Component.probes - positions, speeds, forces, flows, powers)
 * and every signal's changes (push buttons, sensors, relays) are kept, so they can be plotted
 * and compared afterwards (ui/diagramPanel.ts, sim/diagramAnalysis.ts).
 *
 * A run starts when the simulation is started from stopped and is kept after it stops, until the
 * next start. Single steps while paused are recorded too.
 */
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { listSignals } from './signals';

export interface RecordedSeries {
  compId: number;
  key: string;
  label: string;
  unit: string;
  /** One value per sample (NaN before the quantity first appeared). */
  values: number[];
}

export interface SignalChange {
  t: number;
  on: boolean;
}

export interface Run {
  /** Simulated time of each sample, s. */
  t: number[];
  series: Map<string, RecordedSeries>;
  /** Each signal's changes, in order (its state at the start counts as a change at t = 0). */
  signals: Map<string, SignalChange[]>;
  /** Wall-clock time the run started (for exports). */
  startedAt: Date;
}

/** Samples kept at most per run - about 50 minutes at 60 steps a second. */
export const MAX_SAMPLES = 200_000;

let run: Run | null = null;
let simTime = 0;
const listeners: Array<() => void> = [];

export function seriesId(compId: number, key: string): string {
  return `${compId}:${key}`;
}

export function currentRun(): Run | null {
  return run;
}

export function onRecording(cb: () => void): void {
  listeners.push(cb);
}

function notify(): void {
  for (const cb of listeners) cb();
}

/** A new, empty run (the simulation was started from stopped). */
export function startRun(): void {
  run = { t: [], series: new Map(), signals: new Map(), startedAt: new Date() };
  simTime = 0;
  notify();
}

/** Records one simulation step of `dt` seconds - call after the step has been taken. */
export function recordStep(dt: number): void {
  if (!run) startRun();
  const r = run!;
  if (r.t.length >= MAX_SAMPLES) return;
  simTime += dt;
  const i = r.t.length;
  r.t.push(simTime);
  for (const c of appState.components) {
    const probes = c.probes?.();
    if (!probes) continue;
    for (const p of probes) {
      const id = seriesId(c.id, p.key);
      let s = r.series.get(id);
      if (!s) {
        s = { compId: c.id, key: p.key, label: p.label, unit: p.unit, values: [] };
        r.series.set(id, s);
      }
      while (s.values.length < i) s.values.push(Number.NaN);
      s.values.push(Number.isFinite(p.value) ? p.value : Number.NaN);
    }
  }
  for (const [name, on] of listSignals()) {
    let changes = r.signals.get(name);
    if (!changes) {
      changes = [{ t: i === 0 ? 0 : simTime, on }];
      r.signals.set(name, changes);
      continue;
    }
    if (changes[changes.length - 1]!.on !== on) changes.push({ t: simTime, on });
  }
  notify();
}

/** The value of `s` at sample `i` (NaN where it wasn't measured). */
export function valueAt(s: RecordedSeries, i: number): number {
  return i < s.values.length ? s.values[i]! : Number.NaN;
}

/** For tests: forget the run. */
export function resetRecorder(): void {
  run = null;
  simTime = 0;
}

/** Starts a new run whenever the simulation is started from stopped. */
export function initRecorder(): void {
  let last = appState.mode;
  appState.onModeChange(() => {
    if (last === Modes.STOP && appState.mode !== Modes.STOP) startRun();
    last = appState.mode;
  });
}
