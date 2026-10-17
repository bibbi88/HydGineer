import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { stepSimulation, resetHydraulics } from './engine';
import { applyToDom } from './render';
import { clearElectrical } from './electrical';
import { MAX_DT } from './constants';
import { redrawAllConnections } from '../wires/connection';

let lastTime = performance.now();
let stepOnce = false;
let cleared = false;

export function requestSingleStep(): void {
  stepOnce = true;
}

function tick(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, MAX_DT);
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
