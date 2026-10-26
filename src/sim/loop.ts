import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { stepSimulation, resetHydraulics } from './engine';
import { applyToDom } from './render';
import { clearElectrical } from './electrical';
import { MAX_DT } from './constants';
import { redrawAllConnections } from '../wires/connection';
import { getSimSpeed } from '../app/simSpeed';

let lastTime = performance.now();
let stepOnce = false;
let cleared = false;

export function requestSingleStep(): void {
  stepOnce = true;
}

/** Simulated seconds for a frame that took `elapsed` real seconds: clamped first, so a slow or
 * backgrounded tab doesn't jump ahead, then scaled by the simulation speed - so slow motion and
 * fast forward reach everything that runs on time (cylinders, pressures, timers, the PLC). */
export function simulatedDt(elapsed: number): number {
  return Math.min(elapsed, MAX_DT) * getSimSpeed();
}

function tick(now: number): void {
  const dt = simulatedDt((now - lastTime) / 1000);
  lastTime = now;

  if (appState.mode === Modes.PLAY || stepOnce) {
    const frame = stepSimulation(dt);
    applyToDom(frame);
    redrawAllConnections();
    stepOnce = false;
    cleared = false;
  } else if (appState.mode === Modes.STOP && !cleared) {
    clearElectrical();
    resetHydraulics();
    applyToDom(null);
    cleared = true;
  }

  requestAnimationFrame(tick);
}

export function startSimLoop(): void {
  lastTime = performance.now();
  requestAnimationFrame(tick);
}
