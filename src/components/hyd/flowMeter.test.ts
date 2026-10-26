import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../../app/AppState';
import { Modes } from '../../app/modes';
import { stepSimulation, resetHydraulics } from '../../sim/engine';
import { createHydFlowMeter, createHydPump, createHydTank } from './supply';
import type { Component } from '../../core/types';

const layer = (): HTMLElement => document.createElement('div');

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

function info(comp: Component): string {
  return comp.el.querySelector('.hydInfo')?.textContent ?? '';
}

describe('flow meter', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    resetHydraulics();
    appState.setMode(Modes.PLAY);
  });

  it('reads the flow through it and adds up the volume, barely restricting the line', () => {
    const pump = createHydPump(layer(), 0, 0);
    pump.restore({ ...pump.snapshot(), displacement: 10, speed: 1200, etaV: 100 });
    const meter = createHydFlowMeter(layer(), 0, -200);
    const tank = createHydTank(layer(), 0, -400);
    for (const c of [pump, meter, tank]) appState.addComponent(c);
    wire(pump, 'P', meter, 'IN');
    wire(meter, 'OUT', tank, 'T');

    let frame;
    for (let i = 0; i < 120; i++) frame = stepSimulation(1 / 60); // 2 s at 12 L/min
    expect(info(meter)).toContain('Q 12');
    expect(info(meter)).toContain('Σ 0.40 L');
    const pIn = frame!.solution.pressure.get(`${meter.id}:IN`) ?? NaN;
    expect(pIn).toBeLessThan(0.1);

    meter.reset?.();
    expect(info(meter)).toBe('');
  });
});
