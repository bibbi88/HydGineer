import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { createConnection, initWires, redrawMovedConnections } from './connection';
import { createHydPump } from '../components/hyd/supply';
import { createHydValve42 } from '../components/hyd/valves';
import { createHydCylinderDouble } from '../components/hyd/actuators';
import type { ViewportAdapter } from '../ui/viewport';

const viewport: ViewportAdapter = {
  clientToWorld: (x, y) => ({ x, y }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

let compLayer: HTMLElement;

beforeEach(() => {
  appState.components = [];
  appState.connections = [];
  const workspace = document.createElement('div');
  compLayer = document.createElement('div');
  workspace.appendChild(compLayer);
  initWires(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), viewport, workspace);
});

describe('redrawing wires during a run', () => {
  it('redraws only the wires on a component whose ports moved', async () => {
    const pump = createHydPump(compLayer, 0, 0);
    const valve = createHydValve42(compLayer, 300, 0);
    const cyl = createHydCylinderDouble(compLayer, 600, 0);
    for (const c of [pump, valve, cyl]) appState.addComponent(c);
    createConnection({ id: pump.id, port: 'P' }, { id: valve.id, port: 'P' });
    createConnection({ id: valve.id, port: 'A' }, { id: cyl.id, port: 'A' });
    redrawMovedConnections(); // whatever setting up moved

    // A frame where nothing moved: nothing to redraw.
    expect(redrawMovedConnections()).toBe(0);

    // The cylinder's rod moves - no port with it.
    cyl.restore({ ...cyl.snapshot(), pos: 0.5 });
    await Promise.resolve();
    expect(redrawMovedConnections()).toBe(0);

    // The valve's boxes slide when it switches - its ports stay where they are.
    valve.el.querySelector('.hydSpool')!.setAttribute('transform', 'translate(-40,0)');
    await Promise.resolve();
    expect(redrawMovedConnections()).toBe(0);

    // A group carrying ports moves (as a pneumatic valve's pilot ports do): its wires only.
    const portGroup = Array.from(valve.el.querySelectorAll('g')).find((g) =>
      g.querySelector('.port'),
    )!;
    portGroup.setAttribute('transform', 'translate(0,5)');
    await Promise.resolve();
    expect(redrawMovedConnections()).toBe(2);
  });
});
