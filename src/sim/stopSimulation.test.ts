import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { stopSimulation } from './stopSimulation';
import { getSignal, setSignal } from './signals';
import { canUndo, initHistory, pushHistory, resetHistory, undo } from '../history/historyStore';
import { initWires } from '../wires/connection';
import { createHydCylinderDouble as createCylinderDouble } from '../components/hyd/actuators';
import { createHydTank as createSource } from '../components/hyd/supply';
import type { ViewportAdapter } from '../ui/viewport';

const viewport: ViewportAdapter = {
  clientToWorld: (x, y) => ({ x, y }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};
const layer = (): HTMLElement => document.createElement('div');

beforeEach(() => {
  appState.components = [];
  appState.connections = [];
  appState.setMode(Modes.STOP);
  initWires(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), viewport, layer());
  initHistory({ compLayer: layer() }, viewport);
  resetHistory();
});

describe('stopping the simulation', () => {
  it('puts every component back at rest and clears the sensor signals', () => {
    const cyl = createCylinderDouble(layer(), 0, 0);
    appState.addComponent(cyl);
    appState.setMode(Modes.PLAY);
    cyl.restore({ ...cyl.snapshot(), pos: 0.7 });
    setSignal('a1', true);

    stopSimulation();

    expect(appState.mode).toBe(Modes.STOP);
    expect(cyl.snapshot().pos).toBe(0);
    expect(getSignal('a1')).toBe(false);
  });

  it('records nothing while running, and undo waits until stopped', () => {
    // As main.ts does: every change goes to the undo history.
    appState.onChange(() => pushHistory('p'));
    pushHistory('p');
    appState.addComponent(createSource(layer(), 0, 0));
    appState.setMode(Modes.PLAY);
    appState.addComponent(createSource(layer(), 100, 0)); // a change during the run
    undo();
    expect(appState.components).toHaveLength(2);

    // Stopping records the run's changes as one step, at rest - so undo takes back that one.
    stopSimulation();
    expect(canUndo()).toBe(true);
    undo();
    expect(appState.components).toHaveLength(1);
  });
});
