import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { resetSignals } from './signals';
import { redrawAllConnections } from '../wires/connection';

/**
 * Stops a running (or paused) simulation and puts the circuit back at rest: every component
 * reset, the sensor signals cleared, wires redrawn where ports slid back. The one way the
 * simulation stops - the toolbar's Stop, switching or closing a tab, opening a project, saving -
 * so the circuit is never left, stored or saved in the middle of a run.
 */
export function stopSimulation(): void {
  if (appState.mode === Modes.STOP) return;
  for (const c of appState.components) c.reset();
  resetSignals();
  // A component's own visual reset (a 5/2 valve's pilot ports sliding back) doesn't go through
  // the edit-time triggers that redraw wires.
  redrawAllConnections();
  appState.setMode(Modes.STOP);
  // Settings changed during the run (a flow control's opening, say) become one undo step, at
  // rest - history isn't recorded while the simulation runs.
  appState.markDirty();
}
