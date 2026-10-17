import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../app/AppState';
import { initMarquee } from './marquee';
import { selectOnly, getSelectedComponents } from './selection';
import { createSource } from '../components/source';
import type { Component } from '../core/types';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

/** A component whose on-screen box is fixed, so the marquee's hit test has something real to
 * intersect - jsdom gives every element a zero-sized rect otherwise. */
function placeAt(x: number, y: number): Component {
  const comp = createSource(compLayer(), x, y);
  vi.spyOn(comp.el, 'getBoundingClientRect').mockReturnValue({
    x,
    y,
    left: x,
    top: y,
    right: x + 40,
    bottom: y + 40,
    width: 40,
    height: 40,
    toJSON: () => ({}),
  });
  appState.addComponent(comp);
  return comp;
}

function press(el: Element, opts: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, ...opts }));
}
function move(clientX: number, clientY: number): void {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }));
}
function release(clientX: number, clientY: number): void {
  window.dispatchEvent(new MouseEvent('mouseup', { clientX, clientY }));
}
function marqueeEl(): Element | null {
  return document.querySelector('.marquee');
}

describe('marquee selection on empty canvas', () => {
  let workspace: HTMLElement;
  let connLayer: SVGSVGElement;

  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    document.body.replaceChildren();
    workspace = document.createElement('div');
    connLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    workspace.appendChild(connLayer);
    initMarquee(workspace, connLayer);
  });

  it('a plain left drag rubber-band selects what it covers', () => {
    const inside = placeAt(120, 120);
    placeAt(600, 600);

    press(workspace, { clientX: 100, clientY: 100 });
    expect(marqueeEl()).not.toBeNull();
    move(300, 300);
    release(300, 300);

    expect(getSelectedComponents().map((c) => c.id)).toEqual([inside.id]);
    expect(marqueeEl()).toBeNull();
  });

  it('replaces the selection, unless Shift says to add to it', () => {
    const first = placeAt(120, 120);
    const second = placeAt(400, 400);

    selectOnly(second.id);
    press(workspace, { clientX: 100, clientY: 100 });
    move(300, 300);
    release(300, 300);
    expect(getSelectedComponents().map((c) => c.id)).toEqual([first.id]);

    selectOnly(second.id);
    press(workspace, { clientX: 100, clientY: 100, shiftKey: true });
    move(300, 300);
    release(300, 300);
    expect(
      getSelectedComponents()
        .map((c) => c.id)
        .sort(),
    ).toEqual([first.id, second.id].sort());
  });

  it('leaves Alt + left alone, since that is the pan gesture', () => {
    const comp = placeAt(120, 120);
    selectOnly(comp.id);

    press(workspace, { clientX: 100, clientY: 100, altKey: true });
    move(300, 300);
    release(300, 300);

    // No rubber band appeared, and panning must not disturb what was selected.
    expect(marqueeEl()).toBeNull();
    expect(getSelectedComponents().map((c) => c.id)).toEqual([comp.id]);
  });

  it('ignores presses that landed on a component rather than empty canvas', () => {
    const onComponent = document.createElement('div');
    workspace.appendChild(onComponent);

    press(onComponent, { clientX: 100, clientY: 100 });

    expect(marqueeEl()).toBeNull();
  });

  it('ignores the middle button, which pans instead', () => {
    workspace.dispatchEvent(
      new MouseEvent('mousedown', { button: 1, bubbles: true, clientX: 100, clientY: 100 }),
    );
    expect(marqueeEl()).toBeNull();
  });
});
