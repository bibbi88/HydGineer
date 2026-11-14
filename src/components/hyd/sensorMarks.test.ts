import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../../app/AppState';
import { Modes } from '../../app/modes';
import { createHydCylinderDouble, createHydCylinderSingle } from './actuators';
import { createElecContact } from '../electrical';
import type { Component } from '../../core/types';

const layer = (): HTMLElement => document.createElement('div');

function marks(cyl: Component): Array<{ label: string; x: number }> {
  return Array.from(cyl.el.querySelectorAll('.sensorMarkLabel')).map((t) => ({
    label: t.textContent ?? '',
    x: Number(t.getAttribute('x')),
  }));
}

function contactOn(key: string): Component {
  const contact = createElecContact(layer(), 0, 0);
  appState.addComponent(contact);
  contact.restore({ ...contact.snapshot(), key });
  appState.markDirty(); // as the inspector does after a change
  return contact;
}

describe('sensor marks at the cylinder rod', () => {
  beforeEach(() => {
    appState.components = [];
    appState.setMode(Modes.STOP);
  });

  it('shows only the sensors something reads, a0 at the rod in and a1 out', () => {
    const cyl = createHydCylinderDouble(layer(), 0, 0);
    appState.addComponent(cyl);
    expect(marks(cyl)).toEqual([]);

    contactOn('A1');
    expect(marks(cyl).map((m) => m.label)).toEqual(['a1']);
    contactOn('a0');
    const both = marks(cyl);
    expect(both.map((m) => m.label).sort()).toEqual(['a0', 'a1']);
    const x = (l: string): number => both.find((m) => m.label === l)!.x;
    expect(x('a1')).toBeGreaterThan(x('a0') + 100);
  });

  it('lights a sensor up while it is on during a run, and not when stopped', () => {
    const cyl = createHydCylinderSingle(layer(), 0, 0);
    appState.addComponent(cyl);
    contactOn('A0');
    const active = (): number => cyl.el.querySelectorAll('.sensorMarkActive').length;
    expect(active()).toBe(0);
    appState.setMode(Modes.PLAY);
    expect(active()).toBe(1); // retracted: a0 is on
    appState.setMode(Modes.STOP);
    expect(active()).toBe(0);
  });
});
