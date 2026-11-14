import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from './AppState';
import { initWires } from '../wires/connection';
import { loadProject } from '../persistence/project';
import type { ProjectFileV1 } from '../persistence/schema';
import type { ViewportAdapter } from '../ui/viewport';

const viewport: ViewportAdapter = {
  clientToWorld: (x, y) => ({ x, y }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};
const layer = (): HTMLElement => document.createElement('div');

/** How many change and mode subscriptions there are (private to AppState). */
function subscriptions(): number {
  const s = appState as unknown as { changeListeners: unknown[]; modeListeners: unknown[] };
  return s.changeListeners.length + s.modeListeners.length;
}

beforeEach(() => {
  appState.components = [];
  appState.connections = [];
  initWires(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), viewport, layer());
});

describe('components that are gone', () => {
  it('stop listening: reloading a circuit 20 times leaves no extra subscriptions', () => {
    const file = {
      schemaVersion: 1,
      name: 'p',
      comps: [
        { id: 1, type: 'elecContact', x: 100, y: 100, data: { key: 'a1' } },
        { id: 2, type: 'hydCylinderDouble', x: 400, y: 100, data: {} },
        { id: 3, type: 'hydCylinderSingle', x: 400, y: 300, data: {} },
        { id: 4, type: 'elecPushButton', x: 100, y: 300, data: {} },
      ],
      conns: [],
    } as unknown as ProjectFileV1;
    loadProject(file, { compLayer: layer() }, viewport);
    const once = subscriptions();
    for (let i = 0; i < 20; i++) loadProject(file, { compLayer: layer() }, viewport);
    expect(appState.components).toHaveLength(4);
    expect(subscriptions()).toBe(once);
  });
});
