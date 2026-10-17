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
