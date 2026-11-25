import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { stepSimulation, resetHydraulics } from './engine';
import { resetSignals, setSignal } from './signals';
import { currentRun, recordStep, resetRecorder, seriesId, startRun, type Run } from './recorder';
import { eventTime, eventWindow, ratio, seriesStats } from './diagramAnalysis';
import { createHydPressureSource, createHydPump, createHydTank } from '../components/hyd/supply';
import { createHydCylinderDouble } from '../components/hyd/actuators';
import { createHydValve42 } from '../components/hyd/valves';
import type { Component } from '../core/types';

/** A run built by hand: power 2 kW for 0-1 s, 4 kW for 1-2 s; signal S1 on at 0.5 s, off at 1.5 s. */
function handRun(): Run {
  const t: number[] = [];
  const v: number[] = [];
  for (let i = 0; i <= 200; i++) {
    t.push(i / 100);
    v.push(i <= 100 ? 2 : 4);
  }
  return {
    t,
    series: new Map([['1:p', { compId: 1, key: 'p', label: 'P', unit: 'kW', values: v }]]),
    signals: new Map([
      [
        'S1',
        [
          { t: 0, on: false },
          { t: 0.5, on: true },
          { t: 1.5, on: false },
        ],
      ],
    ]),
    startedAt: new Date(),
  };
}

describe('diagram analysis', () => {
  it('finds events: start, end, a time, the nth time a signal turns on or off', () => {
    const run = handRun();
    expect(eventTime(run, { kind: 'start' })).toBe(0);
    expect(eventTime(run, { kind: 'end' })).toBe(2);
    expect(eventTime(run, { kind: 'signal', name: 's1', edge: 'on', n: 1 })).toBe(0.5);
    expect(eventTime(run, { kind: 'signal', name: 'S1', edge: 'off', n: 1 })).toBe(1.5);
    expect(eventTime(run, { kind: 'signal', name: 'S1', edge: 'on', n: 2 })).toBeNull();
    expect(
      eventWindow(
        run,
        { kind: 'signal', name: 'S1', edge: 'on', n: 1 },
        { kind: 'signal', name: 'S1', edge: 'off', n: 1 },
      ),
    ).toEqual({ t0: 0.5, t1: 1.5 });
  });

  it('min, max, time average and energy over a window', () => {
    const run = handRun();
    const s = run.series.get('1:p')!;
    const all = seriesStats(run, s, 0, 2);
    expect(all.min).toBe(2);
    expect(all.max).toBe(4);
    expect(all.integral).toBeCloseTo(6, 1); // kJ
    expect(all.mean).toBeCloseTo(3, 1);
    const part = seriesStats(run, s, 0.5, 1.5);
    expect(part.integral).toBeCloseTo(3, 1);
    expect(ratio(run, s, s, 'integral', 0, 2)).toBeCloseTo(1);
  });
});

function wire(a: Component, ap: string, b: Component, bp: string): void {
  appState.addConnection({
    id: appState.connections.length + 1,
    from: { id: a.id, port: ap },
    to: { id: b.id, port: bp },
    guides: [],
    stubStartLen: null,
    stubEndLen: null,
    pathEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    hitEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    labelEl: document.createElementNS('http://www.w3.org/2000/svg', 'text'),
  });
}

describe('recording a run', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    resetHydraulics();
    resetSignals();
    resetRecorder();
    appState.setMode(Modes.PLAY);
  });

  it('records the pump and cylinder powers; the cylinder gets less energy than the pump gives', () => {
    const layer = (): HTMLElement => document.createElement('div');
    const pump = createHydPump(layer(), 0, 0);
    pump.restore({ ...pump.snapshot(), displacement: 10, speed: 1200 });
    const valve = createHydValve42(layer(), 0, -200);
    valve.restore({ ...valve.snapshot(), key: 'Y1' });
    const cyl = createHydCylinderDouble(layer(), 0, -400);
    cyl.restore({ ...cyl.snapshot(), bore: 50, rodD: 30, stroke: 300, load: 5000 });
    const tank = createHydTank(layer(), 200, 0);
    for (const c of [pump, valve, cyl, tank]) appState.addComponent(c);
    wire(pump, 'P', valve, 'P');
    wire(valve, 'A', cyl, 'A');
    wire(valve, 'B', cyl, 'B');
    wire(valve, 'T', tank, 'T');
    startRun();
    setSignal('Y1', true);
    for (let i = 0; i < 240; i++) {
      stepSimulation(1 / 60);
      recordStep(1 / 60);
    }
    const run = currentRun()!;
    expect(run.t.length).toBe(240);
    expect(run.t[239]).toBeCloseTo(4);
    const pumpShaft = run.series.get(seriesId(pump.id, 'pShaft'))!;
    const toLoad = run.series.get(seriesId(cyl.id, 'pLoad'))!;
    const x = run.series.get(seriesId(cyl.id, 'x'))!;
    expect(pumpShaft.unit).toBe('kW');
    // The cylinder reaches the end of its stroke.
    expect(Math.max(...x.values)).toBeCloseTo(300, 0);
    const eta = ratio(run, toLoad, pumpShaft, 'integral', 0, run.t[239]!);
    expect(eta).toBeGreaterThan(0);
    expect(eta).toBeLessThan(1);
    expect(run.signals.get('Y1')?.[0]).toEqual({ t: 0, on: true });
  });

  it('a pressure source records its flow and power', () => {
    const src = createHydPressureSource(document.createElement('div'), 0, 0);
    appState.addComponent(src);
    startRun();
    stepSimulation(1 / 60);
    recordStep(1 / 60);
    expect([...currentRun()!.series.values()].map((s) => s.key)).toEqual(['q', 'p', 'pHyd']);
  });
});
