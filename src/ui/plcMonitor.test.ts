import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { createPlc } from '../components/plc';
import { createHydTank } from '../components/hyd/supply';
import { closePlcMonitor, initPlcMonitor, isPlcMonitorOpen } from './plcMonitor';

const layer = (): HTMLElement => document.createElement('div');

function setPref(auto: boolean): void {
  localStorage.setItem('hydgineer.plcMonitor', JSON.stringify({ auto }));
}

describe('PLC monitor', () => {
  beforeEach(() => {
    localStorage.clear();
    appState.components = [];
    appState.connections = [];
    appState.setMode(Modes.STOP);
  });
  afterEach(() => {
    closePlcMonitor();
    appState.setMode(Modes.STOP);
    document.body.replaceChildren();
  });

  // initPlcMonitor subscribes for good, so it's called once for the whole file.
  initPlcMonitor();

  it('opens by itself when the simulation starts and the circuit has a PLC', () => {
    appState.addComponent(createPlc(layer(), 0, 0));
    appState.setMode(Modes.PLAY);

    expect(isPlcMonitorOpen()).toBe(true);
    expect(document.querySelector('.plcMonitor')).not.toBeNull();
    // Non-modal: nothing blocks the canvas, so the canvas keyboard shortcuts stay live too.
    expect(document.querySelector('.modalBackdrop')).toBeNull();
  });

  it('stays closed when the circuit has no PLC', () => {
    appState.addComponent(createHydTank(layer(), 0, 0));
    appState.setMode(Modes.PLAY);

    expect(isPlcMonitorOpen()).toBe(false);
  });

  it('stays closed when "Open on Play" is turned off', () => {
    setPref(false);
    appState.addComponent(createPlc(layer(), 0, 0));
    appState.setMode(Modes.PLAY);

    expect(isPlcMonitorOpen()).toBe(false);
  });

  it('opens on a single step from stop too, stays open through pause, and closes on stop', () => {
    appState.addComponent(createPlc(layer(), 0, 0));
    appState.setMode(Modes.PAUSE);
    expect(isPlcMonitorOpen()).toBe(true);

    appState.setMode(Modes.PLAY);
    appState.setMode(Modes.PAUSE);
    expect(isPlcMonitorOpen()).toBe(true);

    appState.setMode(Modes.STOP);
    expect(isPlcMonitorOpen()).toBe(false);
  });

  it('remembers turning "Open on Play" off from the window itself', () => {
    appState.addComponent(createPlc(layer(), 0, 0));
    appState.setMode(Modes.PLAY);
    const box = document.querySelector('.plcMonitorAuto input') as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    appState.setMode(Modes.STOP);

    appState.setMode(Modes.PLAY);
    expect(isPlcMonitorOpen()).toBe(false);
  });

  it('shows one tab per PLC', () => {
    appState.addComponent(createPlc(layer(), 0, 0));
    appState.addComponent(createPlc(layer(), 300, 0));
    appState.setMode(Modes.PLAY);

    const tabs = [...document.querySelectorAll('.plcMonitorTab')].map((t) => t.textContent);
    expect(tabs).toEqual(['PLC 1', 'PLC 2']);
  });

  it('double-clicking a PLC while simulating opens the monitor, not the editor', () => {
    setPref(false);
    const plc = createPlc(layer(), 0, 0);
    appState.addComponent(plc);
    appState.setMode(Modes.PLAY);

    plc.el.querySelector('svg')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(isPlcMonitorOpen()).toBe(true);
    expect(document.querySelector('.plcEditorDialog')).toBeNull();
  });

  it('double-clicking a PLC while stopped still opens the editor', () => {
    const plc = createPlc(layer(), 0, 0);
    appState.addComponent(plc);

    plc.el.querySelector('svg')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(document.querySelector('.plcEditorDialog')).not.toBeNull();
    expect(isPlcMonitorOpen()).toBe(false);
  });

  it('draws the program read-only, with the unpowered PLC reported', () => {
    appState.addComponent(createPlc(layer(), 0, 0));
    appState.setMode(Modes.PLAY);

    expect(document.querySelector('.plcMonitorStatus')?.textContent).toMatch(/No power/);
    expect(document.querySelectorAll('.plcMonitor .plcNode').length).toBeGreaterThan(0);
    // No editing handles: no pin hit targets, no wire hit paths.
    expect(document.querySelector('.plcMonitor .plcPinHit')).toBeNull();
    expect(document.querySelector('.plcMonitor .plcWireHit')).toBeNull();
  });
});
