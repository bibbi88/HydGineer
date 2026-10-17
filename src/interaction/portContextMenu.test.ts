import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { createValve52 } from '../components/valve52';
import { createSource, SOURCE_TYPE } from '../components/source';
import { createThrottleValve } from '../components/throttleValve';
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

describe('port right-click "add pressure source" menu', () => {
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

  it('adds a wired-up pressure source when none is attached yet', () => {
    const valve = createValve52(compLayer(), 0, 0);
    appState.addComponent(valve);
    wireUpPortContextMenu(valve, mockViewport(), spawnSourceStub);

    expect(appState.components).toHaveLength(1);
    openPortMenu(getPort(valve, '1'));
    clickMenuItem('Pressure source');

    expect(appState.components).toHaveLength(2);
    expect(appState.connections).toHaveLength(1);
    const conn = appState.connections[0];
    if (!conn) throw new Error('expected a connection');
    const otherId = conn.from.id === valve.id ? conn.to.id : conn.from.id;
    expect(appState.findComponent(otherId)?.type).toBe(SOURCE_TYPE);
  });

  it('does not add a second source if the port already has one', () => {
    const valve = createValve52(compLayer(), 0, 0);
    appState.addComponent(valve);
    wireUpPortContextMenu(valve, mockViewport(), spawnSourceStub);

    openPortMenu(getPort(valve, '1'));
    clickMenuItem('Pressure source');
    expect(appState.components).toHaveLength(2);

    openPortMenu(getPort(valve, '1'));
    clickMenuItem('✓ Pressure source');
    expect(appState.components).toHaveLength(2);
    expect(appState.connections).toHaveLength(1);
  });

  it('removing via "None" deletes the source too when nothing else uses it', () => {
    const valve = createValve52(compLayer(), 0, 0);
    appState.addComponent(valve);
    wireUpPortContextMenu(valve, mockViewport(), spawnSourceStub);

    openPortMenu(getPort(valve, '1'));
    clickMenuItem('Pressure source');
    expect(appState.components).toHaveLength(2);

    openPortMenu(getPort(valve, '1'));
    clickMenuItem('None');
    expect(appState.components).toHaveLength(1);
    expect(appState.connections).toHaveLength(0);
  });

  it('removing via "None" keeps a source that still feeds another port', () => {
    const valveA = createValve52(compLayer(), 0, 0);
    const valveB = createValve52(compLayer(), 200, 0);
    appState.addComponent(valveA);
    appState.addComponent(valveB);
    wireUpPortContextMenu(valveA, mockViewport(), spawnSourceStub);
    wireUpPortContextMenu(valveB, mockViewport(), spawnSourceStub);

    openPortMenu(getPort(valveA, '1'));
    clickMenuItem('Pressure source');
    const source = appState.components.find((c) => c.type === SOURCE_TYPE);
    if (!source) throw new Error('expected a source to have been added');

    // Manually wire the same source to valveB's port too, simulating a shared supply.
    createConnection({ id: source.id, port: 'OUT' }, { id: valveB.id, port: '1' });
    expect(appState.connections).toHaveLength(2);

    openPortMenu(getPort(valveA, '1'));
    clickMenuItem('None');
    // The wire to valveA is gone, but the source itself remains (still feeding valveB).
    expect(appState.components.some((c) => c.id === source.id)).toBe(true);
    expect(appState.connections).toHaveLength(1);
  });
});

function menuLabels(): string[] {
  return Array.from(document.querySelectorAll('.ctxmenu button')).map((b) => b.textContent ?? '');
}

function openSilencerMenu(comp: Component, portKey: string): void {
  const symbol = comp.el.querySelector(`.silencerSymbol[data-port="${portKey}"]`);
  if (!symbol) throw new Error(`no silencer symbol for port "${portKey}"`);
  symbol.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
  );
}

describe('port right-click "silencer" option', () => {
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

  function setup(): Component {
    const valve = createValve52(compLayer(), 0, 0);
    appState.addComponent(valve);
    wireUpPortContextMenu(valve, mockViewport(), spawnSourceStub);
    return valve;
  }

  it('is offered on exhaust ports only', () => {
    const valve = setup();
    openPortMenu(getPort(valve, '1'));
    expect(menuLabels()).toEqual(['✓ None', 'Pressure source']);
  });

  it('toggles the built-in silencer, reachable from the silencer symbol while it is fitted', () => {
    const valve = setup();
    expect(valve.snapshot().silencer3).toBe('silencer');

    // A silenced port's own dot takes no clicks, so the menu opens from the symbol instead.
    openSilencerMenu(valve, '3');
    expect(menuLabels()).toEqual(['None', 'Pressure source', '✓ Silencer']);
    clickMenuItem('None');
    expect(valve.snapshot().silencer3).toBe('none');

    openPortMenu(getPort(valve, '3'));
    expect(menuLabels()).toEqual(['✓ None', 'Pressure source', 'Silencer']);
    clickMenuItem('Silencer');
    expect(valve.snapshot().silencer3).toBe('silencer');
  });

  it('replaces a quick-added source, and is not offered on a port carrying another wire', () => {
    const valve = setup();
    openSilencerMenu(valve, '5');
    clickMenuItem('Pressure source');
    expect(valve.snapshot().silencer5).toBe('none');
    expect(appState.components).toHaveLength(2);

    openPortMenu(getPort(valve, '5'));
    clickMenuItem('Silencer');
    expect(valve.snapshot().silencer5).toBe('silencer');
    expect(appState.components).toHaveLength(1);
    expect(appState.connections).toHaveLength(0);

    // Port 3 wired to an ordinary component: no silencer offered.
    openSilencerMenu(valve, '3');
    clickMenuItem('None');
    const other = createValve52(compLayer(), 300, 0);
    appState.addComponent(other);
    createConnection({ id: valve.id, port: '3' }, { id: other.id, port: '1' });
    openPortMenu(getPort(valve, '3'));
    expect(menuLabels()).not.toContain('Silencer');
  });

  it('can fit a silencer to either end of a throttle valve (exhaust throttling)', () => {
    const throttle = createThrottleValve(compLayer(), 0, 0);
    appState.addComponent(throttle);
    wireUpPortContextMenu(throttle, mockViewport(), spawnSourceStub);
    expect(throttle.snapshot().silencerOUT).toBe('none');

    openPortMenu(getPort(throttle, 'OUT'));
    expect(menuLabels()).toEqual(['✓ None', 'Pressure source', 'Silencer']);
    clickMenuItem('Silencer');
    expect(throttle.snapshot().silencerOUT).toBe('silencer');
    expect(throttle.snapshot().silencerIN).toBe('none');

    openSilencerMenu(throttle, 'OUT');
    clickMenuItem('None');
    expect(throttle.snapshot().silencerOUT).toBe('none');
  });
});
