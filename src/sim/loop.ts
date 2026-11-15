import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { stepSimulation, resetHydraulics } from './engine';
import { applyToDom } from './render';
import { clearElectrical } from './electrical';
import { MAX_DT } from './constants';
import { redrawMovedConnections } from '../wires/connection';
import { getSimSpeed } from '../app/simSpeed';

let lastTime = performance.now();
let stepOnce = false;
/** Whether the stopped circuit has been drawn at rest since it last ran or changed. */
let restShown = false;

export function requestSingleStep(): void {
  stepOnce = true;
}

/** Simulated seconds for a frame that took `elapsed` real seconds: clamped first, so a slow or
 * backgrounded tab doesn't jump ahead, then scaled by the simulation speed - so slow motion and
 * fast forward reach everything that runs on time (cylinders, pressures, timers, the PLC).
 * Never negative: the browser's frame timestamps can repeat, or (on the first frame) come out
 * just before the time the loop started from. */
export function simulatedDt(elapsed: number): number {
  return Math.max(0, Math.min(elapsed, MAX_DT)) * getSimSpeed();
}

function tick(now: number): void {
  const dt = simulatedDt((now - lastTime) / 1000);
  lastTime = now;

  // A frame with no time in it (two with the same timestamp) has nothing to simulate.
  if ((appState.mode === Modes.PLAY || stepOnce) && dt > 0) {
    const frame = stepSimulation(dt);
    applyToDom(frame);
    // A component can move its own ports in response to simulation state without any of the
    // edit-time triggers that redraw wires - only the wires on ports that actually moved are
    // redrawn (wires/connection.ts).
    redrawMovedConnections();
    stepOnce = false;
    restShown = false;
  } else if (appState.mode === Modes.STOP && !restShown) {
    // Stopped: the circuit shown at rest - once, when it stops or changes, not every frame.
    clearElectrical();
    resetHydraulics();
    applyToDom(null);
    restShown = true;
  }

  requestAnimationFrame(tick);
}

export function startSimLoop(): void {
  lastTime = performance.now();
  // Shown at rest again after any change or mode switch.
  appState.onChange(() => {
    restShown = false;
  });
  appState.onModeChange(() => {
    restShown = false;
  });
  requestAnimationFrame(tick);
}
