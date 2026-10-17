import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { stepSimulation } from './engine';
import { portKey } from './pressure';
import { createSource } from '../components/source';
import { createValve52 } from '../components/valve52';
import type { Connection } from '../core/types';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

function wire(fromId: number, fromPort: string, toId: number, toPort: string): Connection {
  return {
    id: fromId * 1000 + toId,
    from: { id: fromId, port: fromPort },
    to: { id: toId, port: toPort },
    guides: [],
    stubStartLen: null,
    stubEndLen: null,
    pathEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    hitEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    labelEl: document.createElementNS('http://www.w3.org/2000/svg', 'text'),
  };
}

describe('stepSimulation - edge-triggered state changes take effect the same frame', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
  });

  it('a pilot-triggered valve52 flip is reflected in the very same returned graph, not one frame later', () => {
    const supply = createSource(compLayer(), 0, 0);
    const valve = createValve52(compLayer(), 0, 0);

    appState.addComponent(supply);
    appState.addComponent(valve);
    appState.addConnection(wire(supply.id, 'OUT', valve.id, '1'));

    // Establish the pilot-14-never-pressurized baseline (rising-edge detection needs a real
    // "was low" sample first) while the valve defaults to state 1 (1<->2, 4<->5).
    const before = stepSimulation(0.016);
    expect(before.pressurized.has(portKey(valve.id, '2'))).toBe(true);
    expect(before.pressurized.has(portKey(valve.id, '4'))).toBe(false);

    // Now bring pilot 14 up - its rising edge should flip the valve to state 0 (1<->4, 2<->3)
    // and the graph returned by *this same call* must already reflect that, not the call after.
    const pilotSource = createSource(compLayer(), 0, 0);
    appState.addComponent(pilotSource);
    appState.addConnection(wire(pilotSource.id, 'OUT', valve.id, '14'));

    const after = stepSimulation(0.016);
    expect(after.pressurized.has(portKey(valve.id, '4'))).toBe(true);
    expect(after.pressurized.has(portKey(valve.id, '2'))).toBe(false);
  });
});
