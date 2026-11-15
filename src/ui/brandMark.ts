/** The mark's charcoal - also the start screen. */
export const BRAND_COLOR = '#2b2f36';
/** The oil-amber piston - also the "Hyd" in the app's name. */
export const BRAND_ACCENT = '#f59e0b';

/**
 * HydGineer's mark: a double-acting hydraulic cylinder - charcoal barrel between bolted end
 * caps with their ports, an oil-amber piston with its seal, a steel rod and a rod eye - on a
 * transparent background (PneuGineer's is a white cylinder on a blue tile). Drawn on a 32 x 32
 * grid; desktop/build/icon.svg and the favicon in index.html are the same drawing.
 */
const MARK =
  '<g transform="translate(0 1.4)">' +
  '<rect x="2.6" y="6.2" width="2" height="3.2" fill="#2b2f36" stroke="#5b626d" stroke-width="0.5"/>' +
  '<rect x="17.4" y="6.2" width="2" height="3.2" fill="#2b2f36" stroke="#5b626d" stroke-width="0.5"/>' +
  '<rect x="4.5" y="10.2" width="16" height="11.6" fill="#2b2f36" stroke="#5b626d" stroke-width="0.6"/>' +
  '<line x1="5" y1="11.6" x2="20" y2="11.6" stroke="#4a515c" stroke-width="0.8"/>' +
  '<rect x="1.2" y="9" width="4.2" height="14" rx="1" fill="#1d2025" stroke="#5b626d" stroke-width="0.6"/>' +
  '<rect x="16.4" y="9" width="4.2" height="14" rx="1" fill="#1d2025" stroke="#5b626d" stroke-width="0.6"/>' +
  '<circle cx="3.3" cy="10.6" r="0.6" fill="#8a919c"/>' +
  '<circle cx="3.3" cy="21.4" r="0.6" fill="#8a919c"/>' +
  '<circle cx="18.5" cy="10.6" r="0.6" fill="#8a919c"/>' +
  '<circle cx="18.5" cy="21.4" r="0.6" fill="#8a919c"/>' +
  '<rect x="20.6" y="14.3" width="7" height="3.4" fill="#c9ced6" stroke="#2b2f36" stroke-width="0.6"/>' +
  '<line x1="20.9" y1="15.2" x2="27.4" y2="15.2" stroke="#eef1f5" stroke-width="0.6"/>' +
  '<rect x="9" y="11.4" width="3.4" height="9.2" rx="0.6" fill="#f59e0b"/>' +
  '<line x1="10.7" y1="11.4" x2="10.7" y2="20.6" stroke="#b45309" stroke-width="0.7"/>' +
  '<rect x="12.4" y="14.6" width="4" height="2.8" fill="#c9ced6"/>' +
  '<circle cx="29" cy="16" r="2.1" fill="none" stroke="#2b2f36" stroke-width="1.4"/>' +
  '<circle cx="29" cy="16" r="2.1" fill="none" stroke="#5b626d" stroke-width="0.4"/>' +
  '</g>';

export function createBrandMark(size: number, className?: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  svg.innerHTML = MARK;
  return svg;
}
