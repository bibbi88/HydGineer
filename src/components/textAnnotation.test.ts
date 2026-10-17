import { describe, expect, it } from 'vitest';
import { createTextAnnotation } from './textAnnotation';

const layer = (): HTMLElement => document.createElement('div');

function lines(note: ReturnType<typeof createTextAnnotation>): string[] {
  return Array.from(note.el.querySelectorAll('tspan')).map((t) => t.textContent ?? '');
}

describe('text note', () => {
  it('is plain text drawn in the SVG (so it exports), with no box by default', () => {
    const note = createTextAnnotation(layer(), 0, 0);
    expect(lines(note)).toEqual(['Note']);
    const frame = note.el.querySelector('rect') as SVGRectElement;
    expect(frame.style.display).toBe('none');
  });

  it('keeps each line of a multi-line text, and grows to fit it', () => {
    const note = createTextAnnotation(layer(), 0, 0);
    const before = note.getBounds();
    note.restore({ text: 'Start sequence\nwith S1', style: 'normal' });
    expect(lines(note)).toEqual(['Start sequence', 'with S1']);
    const after = note.getBounds();
    expect(after.w).toBeGreaterThan(before.w);
    expect(after.h).toBeGreaterThan(before.h);
    expect(note.svgH).toBe(Number(note.el.querySelector('svg')?.getAttribute('height')));
  });

  it('applies the chosen style, and the boxed one draws its frame', () => {
    const note = createTextAnnotation(layer(), 0, 0);
    note.restore({ text: 'Title', style: 'heading' });
    const text = note.el.querySelector('text') as SVGTextElement;
    expect(text.getAttribute('font-weight')).toBe('bold');
    expect(text.getAttribute('font-size')).toBe('20');

    note.restore({ text: 'Title', style: 'boxed' });
    expect((note.el.querySelector('rect') as SVGRectElement).style.display).toBe('');
  });

  it('falls back to the normal style for a note saved before styles existed', () => {
    const note = createTextAnnotation(layer(), 0, 0);
    note.restore({ text: 'Old note' });
    expect(note.snapshot()).toEqual({ text: 'Old note', style: 'normal' });
  });
});
