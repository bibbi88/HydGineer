import type { ViewportAdapter } from '../ui/viewport';
import type { WorldBounds } from '../geometry/contentBounds';
import { computeContentBounds } from '../geometry/contentBounds';
import { getPageFrameWorldBounds } from '../ui/pageFrame';
import { buildExportSvg } from './exportImage';

/** Frames a second of the video. */
const FPS = 25;
/** The video fits inside this, keeping the circuit's proportions. */
const MAX_W = 1920;
const MAX_H = 1080;
/** World units of room round the circuit - a cylinder's rod reaches past its drawing at rest. */
const PADDING = 60;
/** A recording stops by itself after this long, so a forgotten one can't fill the memory. */
const MAX_SECONDS = 15 * 60;
/** One run of the exhaust flow's marching dashes, as app.css's exhaustFlow animation. */
const EXHAUST_PERIOD_S = 0.5;
const EXHAUST_DASH_RUN = 12;

export interface VideoFormat {
  mimeType: string;
  extension: 'mp4' | 'webm';
}

/** The best video format this browser records: MP4 where it can (Chrome, Edge, Safari), else
 * WebM (Firefox). Null where it can't record at all. */
export function pickVideoFormat(
  isSupported: (mime: string) => boolean = (m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
): VideoFormat | null {
  const candidates: VideoFormat[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01F', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];
  return candidates.find((f) => isSupported(f.mimeType)) ?? null;
}

export function canRecordVideo(): boolean {
  return (
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype &&
    pickVideoFormat() !== null
  );
}

/** The video's size for a `w` x `h` world region: as large as fits MAX_W x MAX_H, in even
 * pixels (what H.264 needs). */
export function videoSize(w: number, h: number): { width: number; height: number } {
  const scale = Math.min(MAX_W / w, MAX_H / h);
  const even = (v: number): number => Math.max(2, Math.round((v * scale) / 2) * 2);
  return { width: even(w), height: even(h) };
}

/** What a recording films: the page frame's sheet when one is shown, else the circuit with room
 * round it - fixed when it starts, so the picture doesn't jump about. */
function recordRegion(): WorldBounds {
  const frame = getPageFrameWorldBounds();
  if (frame) return frame;
  const b = computeContentBounds() ?? { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  return {
    minX: b.minX - PADDING,
    minY: b.minY - PADDING,
    maxX: b.maxX + PADDING,
    maxY: b.maxY + PADDING,
  };
}

/** The app's own stylesheet, as text - what a frame is styled with. */
function appCss(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) parts.push(rule.cssText);
    } catch {
      // A stylesheet from elsewhere that won't be read: not the app's.
    }
  }
  return parts.join('\n');
}

/** Styles that differ from the live canvas: the exhaust dashes stood still at `t` seconds (an
 * svg drawn as a picture doesn't animate), and the canvas's font for every text. */
function frameCss(t: number, font: string): string {
  const off = -((t % EXHAUST_PERIOD_S) / EXHAUST_PERIOD_S) * EXHAUST_DASH_RUN;
  const moving = '.wire.exhausting, .qevFlowPath--exhausting, .owfvFlowPath--exhausting';
  return `
    ${moving} { animation: none !important; stroke-dashoffset: ${off}; }
    .wire.exhausting-reverse { stroke-dashoffset: ${-off}; }
    .wire { transition: none !important; }
    text { font-family: ${font}; }
  `;
}

/** A press of the mouse on the canvas, in world coordinates, shown in the video. */
interface Press {
  x: number;
  y: number;
  down: number;
  up: number | null;
}
/** How long, s, a released press's ring fades out. */
const PRESS_FADE_S = 0.6;

