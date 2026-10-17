import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { stepSimulation } from './engine';
import { applyToDom } from './render';
import { emptyFrameGraph } from './pressure';
import { clearElectrical } from './electrical';
import { MAX_DT } from './constants';
import { redrawAllConnections } from '../wires/connection';

let lastTime = performance.now();
let stepOnce = false;

export function requestSingleStep(): void {
  stepOnce = true;
}

function tick(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, MAX_DT);
  lastTime = now;

  if (appState.mode === Modes.PLAY || stepOnce) {
    const graph = stepSimulation(dt);
    applyToDom(graph);
    // A component can move its own ports in response to simulation state (e.g. the 5/2 valve's
    // sliding pilot ports) without going through any of the normal edit-time triggers that
    // redraw wires (drag, handle-drag, undo/redo) - so any wire attached to one would otherwise
    // stay stuck at its pre-slide path. Cheap even every frame: geometry is measured from live
    // DOM/cached per endpoint position, so nothing recomputes for a wire whose ports didn't move.
    redrawAllConnections();
    stepOnce = false;
  } else if (appState.mode === Modes.STOP) {
    clearElectrical();
    applyToDom(emptyFrameGraph());
  }

  requestAnimationFrame(tick);
}

export function startSimLoop(): void {
  lastTime = performance.now();
  requestAnimationFrame(tick);
}
