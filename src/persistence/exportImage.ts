import { appState } from '../app/AppState';
import { computeContentBounds, type WorldBounds } from '../geometry/contentBounds';
import { buildPdf, MM } from './pdfWriter';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EXPORT_PADDING = 40;

// Wires, ports, and the page frame are all styled entirely through app.css classes (.wire,
// .port, .pageFrame*) rather than inline SVG attributes, unlike every component's own drawing
// (which sets fill/stroke directly - see e.g. shared/svgHelpers.ts's createPort using explicit
// attributes there). The exported document is a standalone SVG with no access to that
// stylesheet, so without their own <style> here those classes do nothing and every one of those
// elements falls back to the SVG default fill (solid black) - most visibly the page frame's own
// rect, big enough to blot out the whole export. Values are the same ones app.css's :root/.wire/
// .port/.pageFrame* rules resolve to, just inlined instead of referenced via var(...), which
// isn't meaningful outside that stylesheet either.
const EXPORT_STYLE = `
  .wire { fill: none; stroke: #000; stroke-width: 2; }
  .wire.dashed { stroke-dasharray: 8 5; }
  .wire.wireElectrical { stroke: #1d3b8b; stroke-width: 1.5; }
  .port.portElectrical { stroke: #1d3b8b; }
  .port.portElectrical.portConnected { stroke: transparent; }
  .port { fill: #fff; stroke: #0a74ff; stroke-width: 1.5; }
  .port.portConnected, .port.portSilenced { fill: transparent; stroke: transparent; }
  .pageFrameRect { fill: rgba(91, 107, 140, 0.045); stroke: #5b6b8c; stroke-width: 2; }
  .pageFrameLabel { font-size: 15px; font-weight: 600; letter-spacing: 0.01em; fill: #5b6b8c; }
  .pageFrameTitleBlock { fill: #f7f7f9; stroke: #5b6b8c; stroke-width: 1.5; }
  .pageFrameGridLine { stroke: #ccc; stroke-width: 1; }
  .pageFrameTitleLabel { font-size: 11px; fill: #666; }
  .pageFrameTitleValue { font-size: 12px; font-weight: 500; fill: #111; }
`;

/** What region of the world an export should crop to - 'auto' is the original behavior (every
 * component's own bounds, unioned, plus a flat padding); an explicit WorldBounds crops to
 * exactly that rect (no extra padding added - the caller already picked the exact edges, e.g.
 * the page frame's own sheet, or whatever's currently on screen). */
export type ExportRegion = 'auto' | WorldBounds;

/** Text a component shows as HTML over its drawing rather than inside its svg - its name label
 * (when switched on) and a cylinder's force readout - which an export has to redraw as svg text,
 * or it would silently go missing. */
const OVERLAY_TEXT_SELECTOR = '.compNameText, .forceLabel';

function isShown(el: HTMLElement, stopAt: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node && node !== stopAt; node = node.parentElement) {
    if (node.style.display === 'none' || getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

/** `el`'s box in its component's own (unrotated) coordinates - offsetLeft/Top ignore CSS
 * transforms, which is exactly what's wanted, since the export applies the rotation itself. */
function localBox(
  el: HTMLElement,
  compEl: HTMLElement,
): { x: number; y: number; w: number; h: number } {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== compEl) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/** Svg text for every shown overlay label of `compEl`, centered where it sits on the canvas. */
function overlayTexts(compEl: HTMLElement): SVGTextElement[] {
  const out: SVGTextElement[] = [];
  for (const el of Array.from(compEl.querySelectorAll<HTMLElement>(OVERLAY_TEXT_SELECTOR))) {
    const text = el.textContent?.trim();
    if (!text || el.closest('svg') || !isShown(el, compEl)) continue;
    const box = localBox(el, compEl);
    const style = getComputedStyle(el);
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(box.x + box.w / 2));
    t.setAttribute('y', String(box.y + box.h / 2));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('font-size', style.fontSize || '12px');
    if (style.fontFamily) t.setAttribute('font-family', style.fontFamily);
    if (style.fontWeight) t.setAttribute('font-weight', style.fontWeight);
    t.setAttribute('fill', style.color || '#666');
    t.textContent = text;
    out.push(t);
  }
  return out;
}

function resolveExportBounds(region: ExportRegion): WorldBounds {
  if (region !== 'auto') return region;

  const bounds = computeContentBounds();
  if (!bounds) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  return {
    minX: bounds.minX - EXPORT_PADDING,
    minY: bounds.minY - EXPORT_PADDING,
    maxX: bounds.maxX + EXPORT_PADDING,
    maxY: bounds.maxY + EXPORT_PADDING,
  };
}

/** Builds the standalone SVG document an export (or the export dialog's own preview) serializes -
 * a plain white background, every wire, every component's own drawing, and the page frame/title
 * block if one is currently on, all cropped to `region`. Exported so ui/exportDialog.ts can build
 * the exact same document for its live preview instead of guessing what an export will look like. */
export function buildExportSvg(
  connLayer: SVGSVGElement,
  frameLayer: SVGSVGElement | null,
  region: ExportRegion,
): SVGSVGElement {
  const { minX, minY, maxX, maxY } = resolveExportBounds(region);
  const width = maxX - minX;
  const height = maxY - minY;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = EXPORT_STYLE;
  svg.appendChild(style);

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(minX));
  bg.setAttribute('y', String(minY));
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', '#ffffff');
  svg.appendChild(bg);

  // Page frame + title block first, so the diagram itself paints on top of it - same stacking
  // as the live canvas (see #frameLayer's own doc in app.css).
  if (frameLayer) {
    for (const child of Array.from(frameLayer.children)) {
      svg.appendChild(child.cloneNode(true) as Element);
    }
  }

  for (const child of Array.from(connLayer.children)) {
    if (!(child instanceof SVGPathElement)) continue;
    if (child.classList.contains('wireHit') || child.classList.contains('wireGhost')) continue;
    const clone = child.cloneNode(true) as SVGPathElement;
    clone.setAttribute('stroke', '#000');
    clone.classList.remove('active', 'selected');
    svg.appendChild(clone);
  }

  for (const c of appState.components) {
    const inner = c.el.querySelector('svg');
    if (!inner) continue;
    const g = document.createElementNS(SVG_NS, 'g');
    // Same placement the live DOM uses: the svg canvas is centered on (c.x, c.y), then the whole
    // component is rotated about that center; mirroring flips the artwork itself (see
    // setComponentMirrored). Using getBounds() here instead would land on the inset inner-bounds
    // box and ignore rotation, shifting every symbol off its wires.
    const rot = Number(c.el.dataset.rot ?? '0');
    const flip = c.el.dataset.mirror === '1' ? ' scale(-1, 1)' : '';
    g.setAttribute(
      'transform',
      `translate(${c.x}, ${c.y}) rotate(${rot})${flip} translate(${-c.svgW / 2}, ${-c.svgH / 2})`,
    );
    for (const child of Array.from(inner.children)) {
      const clone = child.cloneNode(true) as Element;
      clone.classList.remove('pressurized');
      g.appendChild(clone);
    }
    svg.appendChild(g);

    // The labels turn with the component, as on the canvas, but aren't mirrored with its
    // artwork (they sit outside its svg) - so they get their own group without the flip.
    const texts = overlayTexts(c.el);
    if (texts.length > 0) {
      const tg = document.createElementNS(SVG_NS, 'g');
      tg.setAttribute(
        'transform',
        `translate(${c.x}, ${c.y}) rotate(${rot}) translate(${-c.svgW / 2}, ${-c.svgH / 2})`,
      );
      tg.append(...texts);
      svg.appendChild(tg);
    }
  }

  return svg;
}

