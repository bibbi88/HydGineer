import { createSvgEl } from '../components/shared/svgHelpers';

/** The mark's deep hydraulic red - also the "Hyd" in the app's name and the start screen. */
export const BRAND_COLOR = '#9b1c1c';

/**
 * HydGineer's mark: the ISO 1219 symbol of a hydraulic pump - a circle with a solid triangle
 * (solid: hydraulic; PneuGineer's air would be hollow) pointing to its outlet line, and its
 * drive shaft - white on deep red. Drawn on a 32 x 32 grid; desktop/build/icon.svg is the same.
 */
export function createBrandMark(size: number, className?: string): SVGSVGElement {
  const svg = createSvgEl('svg', {
    viewBox: '0 0 32 32',
    width: size,
    height: size,
    'aria-hidden': 'true',
    ...(className ? { class: className } : {}),
  }) as SVGSVGElement;
  const white = { stroke: '#fff', 'stroke-width': 2.2 };
  svg.append(
    createSvgEl('rect', { x: 1, y: 1, width: 30, height: 30, rx: 7, fill: BRAND_COLOR }),
    createSvgEl('line', { x1: 16, y1: 3.5, x2: 16, y2: 7, ...white, 'stroke-linecap': 'round' }),
    createSvgEl('circle', { cx: 16, cy: 17, r: 10, fill: 'none', ...white }),
    createSvgEl('path', { d: 'M 16 7.6 L 21 15.2 L 11 15.2 Z', fill: '#fff' }),
    createSvgEl('line', { x1: 27, y1: 17, x2: 30, y2: 17, ...white }),
  );
  return svg;
}
