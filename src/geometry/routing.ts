import type { WireGuide } from '../core/types';
import { WIRE_STUB } from '../sim/constants';

export interface Point {
  x: number;
  y: number;
}

export interface PortAnchor {
  pos: Point;
  entryOrientation: 'H' | 'V';
  pilotDir?: 1 | -1;
}

export function pathFromPoints(points: Point[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

export function distPointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

export function hitTestWire(points: Point[], p: Point, threshold: number): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a && b && distPointToSegment(p, a, b) <= threshold) return true;
  }
  return false;
}

export function collapseColinear(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const out: Point[] = [points[0] as Point];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1] as Point;
    const cur = points[i] as Point;
    const next = points[i + 1] as Point;
    const sameLineHoriz = prev.y === cur.y && cur.y === next.y;
    const sameLineVert = prev.x === cur.x && cur.x === next.x;
    if (!sameLineHoriz && !sameLineVert) out.push(cur);
  }
  out.push(points[points.length - 1] as Point);
  return out;
}

/** The direction (away from the port, along its entry axis) a stub travels in. Fixed by
 * `pilotDir` for ports that always exit one particular way (e.g. pilots), otherwise whichever
 * side `towardPos` currently falls on. */
export function stubDirection(anchor: PortAnchor, towardPos: Point): 1 | -1 {
  const { pos, entryOrientation, pilotDir } = anchor;
  if (entryOrientation === 'H') return pilotDir ?? (towardPos.x >= pos.x ? 1 : -1);
  return pilotDir ?? (towardPos.y >= pos.y ? 1 : -1);
}

export function stubPoint(anchor: PortAnchor, towardPos: Point, len: number): Point {
  const { pos, entryOrientation } = anchor;
  const dir = stubDirection(anchor, towardPos);
  if (entryOrientation === 'H') return { x: pos.x + dir * len, y: pos.y };
  return { x: pos.x, y: pos.y + dir * len };
}

/** Inverse of `stubPoint`: how long a stub would need to be for its point to sit under
 * `world`, projected onto the port's entry axis and clamped to non-negative (a negative
 * length would mean the wire doubling back through the port itself). Used to turn a handle
 * drag's pointer position back into a `stubStartLen`/`stubEndLen` value. */
export function stubLenFromPoint(anchor: PortAnchor, towardPos: Point, world: Point): number {
  const { pos, entryOrientation } = anchor;
  const dir = stubDirection(anchor, towardPos);
  const raw = entryOrientation === 'H' ? (world.x - pos.x) * dir : (world.y - pos.y) * dir;
  return Math.max(0, raw);
}

/** Default orthogonal auto-route: stub out of each port, then one corner between them. */
export function routeAuto(
  from: PortAnchor,
  to: PortAnchor,
  stubStartLen: number | null = null,
  stubEndLen: number | null = null,
): Point[] {
  const stubOut = stubPoint(from, to.pos, stubStartLen ?? WIRE_STUB);
  const stubIn = stubPoint(to, from.pos, stubEndLen ?? WIRE_STUB);

  const points: Point[] = [from.pos, stubOut];
  if (stubOut.x !== stubIn.x && stubOut.y !== stubIn.y) {
    points.push({ x: stubIn.x, y: stubOut.y });
  }
  points.push(stubIn, to.pos);
  return collapseColinear(points);
}

/** Point at half the total length along a polyline, for placing a wire's pressure label. */
export function polylineMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0] as Point;

  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLengths.push(len);
    total += len;
  }

  let remaining = total / 2;
  for (let i = 0; i < segLengths.length; i++) {
    const len = segLengths[i] as number;
    if (remaining <= len) {
      const a = points[i] as Point;
      const b = points[i + 1] as Point;
      const t = len === 0 ? 0 : remaining / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= len;
  }
  return points[points.length - 1] as Point;
}