export function exportProjectAsSvg(
  name: string,
  connLayer: SVGSVGElement,
  frameLayer: SVGSVGElement | null,
  region: ExportRegion,
): void {
  const svg = buildExportSvg(connLayer, frameLayer, region);
  const serialized = new XMLSerializer().serializeToString(svg);
  download(new Blob([serialized], { type: 'image/svg+xml' }), `${name}.svg`);
}

/** Draws the export svg onto a canvas `scale` times its own size. */
async function renderToCanvas(
  svg: SVGSVGElement,
  scale: number,
): Promise<HTMLCanvasElement | null> {
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  const serialized = new XMLSerializer().serializeToString(svg);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  const img = new Image();
  img.src = svgUrl;
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportProjectAsPng(
  name: string,
  connLayer: SVGSVGElement,
  frameLayer: SVGSVGElement | null,
  region: ExportRegion,
): Promise<void> {
  const canvas = await renderToCanvas(buildExportSvg(connLayer, frameLayer, region), 1);
  if (!canvas) return;
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob) download(blob, `${name}.png`);
}

/** Paper sizes, mm, portrait. */
const PAPER_MM = { a4: { w: 210, h: 297 }, a3: { w: 297, h: 420 } };
export type PdfPaper = keyof typeof PAPER_MM;
const PDF_MARGIN_MM = 10;
/** Print resolution of the drawing, dots per inch - sharp on paper, a few MB at most. */
const PDF_DPI = 200;
/** Browsers refuse canvases much past this many pixels (Safari's limit is about 16.7 million). */
const MAX_CANVAS_PIXELS = 16_000_000;

/** Where a drawing `aspect` (width / height) goes on `paper`: turned to whichever orientation
 * suits it, scaled to fit inside the margins and centered. Sizes in pt. */
export function layoutPdfPage(
  paper: PdfPaper,
  aspect: number,
): { width: number; height: number; imageRect: { x: number; y: number; w: number; h: number } } {
  const { w: shortMm, h: longMm } = PAPER_MM[paper];
  const landscape = aspect >= 1;
  const width = (landscape ? longMm : shortMm) * MM;
  const height = (landscape ? shortMm : longMm) * MM;
  const boxW = width - 2 * PDF_MARGIN_MM * MM;
  const boxH = height - 2 * PDF_MARGIN_MM * MM;
  const w = Math.min(boxW, boxH * aspect);
  const h = w / aspect;
  return { width, height, imageRect: { x: (width - w) / 2, y: (height - h) / 2, w, h } };
}

/** zlib-compresses `data` (what a PDF's FlateDecode filter expects). */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Exports as a one-page PDF on A4 or A3 paper, the drawing fitted inside a 10 mm margin. */
export async function exportProjectAsPdf(
  name: string,
  connLayer: SVGSVGElement,
  frameLayer: SVGSVGElement | null,
  region: ExportRegion,
  paper: PdfPaper,
): Promise<void> {
  const svg = buildExportSvg(connLayer, frameLayer, region);
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  const page = layoutPdfPage(paper, width / height);

  const wanted = ((page.imageRect.w / 72) * PDF_DPI) / width;
  const scale = Math.min(wanted, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
  const canvas = await renderToCanvas(svg, scale);
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;

  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i] ?? 255;
    rgb[j + 1] = rgba[i + 1] ?? 255;
    rgb[j + 2] = rgba[i + 2] ?? 255;
  }
  const pdf = buildPdf(
    { ...page, title: name },
    { width: canvas.width, height: canvas.height, deflated: await deflate(rgb) },
  );
  download(new Blob([pdf as BlobPart], { type: 'application/pdf' }), `${name}.pdf`);
}
