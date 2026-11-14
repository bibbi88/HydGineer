import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { copySelection, initClipboard, pasteClipboard } from './clipboard';
import { addToSelection, clearSelection } from './selection';
import {
  getComponentRotation,
  isComponentMirrored,
  setComponentMirrored,
  setComponentRotation,
} from './componentContextMenu';
import { createConnection, initWires } from '../wires/connection';
import { createJunction } from '../components/junction';
import { createHydCylinderDouble as createCylinderDouble } from '../components/hyd/actuators';
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
  clearSelection();
  const workspace = document.createElement('div');
  initWires(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), viewport, workspace);
  initClipboard({ compLayer: layer() }, viewport, workspace);
});

describe('copy and paste', () => {
  it('keeps rotation, mirroring and dashed wires, and moves the bends with the copy', () => {
    const cyl = createCylinderDouble(layer(), 400, 100);
    const a = createJunction(layer(), 100, 100, 'V');
    const b = createJunction(layer(), 300, 300, 'V');
    for (const c of [cyl, a, b]) appState.addComponent(c);
    setComponentRotation(cyl, 90);
    setComponentMirrored(cyl, true);
    const wire = createConnection({ id: a.id, port: 'P' }, { id: b.id, port: 'P' });
    wire.guides = [
      { type: 'H', pos: 200 },
      { type: 'V', pos: 250 },
    ];
    wire.dashed = true;
    for (const c of [cyl, a, b]) addToSelection(c.id);

    copySelection();
    pasteClipboard(); // 24 px right and down

    const pastedCyl = appState.components.find((c) => c.type === cyl.type && c !== cyl)!;
    expect(getComponentRotation(pastedCyl)).toBe(90);
    expect(isComponentMirrored(pastedCyl)).toBe(true);

    const pastedWire = appState.connections.find((c) => c !== wire)!;
    expect(pastedWire.dashed).toBe(true);
    expect(pastedWire.guides).toEqual([
      { type: 'H', pos: 224 },
      { type: 'V', pos: 274 },
    ]);
    // Its own bends: moving the copy's leaves the original's alone.
    pastedWire.guides[0]!.pos = 999;
    expect(wire.guides[0]!.pos).toBe(200);
  });
});
