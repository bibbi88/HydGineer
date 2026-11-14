import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { createConnection, initWires } from '../wires/connection';
import { createJunction } from '../components/junction';
import { loadProject, serializeProject } from './project';
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

describe('wire bends in snapshots', () => {
  it('are copies: moving a bend later leaves the saved snapshot as it was', () => {
    const a = createJunction(layer(), 100, 100, 'V');
    const b = createJunction(layer(), 300, 300, 'V');
    appState.addComponent(a);
    appState.addComponent(b);
    const conn = createConnection({ id: a.id, port: 'P' }, { id: b.id, port: 'P' });
    conn.guides = [{ type: 'H', pos: 200 }];

    const snap = serializeProject('p');
    conn.guides[0]!.pos = 250; // a bend dragged after the snapshot
    expect(snap.conns[0]!.guides[0]!.pos).toBe(200);

    loadProject(snap, { compLayer: layer() }, viewport);
    const loaded = appState.connections[0]!;
    loaded.guides[0]!.pos = 260;
    expect(snap.conns[0]!.guides[0]!.pos).toBe(200);
  });
});
