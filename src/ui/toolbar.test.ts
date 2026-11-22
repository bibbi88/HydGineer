import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { renderToolbar } from './toolbar';

const btn = (el: HTMLElement, i: number): HTMLButtonElement =>
  el.querySelectorAll<HTMLButtonElement>('.iconBtn')[i]!;
const caption = (b: HTMLButtonElement): string =>
  b.querySelector('.iconBtnCaption')?.textContent ?? '';

describe('simulation buttons', () => {
  let el: HTMLElement;
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    appState.setMode(Modes.STOP);
    el = document.createElement('div');
    renderToolbar(el);
  });

  it('stopped: Play and Pause; running: Stop and Pause; paused: Stop and Play (resume)', () => {
    const [main, pause] = [btn(el, 0), btn(el, 1)];
    expect([caption(main), caption(pause)]).toEqual(['Play', 'Pause']);

    main.click();
    expect(appState.mode).toBe(Modes.PLAY);
    expect([caption(main), caption(pause)]).toEqual(['Stop', 'Pause']);
    expect(main.classList.contains('iconBtn--danger')).toBe(true);

    pause.click();
    expect(appState.mode).toBe(Modes.PAUSE);
    expect([caption(main), caption(pause)]).toEqual(['Stop', 'Play']);
    expect(pause.getAttribute('aria-label')).toBe('Resume');
    expect(main.classList.contains('iconBtn--danger')).toBe(true);

    pause.click();
    expect(appState.mode).toBe(Modes.PLAY);

    pause.click();
    main.click();
    expect(appState.mode).toBe(Modes.STOP);
    expect([caption(main), caption(pause)]).toEqual(['Play', 'Pause']);
  });

  it('Pause while stopped starts the simulation paused, to step from the start', () => {
    btn(el, 1).click();
    expect(appState.mode).toBe(Modes.PAUSE);
    expect(caption(btn(el, 0))).toBe('Stop');
  });

  it('Undo, Redo and the speed slider: editing buttons hide while simulating, the slider shows', () => {
    const undo = el.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!;
    const redo = el.querySelector<HTMLButtonElement>('button[aria-label="Redo"]')!;
    const speed = el.querySelector<HTMLElement>('.simSpeed')!;
    expect([undo.hidden, redo.hidden, speed.hidden]).toEqual([false, false, true]);
    btn(el, 0).click();
    expect([undo.hidden, redo.hidden, speed.hidden]).toEqual([true, true, false]);
    btn(el, 1).click();
    expect([undo.hidden, speed.hidden]).toEqual([true, false]);
    btn(el, 0).click();
    expect([undo.hidden, redo.hidden, speed.hidden]).toEqual([false, false, true]);
  });
});
