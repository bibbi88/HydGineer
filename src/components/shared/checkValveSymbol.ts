import { createSvgEl } from './svgHelpers';

export interface Point {
  x: number;
  y: number;
}

export interface BallCheckSymbol {
  /** Where a lead-in line from the OUT side should terminate - the ball's outer edge. */
  outPoint: Point;
  /** Where a lead-in line from the IN side should terminate - the seat's apex/tip. */
  inPoint: Point;
}

/** Draws the ball-and-seat check-valve glyph - shared by checkValve.ts and anything else that
 * needs the exact same symbol (e.g. the one-way flow control valve's own check-valve half)
 * rather than a redrawn approximation of it. `axis`/`dir` say which way flow runs: 'vertical'
 * with dir 1 matches checkValve.ts's own IN-bottom/OUT-top orientation; 'horizontal' with dir 1
 * gives IN-left/OUT-right. `scale` 1 is the glyph's original full size (ball r=9, etc.) -
 * checkValve.ts itself uses 0.6. */
export function drawBallCheckSymbol(
  parent: SVGElement,
  cx: number,
  cy: number,
  axis: 'horizontal' | 'vertical',
  dir: 1 | -1,
  scale: number,
): BallCheckSymbol {
  const ballU = 5 * scale;
  const ballR = 9 * scale;
  const seatNearU = 8 * scale;
  const seatFarU = -12 * scale;
  const seatSpread = 16 * scale;
  const stroke = 3 * scale;

  // u runs along the flow axis (positive = toward OUT), v is the perpendicular spread - this
  // local frame is what checkValve.ts's own numbers were derived from, just abstracted so any
  // axis/direction can reuse it.
  function toWorld(u: number, v: number): Point {
    if (axis === 'horizontal') return { x: cx + u * dir, y: cy + v };
    return { x: cx + v, y: cy - u * dir };
  }

  const ball = toWorld(ballU, 0);
  const seatA = toWorld(seatNearU, -seatSpread);
  const seatB = toWorld(seatNearU, seatSpread);
  const apex = toWorld(seatFarU, 0);

  parent.appendChild(
    createSvgEl('line', {
      x1: seatA.x,
      y1: seatA.y,
      x2: apex.x,
      y2: apex.y,
      stroke: '#111',
      'stroke-width': stroke,
    }),
  );
  parent.appendChild(
    createSvgEl('line', {
      x1: seatB.x,
      y1: seatB.y,
      x2: apex.x,
      y2: apex.y,
      stroke: '#111',
      'stroke-width': stroke,
    }),
  );
  parent.appendChild(
    createSvgEl('circle', {
      cx: ball.x,
      cy: ball.y,
      r: ballR,
      fill: '#fff',
      stroke: '#111',
      'stroke-width': stroke,
    }),
  );

  return { outPoint: toWorld(ballU + ballR, 0), inPoint: apex };
}
