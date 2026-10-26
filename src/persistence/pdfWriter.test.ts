import { describe, expect, it } from 'vitest';
import { deflateSync, inflateSync } from 'node:zlib';
import { buildPdf } from './pdfWriter';

function latin1(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
}

describe('buildPdf', () => {
  const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]); // 2 x 2
  const pdf = buildPdf(
    {
      width: 595,
      height: 842,
      imageRect: { x: 100, y: 50, w: 200, h: 100 },
      title: 'Press (line 2)',
    },
    { width: 2, height: 2, deflated: new Uint8Array(deflateSync(rgb)) },
  );
  const text = latin1(pdf);

  it('is a PDF with a cross-reference table that points at every object', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = text
      .slice(startxref)
      .split('\n')
      .filter((l) => / 00000 n $/.test(l))
      .map((l) => Number(l.slice(0, 10)));
    expect(offsets).toHaveLength(6);
    offsets.forEach((off, i) => expect(text.slice(off, off + 8)).toBe(`${i + 1} 0 obj\n`));
  });

  it('places the image from the top-left as asked, in PDF bottom-up coordinates', () => {
    expect(text).toContain('/MediaBox [0 0 595 842]');
    expect(text).toContain('q 200 0 0 100 100 692 cm /Im0 Do Q');
  });

  it('embeds the pixels losslessly', () => {
    const start = text.indexOf('stream\n', text.indexOf('/Subtype /Image')) + 'stream\n'.length;
    const length = Number(/\/Subtype \/Image[^>]*\/Length (\d+)/.exec(text)?.[1]);
    expect(Array.from(inflateSync(pdf.slice(start, start + length)))).toEqual(Array.from(rgb));
  });

  it('escapes the title', () => {
    expect(text).toContain('/Title (Press \\(line 2\\))');
  });
});
