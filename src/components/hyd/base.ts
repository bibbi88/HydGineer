import type { Component, PortDef } from '../../core/types';
import { uid } from '../../core/ids';
import { buildComponentShell, createSvgEl, type ComponentShell } from '../shared/svgHelpers';

/** Stroke colour/width every hydraulic symbol is drawn with. */
export const INK = '#111';
export const STROKE = 2;

/**
 * Hydraulic symbols are laid out on the same 10 px grid as the wires: every component's canvas is
 * a multiple of 20 px wide and high and every port sits on a multiple of 10 px, so a component
 * dropped at a snapped position has all of its ports on the grid (see core/grid.ts).
 */
export interface HydShell extends ComponentShell {
  /** The drawing group, already appended to the svg. */
  g: SVGGElement;
  /** Live readout shown next to the symbol while the simulation runs. */
  setInfo(lines: string[]): void;
  /** Where that readout sits relative to the symbol (default: below). */
  setInfoSide(side: 'below' | 'left' | 'right' | 'above'): void;
}

export function createHydShell(
  compLayer: HTMLElement,
  type: string,
  x: number,
  y: number,
  svgW: number,
  svgH: number,
  label: string,
  inner?: { x: number; y: number; w: number; h: number },
): HydShell {
  const shell = buildComponentShell(compLayer, type, x, y, svgW, svgH, label, inner);
  shell.svg.style.overflow = 'visible';
  const g = createSvgEl('g');
  shell.svg.appendChild(g);

  const info = document.createElement('div');
  info.className = 'hydInfo';
  shell.el.appendChild(info);
  let last = '';
  return {
    ...shell,
    g,
    setInfoSide(side: 'below' | 'left' | 'right' | 'above'): void {
      info.dataset.side = side;
    },
    setInfo(lines: string[]): void {
      const text = lines.join('\n');
      if (text === last) return;
      last = text;
      info.textContent = text;
      info.style.display = text ? '' : 'none';
    },
  };
}

/** The boilerplate part of a Component every hydraulic symbol shares. */
export function hydComponentBase(
  shell: HydShell,
  type: string,
  x: number,
  y: number,
  svgW: number,
  svgH: number,
  ports: Record<string, PortDef>,
): Component {
  const comp: Component = {
    id: uid(),
    type,
    el: shell.el,
    x,
    y,
    svgW,
    svgH,
    gx: 0,
    gy: 0,
    ports,
    conductivityRule: () => [],
    snapshot: () => ({}),
    restore: () => {},
    reset: () => {},
    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
  };
  return comp;
}

export function nameSnapshot(shell: ComponentShell): Record<string, unknown> {
  return { showName: shell.getNameVisible(), customName: shell.getCustomName() };
}

export function restoreName(shell: ComponentShell, data: Record<string, unknown>): void {
  if ('showName' in data) shell.setNameVisible(Boolean(data.showName));
  if ('customName' in data) shell.setCustomName((data.customName as string | null) ?? null);
}

/** A finite number from a snapshot field, clamped to [min, max], or `fallback`. */
export function readNum(
  data: Record<string, unknown>,
  key: string,
  fallback: number,
  min = -Infinity,
  max = Infinity,
): number {
  const v = Number(data[key]);
  if (data[key] === undefined || data[key] === null || data[key] === '' || !Number.isFinite(v)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, v));
}

export function fmtBar(p: number): string {
  return `${(Math.abs(p) < 0.05 ? 0 : p).toFixed(1)} bar`;
}

export function fmtFlow(q: number): string {
  const a = Math.abs(q);
  if (a < 0.005) return '0.00 L/min';
  return `${q.toFixed(a < 10 ? 2 : 1)} L/min`;
}

export function line(
  g: SVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  attrs: Record<string, string | number> = {},
): SVGLineElement {
  const el = createSvgEl('line', {
    x1,
    y1,
    x2,
    y2,
    stroke: INK,
    'stroke-width': STROKE,
    'stroke-linecap': 'round',
    ...attrs,
  });
  g.appendChild(el);
  return el;
}

export function path(
  g: SVGElement,
  d: string,
  attrs: Record<string, string | number> = {},
): SVGPathElement {
  const el = createSvgEl('path', {
    d,
    stroke: INK,
    'stroke-width': STROKE,
    fill: 'none',
    'stroke-linejoin': 'round',
    ...attrs,
  });
  g.appendChild(el);
  return el;
}

/** Filled arrowhead with its tip at (x, y), pointing along angle `deg` (0 = right, -90 = up). */
export function arrowHead(
  g: SVGElement,
  x: number,
  y: number,
  deg: number,
  size = 7,
): SVGPolygonElement {
  const a = (deg * Math.PI) / 180;
  const bx = x - size * Math.cos(a);
  const by = y - size * Math.sin(a);
  const px = -Math.sin(a) * size * 0.45;
  const py = Math.cos(a) * size * 0.45;
  const el = createSvgEl('polygon', {
    points: `${x},${y} ${bx + px},${by + py} ${bx - px},${by - py}`,
    fill: INK,
  });
  g.appendChild(el);
  return el;
}

/** Line from (x1,y1) to (x2,y2) ending in an arrowhead at (x2,y2). */
export function arrowLine(
  g: SVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): SVGElement[] {
  const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const k = Math.max(0, (len - 6) / len);
  return [line(g, x1, y1, x1 + (x2 - x1) * k, y1 + (y2 - y1) * k), arrowHead(g, x2, y2, deg)];
}

/** ISO "blocked port" mark: a short stub from (x, y) along `dir` with a cross-bar. */
export function blocked(g: SVGElement, x: number, y: number, dir: 1 | -1): void {
  line(g, x, y, x, y + dir * 10);
  line(g, x - 6, y + dir * 10, x + 6, y + dir * 10);
}

/** Adjustable-setting arrow: a diagonal arrow across a symbol (spring, throttle). */
export function adjustArrow(g: SVGElement, cx: number, cy: number, r = 14): void {
  arrowLine(g, cx - r, cy + r, cx + r, cy - r);
}

/** Return-spring zigzag between (x1, y) and (x2, y). */
export function springH(g: SVGElement, x1: number, x2: number, y: number, h = 6): void {
  const n = 5;
  const step = (x2 - x1) / (n + 1);
  let d = `M ${x1} ${y}`;
  for (let i = 0; i < n; i++) d += ` L ${x1 + step * (i + 0.5)} ${y + (i % 2 === 0 ? -h : h)}`;
  d += ` L ${x2} ${y}`;
  path(g, d);
}

/** Return-spring zigzag between (x, y1) and (x, y2). */
export function springV(g: SVGElement, x: number, y1: number, y2: number, w = 6): void {
  const n = 5;
  const step = (y2 - y1) / (n + 1);
  let d = `M ${x} ${y1}`;
  for (let i = 0; i < n; i++) d += ` L ${x + (i % 2 === 0 ? -w : w)} ${y1 + step * (i + 0.5)}`;
  d += ` L ${x} ${y2}`;
  path(g, d);
}

/** ISO tank symbol: an open-topped box with the line entering it, the line ending at (cx, top). */
export function tankGlyph(g: SVGElement, cx: number, top: number, w = 30, h = 14): void {
  path(g, `M ${cx - w / 2} ${top + 4} V ${top + 4 + h} H ${cx + w / 2} V ${top + 4}`);
  line(g, cx, top, cx, top + 4 + h - 4);
}
