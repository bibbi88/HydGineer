import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startVideoRecording } from './recordVideo';

/** A stand-in MediaRecorder: records the calls made to it. */
class FakeRecorder {
  static last: FakeRecorder | null = null;
  static isTypeSupported = (m: string): boolean => m === 'video/webm';
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  calls: string[] = [];
  private listeners: Record<string, Array<() => void>> = {};
  constructor() {
    FakeRecorder.last = this;
  }
  addEventListener(type: string, cb: () => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  start(): void {
    this.state = 'recording';
    this.calls.push('start');
  }
  pause(): void {
    this.state = 'paused';
    this.calls.push('pause');
  }
  resume(): void {
    this.state = 'recording';
    this.calls.push('resume');
  }
  stop(): void {
    this.state = 'inactive';
    this.calls.push('stop');
  }
}

describe('video recording pauses with the simulation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    HTMLCanvasElement.prototype.getContext = (() => ({
      fillRect() {},
      drawImage() {},
      fillStyle: '',
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as unknown as { captureStream: unknown }).captureStream = () => ({
      getTracks: () => [],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pauses and resumes the recorder, and the clock leaves out the paused time', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const rec = startVideoRecording({
      name: 'test',
      connLayer: svg,
      frameLayer: null,
      viewport: { clientToWorld: (x: number, y: number) => ({ x, y }) } as never,
      workspaceEl: document.createElement('div'),
      onEnd: () => {},
    })!;
    expect(rec).not.toBeNull();
    const recorder = FakeRecorder.last!;

    vi.advanceTimersByTime(2000);
    rec.pause();
    expect(rec.paused).toBe(true);
    expect(recorder.state).toBe('paused');
    const atPause = rec.elapsed();
    vi.advanceTimersByTime(5000);
    expect(rec.elapsed()).toBeCloseTo(atPause, 3);

    rec.resume();
    expect(rec.paused).toBe(false);
    expect(recorder.state).toBe('recording');
    vi.advanceTimersByTime(1000);
    expect(rec.elapsed()).toBeCloseTo(atPause + 1, 1);

    rec.stop();
    expect(recorder.calls).toEqual(['start', 'pause', 'resume', 'stop']);
  });
});
