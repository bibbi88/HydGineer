import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { buildExportSvg } from './exportImage';
import { createSource } from '../components/source';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

function svgLayer(): SVGSVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

describe('buildExportSvg', () => {
  beforeEach(() => {
    appState.components = [];
  });

  it('auto-crops to every component plus a margin when region is "auto"', () => {
    createSource(compLayer(), 100, 100); // not added to appState - shouldn't count
    const comp = createSource(compLayer(), 200, 150);
    appState.addComponent(comp);
    const b = comp.getBounds();

    const svg = buildExportSvg(svgLayer(), null, 'auto');

    const viewBox = svg.getAttribute('viewBox')?.split(' ').map(Number) ?? [];
    expect(viewBox[0]).toBeCloseTo(b.x - 40);
    expect(viewBox[1]).toBeCloseTo(b.y - 40);
    expect(viewBox[2]).toBeCloseTo(b.w + 80);
    expect(viewBox[3]).toBeCloseTo(b.h + 80);
  });

  it('crops to exactly the given region with no extra padding', () => {
    const comp = createSource(compLayer(), 200, 150);
    appState.addComponent(comp);

    const svg = buildExportSvg(svgLayer(), null, { minX: 0, minY: 0, maxX: 500, maxY: 300 });

    expect(svg.getAttribute('viewBox')).toBe('0 0 500 300');
    expect(svg.getAttribute('width')).toBe('500');
    expect(svg.getAttribute('height')).toBe('300');
  });

  it('falls back to a default box when there is nothing on the canvas and region is "auto"', () => {
    const svg = buildExportSvg(svgLayer(), null, 'auto');
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
  });

  it("includes each component's own drawing as a translated group", () => {
    const comp = createSource(compLayer(), 0, 0);
    appState.addComponent(comp);

    const svg = buildExportSvg(svgLayer(), null, 'auto');

    // Background rect (1) plus this component's own cloned drawing.
    expect(svg.children.length).toBeGreaterThan(1);
  });

  it('draws the page frame layer behind the diagram when one is given', () => {
    const frame = svgLayer();
    const frameRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    frameRect.setAttribute('class', 'pageFrameRect');
    frame.appendChild(frameRect);

    const svg = buildExportSvg(svgLayer(), frame, 'auto');

    const clonedFrameRect = svg.querySelector('.pageFrameRect');
    expect(clonedFrameRect).not.toBeNull();
    // Background rect first, then the frame - the diagram (added after, none here) should
    // always end up on top of both.
    const children = Array.from(svg.children);
    expect(children.indexOf(clonedFrameRect as Element)).toBeGreaterThan(0);
  });

  it('omits the frame entirely when none is given', () => {
    const svg = buildExportSvg(svgLayer(), null, 'auto');
    expect(svg.querySelector('.pageFrameRect')).toBeNull();
  });

  // Regression test: wires, ports, and the page frame are styled entirely through app.css
  // classes, not inline SVG attributes (unlike every component's own drawing) - the exported
  // document has no access to that stylesheet, so without an embedded <style> here, .wire's
  // `fill: none` and .pageFrameRect's own fill/stroke never apply and every one of those
  // elements falls back to the SVG default fill (solid black) - the page frame's own rect,
  // being large, was the most visible symptom ("everything is black except the symbols").
  it('embeds a <style> covering .wire, .port and .pageFrame* so they render correctly standalone', () => {
    const svg = buildExportSvg(svgLayer(), null, 'auto');
    const style = svg.querySelector('style');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('.wire');
    expect(style?.textContent).toMatch(/\.wire\s*\{[^}]*fill:\s*none/);
    expect(style?.textContent).toContain('.port');
    expect(style?.textContent).toContain('.pageFrameRect');
  });
});
