import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { initWires } from '../wires/connection';
import { alignComponents, distributeComponents } from './align';
import { createElecCoil, createElecContact, createElecLamp } from '../components/electrical';
import { createCylinderDouble } from '../components/cylinderDouble';
import type { Component } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';

const layer = (): HTMLElement => document.createElement('div');
const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

function add(c: Component): Component {
  appState.addComponent(c);
  return c;
}

describe('align', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    initWires(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement,
      viewport,
      document.createElement('div'),
    );
  });

  it('puts centers in one column, on the grid, leaving the other axis alone', () => {
    const a = add(createElecContact(layer(), 100, 100));
    const b = add(createElecCoil(layer(), 170, 300));
    alignComponents([a, b], 'center');
    expect(a.x).toBe(b.x);
    expect(a.x % 10).toBe(0);
    expect([a.y, b.y]).toEqual([100, 300]);
  });

  it('puts centers in one row', () => {
    const a = add(createElecContact(layer(), 100, 100));
    const b = add(createElecLamp(layer(), 300, 160));
    alignComponents([a, b], 'middle');
    expect(a.y).toBe(b.y);
    expect([a.x, b.x]).toEqual([100, 300]);
  });

  it('lines differently sized symbols up flush on their left edges', () => {
    const small = add(createElecContact(layer(), 300, 100));
    const big = add(createCylinderDouble(layer(), 500, 400));
    alignComponents([small, big], 'left');
    expect(Math.abs(small.getBounds().x - big.getBounds().x)).toBeLessThanOrEqual(5);
  });

  it('spaces the middle ones evenly between the outer two, which stay put', () => {
    const a = add(createElecContact(layer(), 0, 100));
    const b = add(createElecContact(layer(), 50, 100));
    const c = add(createElecContact(layer(), 300, 100));
    distributeComponents([c, a, b], 'horizontal');
    expect([a.x, b.x, c.x]).toEqual([0, 150, 300]);
  });
});
