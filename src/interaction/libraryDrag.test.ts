import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { initLibraryDrag, isLibraryDragActive } from './libraryDrag';
import { initKeyboard } from './keyboard';
import { initWires } from '../wires/connection';
import { getComponentRotation } from './componentContextMenu';
import { selectOnly, clearSelection } from './selection';
import { createHydTank } from '../components/hyd/supply';
import { HYD_VALVE_42_TYPE, HYD_VALVE_43_TYPE } from '../components/hyd/valves';
import { initValveActuatorSwap } from './valveActuatorSwap';
import { createComponent } from '../components/registry';
import { HYD_CYLINDER_DOUBLE_TYPE } from '../components/hyd/actuators';
import { resetCylinderLetters } from '../components/shared/letters';
import type { ViewportAdapter } from '../ui/viewport';

const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

function key(k: string, shiftKey = false): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, cancelable: true }));
}

function rightClick(): MouseEvent {
  const e = new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return e;
}

describe('dragging a component out of the library', () => {
  let compLayer: HTMLElement;
  let workspaceEl: HTMLElement;

  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    appState.setMode(Modes.STOP);
    clearSelection();
    resetCylinderLetters();
    compLayer = document.createElement('div');
    document.body.appendChild(compLayer);
    workspaceEl = document.createElement('div');
    // jsdom has no layout: give the canvas a box so drops can land on it.
    workspaceEl.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 }) as DOMRect;
    initWires(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement,
      viewport,
      workspaceEl,
    );
    initKeyboard();
  });

  it('shows a see-through preview under the pointer that is not part of the diagram', () => {
    const drag = initLibraryDrag({ compLayer }, viewport, workspaceEl);
    drag.start(HYD_VALVE_42_TYPE);
    drag.move(203, 398);

    const ghost = compLayer.querySelector<HTMLElement>('.comp.dragGhost');
    expect(ghost).not.toBeNull();
    expect(ghost?.style.left).toBe('200px');
    expect(ghost?.style.top).toBe('400px');
    expect(appState.components).toHaveLength(0);

    drag.move(1500, 400); // off the canvas
    expect(ghost?.style.display).toBe('none');
    drag.cancel();
    expect(compLayer.querySelector('.dragGhost')).toBeNull();
  });

  it('turns with R (Shift+R back) and a right-click, and is placed turned', () => {
    const drag = initLibraryDrag({ compLayer }, viewport, workspaceEl);
    drag.start(HYD_VALVE_42_TYPE);
    drag.move(200, 400);
    key('r');
    key('r');
    key('R', true);
    const e = rightClick();
    expect(e.defaultPrevented).toBe(true);

    const ghost = compLayer.querySelector<HTMLElement>('.comp.dragGhost');
    expect(ghost?.dataset.rot).toBe('180');

    drag.drop(200, 400);
    expect(isLibraryDragActive()).toBe(false);
    expect(compLayer.querySelector('.dragGhost')).toBeNull();
    expect(appState.components).toHaveLength(1);
    const [placed] = appState.components;
    expect(placed?.type).toBe(HYD_VALVE_42_TYPE);
    expect(placed && getComponentRotation(placed)).toBe(180);
    expect(placed?.x).toBe(200);
  });

  it('places nothing when dropped outside the canvas or cancelled with Escape', () => {
    const drag = initLibraryDrag({ compLayer }, viewport, workspaceEl);
    drag.start(HYD_VALVE_42_TYPE);
    drag.move(200, 400);
    drag.drop(1500, 400);
    expect(appState.components).toHaveLength(0);

    drag.start(HYD_VALVE_42_TYPE);
    drag.move(200, 400);
    key('Escape');
    expect(isLibraryDragActive()).toBe(false);
    drag.drop(200, 400);
    expect(appState.components).toHaveLength(0);
  });

  it('swaps an interchangeable component it is dropped onto, in place', () => {
    initValveActuatorSwap({ compLayer }, viewport);
    const valve43 = createComponent(HYD_VALVE_43_TYPE, { compLayer }, 200, 400);
    appState.addComponent(valve43);

    const drag = initLibraryDrag({ compLayer }, viewport, workspaceEl);
    drag.start(HYD_VALVE_42_TYPE);
    drag.move(200, 400);
    expect(valve43.el.classList.contains('replaceTarget')).toBe(true);
    drag.drop(200, 400);

    expect(appState.components).toHaveLength(1);
    expect(appState.components[0]?.type).toBe(HYD_VALVE_42_TYPE);
    expect(appState.components[0]?.x).toBe(200);
  });

  it("doesn't use up a cylinder letter for the preview", () => {
    const drag = initLibraryDrag({ compLayer }, viewport, workspaceEl);
    drag.start(HYD_CYLINDER_DOUBLE_TYPE);
    drag.move(200, 400);
    drag.move(220, 400);
    drag.drop(220, 400);
    expect(appState.components[0]?.snapshot().letter).toBe('A');
  });
});

describe('R rotates the selection', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    appState.setMode(Modes.STOP);
    initKeyboard();
  });

  it('a quarter clockwise, Shift+R counter-clockwise, and not while simulating', () => {
    const source = createHydTank(document.createElement('div'), 100, 100);
    appState.addComponent(source);
    selectOnly(source.id);

    key('r');
    expect(getComponentRotation(source)).toBe(90);
    key('R', true);
    key('R', true);
    expect(getComponentRotation(source)).toBe(270);

    appState.setMode(Modes.PLAY);
    key('r');
    expect(getComponentRotation(source)).toBe(270);
  });
});
