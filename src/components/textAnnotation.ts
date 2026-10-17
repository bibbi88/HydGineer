import type { Component, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createSvgEl } from './shared/svgHelpers';
import { appState } from '../app/AppState';
import { canEdit } from '../app/modes';

export const TEXT_ANNOTATION_TYPE = 'textAnnotation';

const DEFAULT_TEXT = 'Note';

export type NoteStyle = 'normal' | 'heading' | 'subheading' | 'small' | 'comment' | 'boxed';

interface StyleDef {
  label: string;
  size: number;
  weight: 'normal' | 'bold';
  italic: boolean;
  color: string;
  /** Draws a thin frame around the text. */
  boxed: boolean;
}

export const NOTE_STYLES: Record<NoteStyle, StyleDef> = {
  normal: {
    label: 'Normal',
    size: 13,
    weight: 'normal',
    italic: false,
    color: '#111',
    boxed: false,
  },
  heading: {
    label: 'Heading',
    size: 20,
    weight: 'bold',
    italic: false,
    color: '#111',
    boxed: false,
  },
  subheading: {
    label: 'Subheading',
    size: 16,
    weight: 'bold',
    italic: false,
    color: '#111',
    boxed: false,
  },
  small: { label: 'Small', size: 11, weight: 'normal', italic: false, color: '#555', boxed: false },
  comment: {
    label: 'Comment',
    size: 13,
    weight: 'normal',
    italic: true,
    color: '#555',
    boxed: false,
  },
  boxed: { label: 'Boxed', size: 13, weight: 'normal', italic: false, color: '#111', boxed: true },
};

const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const LINE_HEIGHT = 1.3;
/** Space between the text and the edge of its canvas - room for the selection outline, and the
 * frame of a boxed note. */
const PAD = 6;

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Width of `line` in `style`'s font. Measured on a canvas where there is one; otherwise (tests
 * under jsdom) estimated from an average character width. */
function lineWidth(line: string, style: StyleDef): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d');
    } catch {
      measureCtx = null;
    }
  }
  if (measureCtx) {
    measureCtx.font = `${style.italic ? 'italic ' : ''}${style.weight} ${style.size}px ${FONT_FAMILY}`;
    return measureCtx.measureText(line).width;
  }
  return line.length * style.size * (style.weight === 'bold' ? 0.62 : 0.56);
}

function isNoteStyle(v: unknown): v is NoteStyle {
  return typeof v === 'string' && v in NOTE_STYLES;
}

/** A free-form text note for annotating the diagram - no ports, no simulation behavior. Plain
 * text on the canvas (no box unless the Boxed style is chosen), sized to fit what's written,
 * with its look picked from a few styles in the inspector. Double-click to edit it in place;
 * Enter adds a line, Escape or clicking away finishes.
 *
 * The text is drawn as SVG, not HTML, so it goes into an exported image with everything else;
 * an HTML editor is laid over it only while editing. */
export function createTextAnnotation(compLayer: HTMLElement, x: number, y: number): Component {
  const shell = buildComponentShell(compLayer, TEXT_ANNOTATION_TYPE, x, y, 60, 30, '');

  const frame = createSvgEl('rect', {
    x: 1,
    y: 1,
    rx: 2,
    fill: '#fff',
    stroke: '#111',
    'stroke-width': 1,
  });
  const textSvg = createSvgEl('text', { 'font-family': FONT_FAMILY });
  shell.svg.append(frame, textSvg);

  const editor = document.createElement('div');
  editor.className = 'annotationText';
  shell.el.appendChild(editor);

  let text = DEFAULT_TEXT;
  let style: NoteStyle = 'normal';

  function render(): void {
    const def = NOTE_STYLES[style];
    const lines = text.split('\n');
    const lineH = def.size * LINE_HEIGHT;
    const w = Math.ceil(Math.max(...lines.map((l) => lineWidth(l, def))) + PAD * 2);
    const h = Math.ceil(lines.length * lineH + PAD * 2);

    textSvg.replaceChildren();
    textSvg.setAttribute('font-size', String(def.size));
    textSvg.setAttribute('font-weight', def.weight);
    textSvg.setAttribute('font-style', def.italic ? 'italic' : 'normal');
    textSvg.setAttribute('fill', def.color);
    lines.forEach((line, i) => {
      const tspan = createSvgEl('tspan', {
        x: PAD,
        // Baseline of each line: its share of the line height, less the descender room.
        y: PAD + lineH * (i + 1) - (lineH - def.size) / 2 - def.size * 0.2,
      });
      // A blank line still has to take up its row.
      tspan.textContent = line || ' ';
      textSvg.appendChild(tspan);
    });

    frame.setAttribute('width', String(w - 2));
    frame.setAttribute('height', String(h - 2));
    frame.style.display = def.boxed ? '' : 'none';

    editor.style.font = `${def.italic ? 'italic ' : ''}${def.weight} ${def.size}px/${LINE_HEIGHT} ${FONT_FAMILY}`;
    editor.style.color = def.color;
    editor.style.padding = `${PAD}px`;

    shell.resize(w, h);
    comp.svgW = w;
    comp.svgH = h;
  }

  /** The text as typed: a contenteditable turns each Enter into its own line element, which
   * innerText reads back as newlines (jsdom has no innerText, hence the fallback). */
  function editorText(): string {
    const raw = (editor as HTMLElement & { innerText?: string }).innerText ?? editor.textContent;
    return (raw ?? '').replace(/\r/g, '').replace(/\n+$/, '');
  }

  function enterEditMode(): void {
    if (!canEdit(appState.mode)) return;
    editor.textContent = text;
    editor.contentEditable = 'true';
    editor.classList.add('editing');
    textSvg.style.visibility = 'hidden';
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function exitEditMode(): void {
    if (editor.contentEditable !== 'true') return;
    editor.contentEditable = 'false';
    editor.classList.remove('editing');
    textSvg.style.visibility = '';
    text = editorText().trim() ? editorText() : DEFAULT_TEXT;
    editor.textContent = '';
    render();
    appState.markDirty();
  }

  shell.el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    enterEditMode();
  });
  editor.addEventListener('blur', exitEditMode);
  editor.addEventListener('keydown', (e) => {
    // Keeps Delete/Backspace/Escape from also being read by the global keyboard shortcuts
    // (delete-selected-component, cancel-linking) while actually typing into the note.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      editor.blur();
    }
  });
  // Re-measure as you type, so the outline keeps up with the text.
  editor.addEventListener('input', () => {
    const typed = editorText();
    const def = NOTE_STYLES[style];
    const lines = (typed || ' ').split('\n');
    const w = Math.ceil(Math.max(...lines.map((l) => lineWidth(l, def))) + PAD * 2 + def.size);
    const h = Math.ceil(lines.length * def.size * LINE_HEIGHT + PAD * 2);
    shell.resize(w, h);
  });

  const comp: Component = {
    id: uid(),
    type: TEXT_ANNOTATION_TYPE,
    el: shell.el,
    x,
    y,
    svgW: 60,
    svgH: 30,
    gx: 0,
    gy: 0,
    ports: {},

    conductivityRule(): PortConnection[] {
      return [];
    },

    snapshot(): Record<string, unknown> {
      return { text, style };
    },
    restore(data: Record<string, unknown>): void {
      text = (data.text as string) || DEFAULT_TEXT;
      style = isNoteStyle(data.style) ? data.style : 'normal';
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
