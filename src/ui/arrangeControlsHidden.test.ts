import { describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { renderArrangeControls } from './arrangeControls';

describe('Arrange buttons', () => {
  it('are hidden while the simulation runs or is paused', () => {
    appState.setMode(Modes.STOP);
    const section = document.createElement('div');
    renderArrangeControls(section);
    expect(section.hidden).toBe(false);
    appState.setMode(Modes.PLAY);
    expect(section.hidden).toBe(true);
    appState.setMode(Modes.PAUSE);
    expect(section.hidden).toBe(true);
    appState.setMode(Modes.STOP);
    expect(section.hidden).toBe(false);
  });
});
