import { createSvgEl } from './svgHelpers';

/** The return-spring zigzag, shared by every valve that draws one so the whole symbol set uses
 * a single spring design. Originally tuned on the 5/3 valve (valve53Mono.ts), whose two springs
 * have to fit on the body's end face beside a pilot - hence the compact proportions, which the
 * other valves then adopted rather than each keeping their own.
 *
 * Each valve still owns its copy of these four numbers in its own geometry object (so they can
 * be tuned per symbol), and passes that object straight in - the fields are named to match.
 */
export interface SpringGeometry {
  /** Total reach of the spring, from its anchor to its far end. */
  springSpan: number;
  /** Straight lead-in from the anchor before the zigzag starts. */
  springSegLen: number;
  springZigW: number;
  springZigH: number;
}

export const SPRING_DEFAULT_GEOMETRY: SpringGeometry = {
  springSpan: 24,
  springSegLen: 4,
  springZigW: 5,
  springZigH: 5,
};

/** A compact zigzag between two x-coordinates at a fixed y, representing a return spring: a
 * straight lead-in, three zigzag segments, then a straight run out to `x2`. Drawn right-to-left
 * when `x2 < x1`, so a valve with a spring on each end can use one call per side. */
export function addSpringZigzag(
  parent: SVGElement,
  x1: number,
  x2: number,
  y: number,
  stroke: number,
  geo: SpringGeometry,
): void {
  const dir = x2 >= x1 ? 1 : -1;
  const s = geo.springSegLen;
  const zw = geo.springZigW * dir;
  const zh = geo.springZigH;
  parent.appendChild(
    createSvgEl('path', {
      d: `M ${x1} ${y} l ${s * dir} 0 l ${zw} ${-zh} l ${zw} ${zh * 2} l ${zw} ${-zh * 2} L ${x2} ${y}`,
      fill: 'none',
      stroke: '#111',
      'stroke-width': stroke,
    }),
  );
}
