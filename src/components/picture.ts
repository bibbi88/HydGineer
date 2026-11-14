import type { Component, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createSvgEl } from './shared/svgHelpers';

export const PICTURE_TYPE = 'picture';

/** Size of a picture placed without an image yet (from the library), until one is chosen. */
const EMPTY_W = 160;
const EMPTY_H = 100;
/** Widest a picture is shown when first inserted; resize it from the inspector. */
export const INSERT_MAX_WIDTH = 400;
export const MIN_PICTURE_WIDTH = 20;
export const MAX_PICTURE_WIDTH = 3000;

/**
 * A picture on the canvas - a photo of the real machine, a sketch, a logo for the title block.
 * Pasted (Ctrl+V), dropped onto the canvas as a file, or chosen after placing one from the
 * library (see interaction/pictures.ts). Kept in the project itself, as a data URL, so the file
 * stays self-contained. It takes no part in the circuit.
 *
 * Its width is set in the inspector; the height follows from the picture's own proportions.
 */
export function createPicture(compLayer: HTMLElement, x: number, y: number): Component {
  const shell = buildComponentShell(compLayer, PICTURE_TYPE, x, y, EMPTY_W, EMPTY_H, 'Picture');

  // No picture yet: a dashed frame saying what to do.
  const placeholder = createSvgEl('g');
  const frame = createSvgEl('rect', {
    x: 1,
    y: 1,
    fill: '#fafafa',
    stroke: '#999',
    'stroke-width': 1.5,
    'stroke-dasharray': '6 4',
  });
  const prompt = createSvgEl('text', {
    'text-anchor': 'middle',
    'font-size': 12,
    fill: '#666',
  });
  prompt.textContent = 'Double-click to choose a picture';
  placeholder.append(frame, prompt);

  const image = createSvgEl('image', { x: 0, y: 0, preserveAspectRatio: 'none' });
  shell.svg.append(placeholder, image);

  let src = '';
  let width = EMPTY_W;
  /** Height / width of the picture itself. */
  let aspect = EMPTY_H / EMPTY_W;

  function render(): void {
    const w = Math.round(width);
    const h = Math.max(1, Math.round(width * aspect));
    shell.resize(w, h);
    comp.svgW = w;
    comp.svgH = h;
    placeholder.style.display = src ? 'none' : '';
    image.style.display = src ? '' : 'none';
    frame.setAttribute('width', String(w - 2));
    frame.setAttribute('height', String(h - 2));
    prompt.setAttribute('x', String(w / 2));
    prompt.setAttribute('y', String(h / 2 + 4));
    if (src) {
      image.setAttribute('href', src);
      image.setAttribute('width', String(w));
      image.setAttribute('height', String(h));
    } else {
      image.removeAttribute('href');
    }
  }

  const comp: Component = {
    id: uid(),
    type: PICTURE_TYPE,
    el: shell.el,
    x,
    y,
    svgW: EMPTY_W,
    svgH: EMPTY_H,
    gx: 0,
    gy: 0,
    ports: {},

    conductivityRule(): PortConnection[] {
      return [];
    },

    snapshot(): Record<string, unknown> {
      return {
        src,
        width,
        aspect,
        showName: shell.getNameVisible(),
        customName: shell.getCustomName(),
      };
    },
    restore(data: Record<string, unknown>): void {
      src = typeof data.src === 'string' ? data.src : '';
      const w = Number(data.width);
      width = Number.isFinite(w)
        ? Math.min(MAX_PICTURE_WIDTH, Math.max(MIN_PICTURE_WIDTH, w))
        : EMPTY_W;
      const a = Number(data.aspect);
      aspect = Number.isFinite(a) && a > 0 ? a : EMPTY_H / EMPTY_W;
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      render();
    },
    reset(): void {},

    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
  };

  render();
  return comp;
}