function drawPresses(
  ctx: CanvasRenderingContext2D,
  presses: Press[],
  now: number,
  toCanvas: (x: number, y: number) => [number, number],
  scale: number,
): void {
  for (const p of presses) {
    const [cx, cy] = toCanvas(p.x, p.y);
    const r = 14 * scale;
    if (p.up === null) {
      // Held: a filled dot with a ring.
      ctx.fillStyle = 'rgba(10, 116, 255, 0.35)';
      ctx.strokeStyle = 'rgba(10, 116, 255, 0.9)';
      ctx.lineWidth = Math.max(2, 2.5 * scale);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // Let go: the ring grows and fades.
      const k = (now - p.up) / PRESS_FADE_S;
      if (k >= 1) continue;
      ctx.strokeStyle = `rgba(10, 116, 255, ${0.9 * (1 - k)})`;
      ctx.lineWidth = Math.max(2, 2.5 * scale);
      ctx.beginPath();
      ctx.arc(cx, cy, r * (1 + k), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

export interface VideoRecording {
  /** Stops and saves the video. */
  stop(): void;
  /** Seconds recorded so far. */
  elapsed(): number;
}

export interface RecordDeps {
  name: string;
  connLayer: SVGSVGElement;
  frameLayer: SVGSVGElement | null;
  viewport: ViewportAdapter;
  workspaceEl: HTMLElement;
  /** Called once the recording has ended (stopped, or at MAX_SECONDS) and the file is saved. */
  onEnd: () => void;
}

/**
 * Starts filming the canvas: FPS times a second the circuit is drawn as the export draws it,
 * but with the simulation's own look, plus every mouse press on the canvas - into a video
 * recorded in the browser, saved as `name`.mp4 (or .webm) when stopped. Null if this browser
 * can't record video.
 */
export function startVideoRecording(deps: RecordDeps): VideoRecording | null {
  const format = pickVideoFormat();
  if (!format || !canRecordVideo()) return null;

  const region = recordRegion();
  const w = region.maxX - region.minX;
  const h = region.maxY - region.minY;
  const { width, height } = videoSize(w, h);
  const scale = width / w;
  const toCanvas = (x: number, y: number): [number, number] => [
    (x - region.minX) * scale,
    (y - region.minY) * scale,
  ];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  const css = appCss();
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const started = performance.now();
  const seconds = (): number => (performance.now() - started) / 1000;

  // Presses on the canvas, while recording.
  const presses: Press[] = [];
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const p = deps.viewport.clientToWorld(e.clientX, e.clientY);
    presses.push({ x: p.x, y: p.y, down: seconds(), up: null });
  };
  const onUp = (): void => {
    for (const p of presses) if (p.up === null) p.up = seconds();
  };
  deps.workspaceEl.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);

  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mimeType,
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });

  let busy = false;
  let ended = false;
  async function drawFrame(): Promise<void> {
    if (busy || ended) return;
    busy = true;
    const t = seconds();
    try {
      const svg = buildExportSvg(deps.connLayer, deps.frameLayer, region, {
        css: css + frameCss(t, font),
      });
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }),
      );
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        if (ended) return;
        ctx!.fillStyle = '#fff';
        ctx!.fillRect(0, 0, width, height);
        ctx!.drawImage(img, 0, 0, width, height);
      } finally {
        URL.revokeObjectURL(url);
      }
      // Old, faded presses aren't kept.
      for (let i = presses.length - 1; i >= 0; i--) {
        const up = presses[i]!.up;
        if (up !== null && t - up > PRESS_FADE_S) presses.splice(i, 1);
      }
      drawPresses(ctx!, presses, t, toCanvas, scale);
    } catch {
      // A frame that failed to draw: the video keeps the one before.
    } finally {
      busy = false;
    }
    if (t > MAX_SECONDS) stop();
  }

  const timer = setInterval(() => void drawFrame(), 1000 / FPS);

  function stop(): void {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    deps.workspaceEl.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointerup', onUp, true);
    recorder.addEventListener(
      'stop',
      () => {
        for (const track of stream.getTracks()) track.stop();
        const blob = new Blob(chunks, { type: format!.mimeType.split(';')[0] });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${deps.name}.${format!.extension}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        deps.onEnd();
      },
      { once: true },
    );
    recorder.stop();
  }

  void drawFrame();
  recorder.start(1000);
  return { stop, elapsed: seconds };
}
