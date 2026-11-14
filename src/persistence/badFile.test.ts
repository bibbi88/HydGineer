import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { initWires } from '../wires/connection';
import { createHydTank as createSource } from '../components/hyd/supply';
import { loadProject } from './project';
import { migrate } from './migrations';
import type { ProjectFileV1 } from './schema';
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
  initWires(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), viewport, layer());
});

describe('opening a bad project file', () => {
  it('refuses a file with parts this version does not know, naming them', () => {
    const file = {
      schemaVersion: 1,
      name: 'x',
      comps: [{ id: 1, type: 'hyperValve9000', x: 0, y: 0, data: {} }],
      conns: [],
    };
    expect(() => migrate(file)).toThrow(/hyperValve9000/);
  });

  it('refuses a file without components or wires', () => {
    expect(() => migrate({ schemaVersion: 1, name: 'x' })).toThrow();
  });

  it('accepts a file whose wires lack bends and stubs, and a part without settings', () => {
    const file = migrate({
      schemaVersion: 1,
      name: 'x',
      comps: [
        { id: 1, type: 'hydTank', x: 0, y: 0 },
        { id: 2, type: 'hydTank', x: 100, y: 0, data: {} },
      ],
      conns: [{ from: { id: 1, port: 'T' }, to: { id: 2, port: 'T' } }],
    });
    expect(file.comps[0]!.data).toEqual({});
    expect(file.conns[0]!.guides).toEqual([]);
    expect(file.conns[0]!.stubStartLen).toBeNull();
  });

  it('puts the open circuit back if a load fails partway', () => {
    appState.addComponent(createSource(layer(), 50, 50));
    appState.addComponent(createSource(layer(), 150, 50));
    const broken = {
      schemaVersion: 1,
      name: 'broken',
      comps: [
        { id: 1, type: 'hydTank', x: 0, y: 0, data: {} },
        { id: 2, type: 'hyperValve9000', x: 0, y: 0, data: {} },
      ],
      conns: [],
    } as unknown as ProjectFileV1;
    expect(() => loadProject(broken, { compLayer: layer() }, viewport)).toThrow();
    expect(appState.components.map((c) => [c.type, c.x])).toEqual([
      ['hydTank', 50],
      ['hydTank', 150],
    ]);
  });
});
