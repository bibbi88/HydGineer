/**
 * A minimal PDF writer: one page with one image on it - all an export needs, without pulling a
 * PDF library into the single-file build. The image is RGB, 8 bits per channel, compressed with
 * zlib (FlateDecode), so the drawing goes in losslessly.
 */

export interface PdfImage {
  /** Pixel size. */
  width: number;
  height: number;
  /** The RGB bytes, row by row, zlib-compressed. */
  deflated: Uint8Array;
}

export interface PdfPage {
  /** Page size, pt (1/72 inch). */
  width: number;
  height: number;
  /** Where the image goes, pt, measured from the page's top-left corner. */
  imageRect: { x: number; y: number; w: number; h: number };
  title: string;
}

/** 1 mm in PDF points. */
export const MM = 72 / 25.4;

/** A string literal in PDF syntax: parentheses and backslashes escaped, anything outside
 * printable ASCII replaced - the title is only metadata, so a lossy "?" is fine. */
function pdfString(text: string): string {
  const ascii = text.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (ch) => `\\${ch}`);
  return `(${ascii})`;
}

function num(n: number): string {
  return Number(n.toFixed(3)).toString();
}

export function buildPdf(page: PdfPage, image: PdfImage): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];

  const write = (part: string | Uint8Array): void => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: () => void): void => {
    offsets[id] = length;
    write(`${id} 0 obj\n`);
    body();
    write('\nendobj\n');
  };

  // PDF's own origin is the bottom-left corner.
  const { x, y, w, h } = page.imageRect;
  const content = `q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(page.height - y - h)} cm /Im0 Do Q`;

  write('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  object(1, () => write('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => write('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  object(3, () =>
    write(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
        '/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
    ),
  );
  object(4, () => write(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  object(5, () => {
    write(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ' +
        `/Length ${image.deflated.length} >>\nstream\n`,
    );
    write(image.deflated);
    write('\nendstream');
  });
  object(6, () => write(`<< /Title ${pdfString(page.title)} /Producer (PneuGineer) >>`));

  const xrefAt = length;
  const count = offsets.length;
  write(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) {
    write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${count} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
