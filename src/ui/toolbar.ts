import { appState } from '../app/AppState';
import { Modes, canEdit } from '../app/modes';
import { requestSingleStep } from '../sim/loop';
import { stopSimulation } from '../sim/stopSimulation';
import { undo, redo, canUndo, canRedo, onHistoryChange } from '../history/historyStore';
import { iconButton } from './iconButton';
import { createIcon } from './icons';
import { formatSimSpeed, getSimSpeed, setSimSpeed, SIM_SPEEDS } from '../app/simSpeed';

/** The toolbar's simulation section: run/stop, pause and single-step the simulation, then undo
 * and redo. Play and Stop share one button, which swaps its icon and label to whichever action
 * the current mode offers. */
export function renderToolbar(container: HTMLElement): void {
  const playStopBtn = iconButton('play', 'Play', () => {
    if (appState.mode === Modes.PLAY) stopSimulation();
    else appState.setMode(Modes.PLAY);
  });

  const pauseBtn = iconButton('pause', 'Pause', () => {
    appState.setMode(Modes.PAUSE);
  });
  const stepBtn = iconButton('step', 'Step one cycle', () => {
    appState.setMode(Modes.PAUSE);
    requestSingleStep();
  });
  const undoBtn = iconButton('undo', 'Undo', undo);
  const redoBtn = iconButton('redo', 'Redo', redo);

  function updatePlayStopButton(): void {
    const stopping = appState.mode === Modes.PLAY;
    const label = stopping ? 'Stop' : 'Play';
    playStopBtn.title = label;
    playStopBtn.setAttribute('aria-label', label);
    playStopBtn.classList.toggle('iconBtn--danger', stopping);
    playStopBtn.replaceChildren(createIcon(stopping ? 'stop' : 'play'));
  }
  updatePlayStopButton();
  appState.onModeChange(updatePlayStopButton);

  // Undo and redo rebuild the circuit: only while it's stopped.
  function updateUndoRedoButtons(): void {
    undoBtn.disabled = !canUndo() || !canEdit(appState.mode);
    redoBtn.disabled = !canRedo() || !canEdit(appState.mode);
  }
  onHistoryChange(updateUndoRedoButtons);
  appState.onModeChange(updateUndoRedoButtons);
  updateUndoRedoButtons();

  container.append(playStopBtn, pauseBtn, stepBtn, renderSimulationSpeed(), undoBtn, redoBtn);
}

/** Simulation speed: a slider stepping through SIM_SPEEDS, with the current speed beside it.
 * Changeable any time, including while the simulation runs. */
function renderSimulationSpeed(): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'simSpeed';
  wrap.title = 'Simulation speed - slow motion to fast forward';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'simSpeedSlider';
  slider.min = '0';
  slider.max = String(SIM_SPEEDS.length - 1);
  slider.step = '1';
  slider.setAttribute('aria-label', 'Simulation speed');
  const value = document.createElement('span');
  value.className = 'simSpeedValue';

  function show(): void {
    const current = getSimSpeed();
    slider.value = String(Math.max(0, SIM_SPEEDS.indexOf(current as (typeof SIM_SPEEDS)[number])));
    value.textContent = formatSimSpeed(current);
    slider.setAttribute('aria-valuetext', formatSimSpeed(current));
  }
  slider.addEventListener('input', () => {
    setSimSpeed(SIM_SPEEDS[Number(slider.value)] ?? 1);
    show();
  });
  // Double-click puts it back to real time.
  slider.addEventListener('dblclick', () => {
    setSimSpeed(1);
    show();
  });
  show();
  wrap.append(slider, value);
  return wrap;
}
