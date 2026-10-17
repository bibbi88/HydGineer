import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { initWires, createConnection } from '../wires/connection';
import { solveElectrical } from './electrical';
import { resetSignals, getSignal, setSignal } from './signals';
import {
  createElecRailPlus,
  createElecRailZero,
  createElecCoil,
  createElecSolenoid,
  createElecContact,
  createElecLamp,
  createElecChangeover,
} from '../components/electrical';
import { createPlc } from '../components/plc';
import { createElecPushButton, ELEC_SOLENOID_TYPE } from '../components/electrical';
import { createValve52Solenoid } from '../components/solenoidValves';
import type { Component } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';

const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};
const layer = (): HTMLElement => document.createElement('div');

function add(c: Component): Component {
  appState.addComponent(c);
  return c;
}
function wire(a: Component, ap: string, b: Component, bp: string): void {
  createConnection({ id: a.id, port: ap }, { id: b.id, port: bp });
}
function configure(c: Component, patch: Record<string, unknown>): void {
  c.restore({ ...c.snapshot(), ...patch });
}

describe('solveElectrical', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    resetSignals();
    initWires(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement,
      viewport,
      document.createElement('div'),
    );
  });

  it('energizes a coil wired between +24 V and 0 V and publishes its name', () => {
    const plus = add(createElecRailPlus(layer(), 0, 0));
    const zero = add(createElecRailZero(layer(), 0, 300));
    const coil = add(createElecCoil(layer(), 0, 150));
    wire(plus, 'P', coil, 'A');
    wire(coil, 'B', zero, 'P');

    solveElectrical(0);
    expect(getSignal('K1')).toBe(true);
  });

  it('does not energize a coil that is only connected on one side', () => {
    const plus = add(createElecRailPlus(layer(), 0, 0));
    const coil = add(createElecCoil(layer(), 0, 150));
    wire(plus, 'P', coil, 'A');

    solveElectrical(0);
    expect(getSignal('K1')).toBe(false);
  });

  it('a relay chain settles in one solve: K1 closes a contact that energizes the lamp', () => {
    const plus = add(createElecRailPlus(layer(), 0, 0));
    const zero = add(createElecRailZero(layer(), 0, 600));
    const k1 = add(createElecCoil(layer(), 0, 150));
    configure(k1, { key: 'K1' });
    wire(plus, 'P', k1, 'A');
    wire(k1, 'B', zero, 'P');

    const contact = add(createElecContact(layer(), 200, 150));
    configure(contact, { key: 'K1' });
    const lamp = add(createElecLamp(layer(), 200, 300));
    wire(plus, 'P', contact, 'A');
    wire(contact, 'B', lamp, 'A');
    wire(lamp, 'B', zero, 'P');

    solveElectrical(0);
    expect(getSignal('K1')).toBe(true);
    const bulb = lamp.el.querySelector('circle:not(.port)');
    expect(bulb?.getAttribute('fill')).toBe('#ffe45c');
  });

  it('a normally-closed contact opens when its signal is true', () => {
    const plus = add(createElecRailPlus(layer(), 0, 0));
    const zero = add(createElecRailZero(layer(), 0, 600));
    const nc = add(createElecContact(layer(), 200, 150));
    configure(nc, { key: 'S1', normallyClosed: true });
    const coil = add(createElecCoil(layer(), 200, 300));
    wire(plus, 'P', nc, 'A');
    wire(nc, 'B', coil, 'A');
    wire(coil, 'B', zero, 'P');

    solveElectrical(0);
    expect(getSignal('K1')).toBe(true);
  });

  it('a changeover contact feeds NC at rest and switches over to NO when its signal is on', () => {
    const build = (withK1: boolean): void => {
      appState.components = [];
      appState.connections = [];
      resetSignals();
      const plus = add(createElecRailPlus(layer(), 0, 0));
      const zero = add(createElecRailZero(layer(), 0, 600));
      if (withK1) {
        const k1 = add(createElecCoil(layer(), 0, 150));
        configure(k1, { key: 'K1' });
        wire(plus, 'P', k1, 'A');
        wire(k1, 'B', zero, 'P');
      }
      const co = add(createElecChangeover(layer(), 200, 150));
      configure(co, { key: 'K1' });
      const ncLoad = add(createElecCoil(layer(), 150, 300));
      configure(ncLoad, { key: 'H1' });
      const noLoad = add(createElecCoil(layer(), 250, 300));
      configure(noLoad, { key: 'H2' });
      wire(plus, 'P', co, 'COM');
      wire(co, 'NC', ncLoad, 'A');
      wire(co, 'NO', noLoad, 'A');
      wire(ncLoad, 'B', zero, 'P');
      wire(noLoad, 'B', zero, 'P');
      solveElectrical(0);
    };

    build(false);
    expect(getSignal('H1')).toBe(true);
    expect(getSignal('H2')).toBe(false);

    build(true);
    expect(getSignal('H1')).toBe(false);
    expect(getSignal('H2')).toBe(true);
  });

  it('a solenoid valve shifts while the solenoid with its name is energized', () => {
    const plus = add(createElecRailPlus(layer(), 0, 0));
    const zero = add(createElecRailZero(layer(), 0, 300));
    const coil = add(createElecSolenoid(layer(), 0, 150));
    wire(plus, 'P', coil, 'A');
    wire(coil, 'B', zero, 'P');
    const valve = add(createValve52Solenoid(layer(), 400, 150));

    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual([
      { a: '1', b: '2' },
      { a: '4', b: '5' },
    ]);
    solveElectrical(0);
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual([
      { a: '1', b: '4' },
      { a: '2', b: '3' },
    ]);
  });

  it('a PLC runs a start/stop self-holding program driving a coil', () => {
    const plus = add(createElecRailPlus(layer(), 0, 0));
    const zero = add(createElecRailZero(layer(), 0, 900));
    const plc = add(createPlc(layer(), 300, 400));
    wire(plus, 'P', plc, 'L+');
    wire(zero, 'P', plc, 'M');

    const start = add(createElecPushButton(layer(), 100, 200)) as Component;
    const stop = add(createElecPushButton(layer(), 100, 300)) as Component;
    configure(stop, { normallyClosed: false });
    wire(plus, 'P', start, 'A');
    wire(start, 'B', plc, 'I0.0');
    wire(plus, 'P', stop, 'A');
    wire(stop, 'B', plc, 'I0.1');

    const coil = add(createElecSolenoid(layer(), 600, 400));
    wire(plc, 'Q0.0', coil, 'A');
    wire(coil, 'B', zero, 'P');

    appState.mode = Modes.PLAY; // push buttons ignore presses while stopped
    const press = (btn: Component, down: boolean): void => {
      btn.el.querySelector('svg')?.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup'));
      if (!down) window.dispatchEvent(new MouseEvent('mouseup'));
    };

    solveElectrical(0);
    expect(getSignal('Y1')).toBe(false);

    press(start, true);
    solveElectrical(0);
    expect(getSignal('Y1')).toBe(true);

    press(start, false);
    solveElectrical(0);
    expect(getSignal('Y1')).toBe(true); // self-held

    press(stop, true);
    solveElectrical(0);
    expect(getSignal('Y1')).toBe(false);
    appState.mode = Modes.STOP;
  });
});

