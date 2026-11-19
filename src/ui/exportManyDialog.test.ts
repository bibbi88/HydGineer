import { describe, expect, it } from 'vitest';
import { renderThumb, settingsFor, type ManyOptions, type PageSettings } from './exportManyDialog';

function svg(w: number, h: number): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('width', String(w));
  s.setAttribute('height', String(h));
  return s;
}

const cap = {
  id: 'd1',
  name: 'Press',
  frameSvg: svg(1200, 850),
  contentSvg: svg(400, 600),
  framePaper: 'a3' as const,
};
const fit: PageSettings = {
  part: 'frameOrContent',
  zoom: { fit: true, percent: 100 },
  paper: 'frame',
};

describe('export several: preview pages', () => {
  it('defaults: the page frame, fitted, on its own paper - else the whole diagram', () => {
    expect(renderThumb(cap, fit, 'pdfOne').caption).toBe('A3 landscape · fit to page');
    const noFrame = { ...cap, frameSvg: null };
    expect(renderThumb(noFrame, fit, 'pdfOne').caption).toBe('A3 portrait · fit to page');
  });

  it('a fixed zoom, the whole diagram, another paper; images give their size', () => {
    const own: PageSettings = { part: 'content', zoom: { fit: false, percent: 50 }, paper: 'a4' };
    expect(renderThumb(cap, own, 'pdfEach').caption).toBe('A4 portrait · 50 %');
    const huge: PageSettings = { ...own, zoom: { fit: false, percent: 400 } };
    expect(renderThumb(cap, huge, 'pdfEach').caption).toContain('too large, fitted');
    expect(renderThumb(cap, own, 'png').caption).toBe('200 × 300 px');
  });

  it("a circuit's own settings win over the common ones", () => {
    const own: PageSettings = { ...fit, paper: 'a4' };
    const opts = { common: fit, custom: new Map([['d2', own]]) } as unknown as ManyOptions;
    expect(settingsFor(opts, 'd1')).toBe(fit);
    expect(settingsFor(opts, 'd2')).toBe(own);
  });
});