/** The stub-out point plus the bend point each guide produces, in order - guideCorners[i + 1]
 * is exactly the point guides[i] defines, so callers (e.g. drag handles) can map one to the
 * other with no ambiguity. Does not include stubIn or the final port positions. */
export function guideCorners(
  from: PortAnchor,
  to: PortAnchor,
  guides: WireGuide[],
  stubStartLen: number | null = null,
): Point[] {
  const stubOut = stubPoint(from, to.pos, stubStartLen ?? WIRE_STUB);
  const corners: Point[] = [stubOut];
  let cur = stubOut;
  for (const g of guides) {
    const next = g.type === 'H' ? { x: cur.x, y: g.pos } : { x: g.pos, y: cur.y };
    corners.push(next);
    cur = next;
  }
  return corners;
}

/**
 * `guides`, plus the extra bend `routeWithGuides` draws when the last guide's corner doesn't
 * line up with the end stub (typically after the component at that end has been moved). That
 * bend is real on screen but absent from the guide list, so anything that maps the guide list
 * back onto the drawn wire - splitting it at a drop point, adding a bend where it was
 * double-clicked, placing drag handles - must use this instead, or it measures against an
 * imaginary diagonal from the last corner straight to the port and lands somewhere the wire
 * isn't. Returns `guides` itself when no bend is missing.
 */
export function completeGuides(
  from: PortAnchor,
  to: PortAnchor,
  guides: WireGuide[],
  stubStartLen: number | null = null,
  stubEndLen: number | null = null,
): WireGuide[] {
  const stubIn = stubPoint(to, from.pos, stubEndLen ?? WIRE_STUB);
  const corners = guideCorners(from, to, guides, stubStartLen);
  const last = corners[corners.length - 1] as Point;
  if (last.x !== stubIn.x && last.y !== stubIn.y) {
    // routeWithGuides bridges with { x: stubIn.x, y: last.y } - a bend that fixes x.
    return [...guides, { type: 'V', pos: stubIn.x }];
  }
  return guides;
}

/** Reverse-engineers a guide list from a rendered path's internal corners, so a connection
 * that's still on auto-route can be "seeded" with editable guides matching its current visual
 * shape the first time the user drags a bend.
 *
 * `stubOut`/`stubIn` must be the actual computed stub points (see `stubPoint`), not assumed
 * from position in the array: `collapseColinear` can merge either literal stub point into what
 * is really the first/last bend (when they happen to fall on the same line), which would shift
 * a fixed-index assumption and silently drop or misidentify a bend.
 */
export function seedGuidesFromPoints(points: Point[], stubOut: Point, stubIn: Point): WireGuide[] {
  const guides: WireGuide[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const cur = points[i] as Point;
    if (
      (cur.x === stubOut.x && cur.y === stubOut.y) ||
      (cur.x === stubIn.x && cur.y === stubIn.y)
    ) {
      continue;
    }
    const prev = points[i - 1] as Point;
    guides.push(prev.x === cur.x ? { type: 'H', pos: cur.y } : { type: 'V', pos: cur.x });
  }
  return guides;
}

/** Routes through user-placed guides: each guide fixes one axis of the next bend point. */
export function routeWithGuides(
  from: PortAnchor,
  to: PortAnchor,
  guides: WireGuide[],
  stubStartLen: number | null = null,
  stubEndLen: number | null = null,
): Point[] {
  const stubIn = stubPoint(to, from.pos, stubEndLen ?? WIRE_STUB);
  const corners = guideCorners(from, to, guides, stubStartLen);
  const cur = corners[corners.length - 1] as Point;

  const points: Point[] = [from.pos, ...corners];
  // The last guide point isn't guaranteed to share an axis with stubIn (e.g. after dragging a
  // guide) - bridge with an extra corner so the final approach stays orthogonal instead of
  // cutting a diagonal line straight to the port.
  if (cur.x !== stubIn.x && cur.y !== stubIn.y) {
    points.push({ x: stubIn.x, y: cur.y });
  }
  points.push(stubIn, to.pos);
  return collapseColinear(points);
}
