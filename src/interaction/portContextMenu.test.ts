import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { createHydValve43 as createValve52 } from '../components/hyd/valves';
import {
  createHydTank as createSource,
  HYD_TANK_TYPE as SOURCE_TYPE,
} from '../components/hyd/supply';
import { wireUpPortContextMenu } from './portContextMenu';
import { createConnection, initWires } from '../wires/connection';
import type { Component, PortDef } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

function mockViewport(): ViewportAdapter {
  return {
    clientToWorld: (x, y) => ({ x, y }),
    applyTransform: () => {},
    getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
    setTransform: () => {},
    setGridVisible: () => {},
  };
}

/** Mimics just enough of spawnComponent for this test: creates a real source and registers it,
 * without the drag/link/context-menu DOM wiring those calls also do. */
function spawnSourceStub(_type: string, x: number, y: number): Component {
  const comp = createSource(compLayer(), x, y);
  appState.addComponent(comp);
  return comp;
}

function getPort(comp: Component, key: string): PortDef {
  const port = comp.ports[key];
  if (!port) throw new Error(`port "${key}" not found`);
  return port;
}

function openPortMenu(port: PortDef): void {
  port.el.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
  );
}

function clickMenuItem(label: string): void {
  const buttons = Array.from(document.querySelectorAll('.ctxmenu button'));
  const btn = buttons.find((b) => b.textContent === label);
  if (!btn) throw new Error(`menu item "${label}" not found`);
  (btn as HTMLButtonElement).click();
}

describe('port right-click "add tank" menu', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    document.body.replaceChildren();
    initWires(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
      mockViewport(),
      document.createElement('div'),
    );
  });

  it('adds a wired-up tank when none is attached yet', () => {
    const valve = createValve52(compLayer(), 0, 0);
    appState.addComponent(valve);
    wireUpPortContextMenu(valve, mockViewport(), spawnSourceStub);

    expect(appState.components).toHaveLength(1);
    openPortMenu(getPort(valve, 'T'));
    clickMenuItem('Tank');

    expect(appState.components).toHaveLength(2);
    expect(appState.connections).toHaveLength(1);
    const conn = appState.connections[0];
    if (!conn) throw new Error('expected a connection');
    const otherId = conn.from.id === valve.id ? conn.to.id : conn.from.id;
    expect(appState.findComponent(otherId)?.type).toBe(SOURCE_TYPE);
  });

  it('does not add a second tank if the port already has one', () => {
    const valve = createValve52(compLayer(), 0, 0);
    appState.addComponent(valve);
    wireUpPortContextMenu(valve, mockViewport(), spawnSourceStub);

    openPortMenu(getPort(valve, 'T'));
    clickMenuItem('Tank');
    expect(appState.components).toHaveLength(2);

    openPortMenu(getPort(valve, 'T'));
    clickMenuItem('✓ Tank');
    expect(appState.components).toHaveLength(2);
    expect(appState.connections).toHaveLength(1);
  });

  it('removing via "None" deletes the source too when nothing else uses it', () => {
    const valve = createValve52(compLayer(), 0, 0);
    appState.addComponent(valve);
    wireUpPortContextMenu(valve, mockViewport(), spawnSourceStub);

    openPortMenu(getPort(valve, 'T'));
    clickMenuItem('Tank');
    expect(appState.components).toHaveLength(2);

    openPortMenu(getPort(valve, 'T'));
    clickMenuItem('None');
    expect(appState.components).toHaveLength(1);
    expect(appState.connections).toHaveLength(0);
  });

  it('removing via "None" keeps a tank that still feeds another port', () => {
    const valveA = createValve52(compLayer(), 0, 0);
    const valveB = createValve52(compLayer(), 200, 0);
    appState.addComponent(valveA);
    appState.addComponent(valveB);
    wireUpPortContextMenu(valveA, mockViewport(), spawnSourceStub);
    wireUpPortContextMenu(valveB, mockViewport(), spawnSourceStub);

    openPortMenu(getPort(valveA, 'T'));
    clickMenuItem('Tank');
    const source = appState.components.find((c) => c.type === SOURCE_TYPE);
    if (!source) throw new Error('expected a tank to have been added');

    // Manually wire the same source to valveB's port too, simulating a shared supply.
    createConnection({ id: source.id, port: 'T' }, { id: valveB.id, port: 'T' });
    expect(appState.connections).toHaveLength(2);

    openPortMenu(getPort(valveA, 'T'));
    clickMenuItem('None');
    // The wire to valveA is gone, but the source itself remains (still feeding valveB).
    expect(appState.components.some((c) => c.id === source.id)).toBe(true);
    expect(appState.connections).toHaveLength(1);
  });
});
