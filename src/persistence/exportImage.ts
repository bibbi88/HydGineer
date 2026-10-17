import { appState } from '../app/AppState';
import { computeContentBounds, type WorldBounds } from '../geometry/contentBounds';

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
  const blob = new Blob([serialized], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportProjectAsPng(
  name: string,
  connLayer: SVGSVGElement,
  frameLayer: SVGSVGElement | null,
  region: ExportRegion,
): Promise<void> {
  const svg = buildExportSvg(connLayer, frameLayer, region);
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  const serialized = new XMLSerializer().serializeToString(svg);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  const img = new Image();
  img.src = svgUrl;
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.drawImage(img, 0, 0, width, height);

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