describe('electrical symbols', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    resetSignals();
  });

  /** Blade tip: the line pivoting on the lower fixed contact that isn't the conductor below it. */
  function bladeTip(c: Component): { x: number; y: number } {
    const blade = Array.from(c.el.querySelectorAll('line')).find(
      (l) =>
        l.getAttribute('y1') === '66' &&
        l.getAttribute('x1') === '30' &&
        l.getAttribute('y2') !== '90',
    );
    return { x: Number(blade?.getAttribute('x2')), y: Number(blade?.getAttribute('y2')) };
  }

  it('an NC contact opens by swinging further away from its hook, the way an NO closes', () => {
    const nc = add(createElecContact(layer(), 0, 0));
    configure(nc, { key: 'K1', normallyClosed: true });
    const no = add(createElecContact(layer(), 0, 0));
    configure(no, { key: 'K1' });
    const ncRest = bladeTip(nc);
    const noRest = bladeTip(no);

    setSignal('K1', true);
    nc.recompute?.();
    no.recompute?.();

    // Both blades turn clockwise about their pivot: the tip moves right.
    expect(bladeTip(nc).x).toBeGreaterThan(ncRest.x);
    expect(bladeTip(no).x).toBeGreaterThan(noRest.x);
    // ...and the NC tip drops below the hook (y = 34), leaving a gap.
    expect(bladeTip(nc).y).toBeGreaterThan(34);
  });

  it('draws the solenoid with an oblique stroke and names it from the Y series', () => {
    const relay = add(createElecCoil(layer(), 0, 0));
    const sol = add(createElecSolenoid(layer(), 0, 0));
    expect((relay.snapshot() as Record<string, unknown>).key).toBe('K1');
    expect((sol.snapshot() as Record<string, unknown>).key).toBe('Y1');
    expect(sol.type).toBe(ELEC_SOLENOID_TYPE);
    const diagonal = (c: Component): boolean =>
      Array.from(c.el.querySelectorAll('line')).some(
        (l) =>
          l.getAttribute('x1') !== l.getAttribute('x2') &&
          l.getAttribute('y1') !== l.getAttribute('y2'),
      );
    expect(diagonal(sol)).toBe(true);
    expect(diagonal(relay)).toBe(false);
  });

  it('puts the signal name to the left of the symbol', () => {
    const contact = add(createElecContact(layer(), 0, 0));
    configure(contact, { key: 'K1' });
    const label = Array.from(contact.el.querySelectorAll('text')).find(
      (t) => t.textContent === 'K1',
    );
    expect(label?.getAttribute('text-anchor')).toBe('end');
    expect(Number(label?.getAttribute('x'))).toBeLessThan(30);
  });

  it('a detent push button stays put after a click and releases on the next one', () => {
    const btn = add(createElecPushButton(layer(), 0, 0));
    const svg = btn.el.querySelector('svg') as SVGSVGElement;
    const mark = (): string | undefined =>
      Array.from(btn.el.querySelectorAll('path')).find((p) => p.getAttribute('d')?.includes(' L '))
        ?.style.display;
    expect(mark()).toBe('none');
    configure(btn, { detent: true });
    expect(mark()).toBe('');

    appState.mode = Modes.PLAY;
    const click = (): void => {
      svg.dispatchEvent(new MouseEvent('mousedown'));
      window.dispatchEvent(new MouseEvent('mouseup'));
    };
    const closed = (): boolean => (btn.electrical?.closedEdges?.() ?? []).length > 0;
    click();
    expect(closed()).toBe(true);
    click();
    expect(closed()).toBe(false);
  });
});
