import type { ViewportAdapter } from './viewport';
import { iconButton, setIconButtonLabel } from './iconButton';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import {
  canRecordVideo,
  startVideoRecording,
  type VideoRecording,
} from '../persistence/recordVideo';

export interface RecordButtonDeps {
  getName: () => string;
  connLayer: SVGSVGElement;
  frameLayer: SVGSVGElement | null;
  viewport: ViewportAdapter;
  workspaceEl: HTMLElement;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Record video: films the circuit - with the simulation's colours, and every press on the
 * canvas - until pressed again or the simulation is stopped, then saves the video (see
 * persistence/recordVideo.ts). Shown only while simulating. While recording it turns red and
 * shows how long it has been going; while the simulation is paused, so is the recording.
 */
export function renderRecordButton(container: HTMLElement, deps: RecordButtonDeps): void {
  let recording: VideoRecording | null = null;
  let ticker: ReturnType<typeof setInterval> | undefined;

  const time = document.createElement('span');
  time.className = 'recordTime';
  time.hidden = true;

  const btn = iconButton(
    'record',
    'Record video',
    () => {
      if (recording) {
        recording.stop();
        return;
      }
      recording = startVideoRecording({
        name: deps.getName() || 'simulation',
        connLayer: deps.connLayer,
        frameLayer: deps.frameLayer,
        viewport: deps.viewport,
        workspaceEl: deps.workspaceEl,
        onEnd: () => {
          recording = null;
          refresh();
        },
      });
      if (!recording) {
        window.alert(
          'This browser cannot record video. Try a current Chrome, Edge, Firefox or Safari.',
        );
        return;
      }
      // Started while paused: the first frame is taken, then it waits for the run to go on.
      if (appState.mode === Modes.PAUSE) recording.pause();
      refresh();
    },
    'Record',
  );

  function refresh(): void {
    const on = recording !== null;
    const label = !on
      ? 'Record video'
      : recording!.paused
        ? 'Recording paused with the simulation - stop and save the video'
        : 'Stop recording and save the video';
    setIconButtonLabel(btn, label, on ? 'Stop rec' : 'Record', on ? 'stop' : 'record');
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('iconBtn--recording', on);
    time.hidden = !on;
    time.classList.toggle('recordTime--paused', on && recording!.paused);
    clearInterval(ticker);
    if (on) {
      const tick = (): void => {
        time.textContent = formatTime(recording?.elapsed() ?? 0);
      };
      tick();
      ticker = setInterval(tick, 500);
    }
  }

  if (!canRecordVideo()) {
    btn.disabled = true;
    btn.title = 'Record video - not supported in this browser';
  }
  // Right after the Step button, with the other run controls.
  const step = container.querySelector('.iconBtn[aria-label="Step one cycle"]');
  if (step) step.after(btn, time);
  else container.append(btn, time);

  // Shown only while simulating (running or paused); stopping the simulation also ends the
  // recording and saves it. Pausing the simulation pauses the recording too - the video goes
  // on from where it was once the simulation runs again.
  function followMode(): void {
    const simulating = appState.mode !== Modes.STOP;
    btn.hidden = !simulating;
    if (!recording) return;
    if (!simulating) recording.stop();
    else if (appState.mode === Modes.PAUSE) recording.pause();
    else recording.resume();
    refresh();
  }
  appState.onModeChange(followMode);
  followMode();
}
