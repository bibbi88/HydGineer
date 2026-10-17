import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { initValveActuatorSwap, swapComponentType } from './valveActuatorSwap';
import { initWires, createConnection } from '../wires/connection';
import { createSource } from '../components/source';
import { createValve52, VALVE_52_TYPE } from '../components/valve52';
import { createValve52Mono, VALVE_52_MONO_TYPE } from '../components/valve52Mono';
import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

const ctx: ComponentFactoryContext = { compLayer: compLayer() };
const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

describe('swapComponentType: bistable <-> monostable 5/2 valve', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    initValveActuatorSwap(ctx, viewport);
    initWires(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement,
      viewport,
      document.createElement('div'),
    );
  });

  it('swapping bistable -> monostable keeps the shared ports wired and drops the extra pilot (12)', () => {
    const valve = createValve52(compLayer(), 100, 200);
    appState.addComponent(valve);
    const source = createSource(compLayer(), 0, 0);
    appState.addComponent(source);
    const pilotSource = createSource(compLayer(), 0, 400);
    appState.addComponent(pilotSource);

    createConnection({ id: source.id, port: 'OUT' }, { id: valve.id, port: '1' });
    createConnection({ id: pilotSource.id, port: 'OUT' }, { id: valve.id, port: '12' });

    swapComponentType(valve, VALVE_52_MONO_TYPE);

    const next = appState.components.find((c) => c.type === VALVE_52_MONO_TYPE);
    expect(next).toBeDefined();
    expect(next?.x).toBe(100);
    expect(next?.y).toBe(200);
    expect(appState.components.some((c) => c.id === valve.id)).toBe(false);

    // Port 1's wire carried over (both valve types share it)...
    expect(
      appState.connections.some((c) => c.to.id === next?.id && c.to.port === '1'),
    ).toBe(true);
    // ...but the '12' wire has nowhere to land on a monostable valve, so it's gone rather than
    // pointing at a port that no longer exists.
    expect(appState.connections.some((c) => c.to.port === '12')).toBe(false);
    expect(appState.connections).toHaveLength(1);
  });

  it('swapping monostable -> bistable keeps the shared ports wired', () => {
    const valve = createValve52Mono(compLayer(), 50, 60);
    appState.addComponent(valve);
    const source = createSource(compLayer(), 0, 0);
    appState.addComponent(source);
    createConnection({ id: source.id, port: 'OUT' }, { id: valve.id, port: '14' });

    swapComponentType(valve, VALVE_52_TYPE);

    const next = appState.components.find((c) => c.type === VALVE_52_TYPE);
    expect(next).toBeDefined();
    expect(
      appState.connections.some((c) => c.to.id === next?.id && c.to.port === '14'),
    ).toBe(true);
  });
});

describe('swapComponentType: electric contact <-> push button', () => {
  it('keeps both terminals wired and the NC setting', async () => {
    const { createElecContact, ELEC_PUSH_BUTTON_TYPE } = await import('../components/electrical');
    appState.components = [];
    appState.connections = [];
    initValveActuatorSwap(ctx, viewport);
    initWires(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement,
      viewport,
      document.createElement('div'),
    );
    const contact = createElecContact(compLayer(), 100, 100);
    contact.restore({ ...contact.snapshot(), normallyClosed: true });
    appState.addComponent(contact);
    const source = createSource(compLayer(), 0, 0);
    appState.addComponent(source);
    createConnection({ id: source.id, port: 'OUT' }, { id: contact.id, port: 'A' });

    swapComponentType(contact, ELEC_PUSH_BUTTON_TYPE);

    const next = appState.components.find((c) => c.type === ELEC_PUSH_BUTTON_TYPE);
    expect(next).toBeDefined();
    expect(appState.connections.some((c) => c.to.id === next?.id && c.to.port === 'A')).toBe(true);
    expect((next?.snapshot() as Record<string, unknown>).normallyClosed).toBe(true);
  });
});
