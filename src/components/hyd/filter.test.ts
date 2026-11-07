import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../../app/AppState';
import { Modes } from '../../app/modes';
import { stepSimulation, resetHydraulics } from '../../sim/engine';
import { createHydFilter, createHydPump, createHydTank } from './supply';
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

/** Pump (12 L/min) through the filter to tank; returns the pressure ahead of the filter. */
function inletPressure(data: Record<string, unknown>): number {
  appState.components = [];
  appState.connections = [];
  resetHydraulics();
  const pump = createHydPump(layer(), 0, 0);
  pump.restore({ ...pump.snapshot(), displacement: 10, speed: 1200, etaV: 100 });
  const filter = createHydFilter(layer(), 0, -200);
  filter.restore({ ...filter.snapshot(), qNom: 12, ...data });
  const tank = createHydTank(layer(), 0, -400);
  for (const c of [pump, filter, tank]) appState.addComponent(c);
  wire(pump, 'P', filter, 'IN');
  wire(filter, 'OUT', tank, 'T');
  let frame;
  for (let i = 0; i < 60; i++) frame = stepSimulation(1 / 60);
  return frame!.solution.pressure.get(`${filter.id}:IN`) ?? NaN;
}

describe('filter', () => {
  beforeEach(() => appState.setMode(Modes.PLAY));

  it('drops 0.5 bar at its nominal flow while clean', () => {
    expect(inletPressure({})).toBeCloseTo(0.5, 1);
  });

  it('clogged, its bypass check opens at about 2 bar - without one the pressure builds up', () => {
    const bypassed = inletPressure({ clogged: 95 });
    expect(bypassed).toBeGreaterThan(2);
    expect(bypassed).toBeLessThan(4);
    expect(inletPressure({ clogged: 95, bypass: false })).toBeGreaterThan(50);
  });
});
