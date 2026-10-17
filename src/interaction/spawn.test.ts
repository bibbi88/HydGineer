import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { placeComponent, spawnComponent } from './spawn';
import { initWires } from '../wires/connection';
import { SOURCE_TYPE } from '../components/source';
import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';

const ctx: ComponentFactoryContext = { compLayer: document.createElement('div') };
const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

describe('placeComponent', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    appState.setMode(Modes.STOP);
    initWires(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement,
      viewport,
      document.createElement('div'),
    );
  });

  it('places a component while stopped', () => {
    const placed = placeComponent(SOURCE_TYPE, ctx, viewport, 0, 0);
    expect(placed).not.toBeNull();
    expect(appState.components).toHaveLength(1);
  });

  for (const mode of [Modes.PLAY, Modes.PAUSE]) {
    it(`refuses, and adds nothing, while the simulation is ${mode}`, () => {
      appState.setMode(mode);
      const placed = placeComponent(SOURCE_TYPE, ctx, viewport, 0, 0);
      expect(placed).toBeNull();
      expect(appState.components).toHaveLength(0);
    });
  }

  it('places again once the simulation is stopped', () => {
    appState.setMode(Modes.PLAY);
    placeComponent(SOURCE_TYPE, ctx, viewport, 0, 0);
    expect(appState.components).toHaveLength(0);

    appState.setMode(Modes.STOP);
    placeComponent(SOURCE_TYPE, ctx, viewport, 0, 0);
    expect(appState.components).toHaveLength(1);
  });

  it('leaves spawnComponent itself unguarded, so a load or undo can still rebuild mid-run', () => {
    // Loading a project, undo/redo and paste all rebuild through spawnComponent directly and
    // have to keep working whatever mode the app is in - only the user-driven placement paths
    // are gated. This is the distinction placeComponent exists to draw.
    appState.setMode(Modes.PLAY);
    const rebuilt = spawnComponent(SOURCE_TYPE, ctx, viewport, 0, 0);
    expect(rebuilt).toBeDefined();
    expect(appState.components).toHaveLength(1);
  });
});
