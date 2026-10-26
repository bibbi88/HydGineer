import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { createElecChangeover, createElecContact } from './electrical';
import { createHydCylinderDouble as createCylinderDouble } from './hyd/actuators';
import { resetCylinderLetters } from './shared/letters';
import { setSignal, resetSignals } from '../sim/signals';
import type { Component } from '../core/types';

function layer(): HTMLElement {
  return document.createElement('div');
}

function contact(key: string, normallyClosed = false): Component {
  const c = createElecContact(layer(), 0, 0);
  appState.addComponent(c);
  c.restore({ ...c.snapshot(), key, normallyClosed });
  return c;
}

function changeover(key: string): Component {
  const c = createElecChangeover(layer(), 0, 0);
  appState.addComponent(c);
  c.restore({ ...c.snapshot(), key });
  return c;
}

function camShown(c: Component): boolean {
  return c.el.querySelector<SVGElement>('.contactCam')?.style.display !== 'none';
}

/** The blade: the only line drawn with round caps. */
function blade(c: Component): SVGLineElement {
  const el = c.el.querySelector<SVGLineElement>('line[stroke-linecap="round"]');
  if (!el) throw new Error('no blade');
  return el;
}

describe('electrical contacts drawn in the initial position while stopped', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    appState.setMode(Modes.STOP);
    resetCylinderLetters();
    resetSignals();
  });

  it('draws a contact on a0 operated, in black, with the cam, while cylinder A is retracted', () => {
    appState.addComponent(createCylinderDouble(layer(), 300, 0));
    const a0 = contact('a0');
    const a1 = contact('A1');

    expect(camShown(a0)).toBe(true);
    expect(blade(a0).getAttribute('x2')).toBe('30'); // standing up onto the upper contact
    expect(blade(a0).getAttribute('stroke')).toBe('#111');
    expect(camShown(a1)).toBe(false);
    expect(blade(a1).getAttribute('x2')).not.toBe('30');
  });

  it('works for a normally closed contact and a changeover too', () => {
    appState.addComponent(createCylinderDouble(layer(), 300, 0));
    const nc = contact('A0', true);
    const co = changeover('A0');
    expect(camShown(nc)).toBe(true);
    expect(camShown(co)).toBe(true);
    expect(blade(co).getAttribute('x2')).toBe('30'); // over on the NO contact
  });

  it('leaves contacts on a relay coil (not a cylinder sensor) at rest', () => {
    appState.addComponent(createCylinderDouble(layer(), 300, 0));
    const k1 = contact('K1');
    expect(camShown(k1)).toBe(false);
  });

  it('runs on the live signals once the simulation runs, and back to the rest drawing on stop', () => {
    appState.addComponent(createCylinderDouble(layer(), 300, 0));
    const a0 = contact('A0');
    appState.setMode(Modes.PLAY);
    setSignal('A0', false);
    a0.recompute?.();
    expect(camShown(a0)).toBe(false);

    setSignal('A0', true);
    a0.recompute?.();
    expect(camShown(a0)).toBe(true);
    expect(blade(a0).getAttribute('stroke')).not.toBe('#111'); // highlighted during the run

    setSignal('A0', false);
    a0.reset();
    appState.setMode(Modes.STOP);
    expect(camShown(a0)).toBe(true);
    expect(blade(a0).getAttribute('stroke')).toBe('#111');
  });
});
