import { describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { initValveActuatorSwap, swapComponentType } from './valveActuatorSwap';
import { initWires, createConnection } from '../wires/connection';
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

describe('swapComponentType: electric contact <-> push button', () => {
  it('keeps both terminals wired and the NC setting', async () => {
    const { createElecContact, createElecRailPlus, ELEC_PUSH_BUTTON_TYPE } =
      await import('../components/electrical');
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
    const source = createElecRailPlus(compLayer(), 0, 0);
    appState.addComponent(source);
    createConnection({ id: source.id, port: 'P' }, { id: contact.id, port: 'A' });

    swapComponentType(contact, ELEC_PUSH_BUTTON_TYPE);

    const next = appState.components.find((c) => c.type === ELEC_PUSH_BUTTON_TYPE);
    expect(next).toBeDefined();
    expect(appState.connections.some((c) => c.to.id === next?.id && c.to.port === 'A')).toBe(true);
    expect((next?.snapshot() as Record<string, unknown>).normallyClosed).toBe(true);
  });
});

describe('swapComponentType: inline hydraulic valves', () => {
  async function setup() {
    const valves = await import('../components/hyd/valves');
    const { createJunction } = await import('../components/junction');
    const { getComponentRotation } = await import('./componentContextMenu');
    appState.components = [];
    appState.connections = [];
    initValveActuatorSwap(ctx, viewport);
    initWires(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement,
      viewport,
      document.createElement('div'),
    );
    const below = createJunction(compLayer(), 100, 300, 'V');
    const above = createJunction(compLayer(), 100, 0, 'V');
    appState.addComponent(below);
    appState.addComponent(above);
    return { valves, below, above, getComponentRotation };
  }

  it('check valve <-> pilot-operated check: IN/OUT carry over to A/B', async () => {
    const { valves, below, above } = await setup();
    const check = valves.createHydCheck(compLayer(), 100, 150);
    appState.addComponent(check);
    createConnection({ id: below.id, port: 'P' }, { id: check.id, port: 'IN' });
    createConnection({ id: check.id, port: 'OUT' }, { id: above.id, port: 'P' });

    swapComponentType(check, valves.HYD_PILOT_CHECK_TYPE);
    const pilot = appState.components.find((c) => c.type === valves.HYD_PILOT_CHECK_TYPE)!;
    expect(appState.connections.find((c) => c.from.id === below.id)?.to).toEqual({
      id: pilot.id,
      port: 'A',
    });
    expect(appState.connections.find((c) => c.to.id === above.id)?.from).toEqual({
      id: pilot.id,
      port: 'B',
    });

    swapComponentType(pilot, valves.HYD_CHECK_TYPE);
    const back = appState.components.find((c) => c.type === valves.HYD_CHECK_TYPE)!;
    expect(appState.connections.find((c) => c.from.id === below.id)?.to.port).toBe('IN');
    expect(appState.connections.find((c) => c.to.id === above.id)?.from.port).toBe('OUT');
    expect(back.id).not.toBe(pilot.id);
  });

  it('throttle -> one-way flow control: keeps the orifice, turned over to keep IN -> OUT', async () => {
    const { valves, below, above, getComponentRotation } = await setup();
    const throttle = valves.createHydThrottle(compLayer(), 100, 150);
    throttle.restore({ ...throttle.snapshot(), diameter: 1.5 });
    appState.addComponent(throttle);
    createConnection({ id: below.id, port: 'P' }, { id: throttle.id, port: 'IN' });
    createConnection({ id: throttle.id, port: 'OUT' }, { id: above.id, port: 'P' });

    swapComponentType(throttle, valves.HYD_ONE_WAY_FC_TYPE);
    const fc = appState.components.find((c) => c.type === valves.HYD_ONE_WAY_FC_TYPE)!;
    // Drawn with IN at the top, so it's turned over to keep IN toward the junction below.
    expect(getComponentRotation(fc)).toBe(180);
    expect((fc.snapshot() as { diameter: number }).diameter).toBe(1.5);
    expect(appState.connections.find((c) => c.from.id === below.id)?.to.port).toBe('IN');
    expect(appState.connections.find((c) => c.to.id === above.id)?.from.port).toBe('OUT');
  });
});
