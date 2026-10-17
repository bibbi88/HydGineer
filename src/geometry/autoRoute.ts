import type { Component, ComponentId } from '../core/types';
import { collapseColinear, stubPoint, type Point, type PortAnchor } from './routing';
import { WIRE_STUB } from '../sim/constants';

const CELL_SIZE = 20;
const OBSTACLE_COST = 8;
const TURN_PENALTY = 4;
const GRID_MARGIN_PX = 80;
/** Extra cost per cell already occupied by another wire. Low enough that crossing a wire (one
 * or two cells) costs less than a detour, high enough that running *along* one for any distance
 * - two wires drawn on top of each other, which reads as one wire - loses to a parallel route
 * a cell over. */
const WIRE_COST = 3;

interface Grid {
  cellSize: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  cost: Uint8Array;
}

function toCell(grid: Grid, p: Point): { col: number; row: number } {
  const col = Math.max(0, Math.min(grid.cols - 1, Math.round((p.x - grid.minX) / grid.cellSize)));
  const row = Math.max(0, Math.min(grid.rows - 1, Math.round((p.y - grid.minY) / grid.cellSize)));
  return { col, row };
}

function toPoint(grid: Grid, col: number, row: number): Point {
  return { x: grid.minX + col * grid.cellSize, y: grid.minY + row * grid.cellSize };
}

/** Adds WIRE_COST to every grid cell an existing wire's polyline runs through. The wires are
 * orthogonal, so each segment is a straight run along one row or column. */
function markWires(grid: Grid, wires: Point[][]): void {
  const { cols, rows, cost, minX, minY, cellSize } = grid;
  const colOf = (x: number): number => Math.round((x - minX) / cellSize);
  const rowOf = (y: number): number => Math.round((y - minY) / cellSize);
  for (const points of wires) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i] as Point;
      const b = points[i + 1] as Point;
      let c0 = colOf(Math.min(a.x, b.x));
      let c1 = colOf(Math.max(a.x, b.x));
      let r0 = rowOf(Math.min(a.y, b.y));
      let r1 = rowOf(Math.max(a.y, b.y));
      if (c1 < 0 || r1 < 0 || c0 >= cols || r0 >= rows) continue;
      c0 = Math.max(0, c0);
      r0 = Math.max(0, r0);
      c1 = Math.min(cols - 1, c1);
      r1 = Math.min(rows - 1, r1);
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const idx = row * cols + col;
          cost[idx] = Math.min(255, (cost[idx] ?? 0) + WIRE_COST);
        }
      }
    }
  }
}

function buildGrid(
  components: Component[],
  excludeIds: Set<ComponentId>,
  from: Point,
  to: Point,
): Grid {
  let minX = Math.min(from.x, to.x) - GRID_MARGIN_PX;
  let maxX = Math.max(from.x, to.x) + GRID_MARGIN_PX;
  let minY = Math.min(from.y, to.y) - GRID_MARGIN_PX;
  let maxY = Math.max(from.y, to.y) + GRID_MARGIN_PX;

  for (const c of components) {
    if (excludeIds.has(c.id)) continue;
    const b = c.getBounds();
    minX = Math.min(minX, b.x - GRID_MARGIN_PX);
    maxX = Math.max(maxX, b.x + b.w + GRID_MARGIN_PX);
    minY = Math.min(minY, b.y - GRID_MARGIN_PX);
    maxY = Math.max(maxY, b.y + b.h + GRID_MARGIN_PX);
  }

  const cols = Math.max(1, Math.ceil((maxX - minX) / CELL_SIZE) + 1);
  const rows = Math.max(1, Math.ceil((maxY - minY) / CELL_SIZE) + 1);
  const cost = new Uint8Array(cols * rows);

  const grid: Grid = { cellSize: CELL_SIZE, minX, minY, cols, rows, cost };

  const padding = 8;
  for (const c of components) {
    if (excludeIds.has(c.id)) continue;
    const b = c.getBounds();
    const topLeft = toCell(grid, { x: b.x - padding, y: b.y - padding });
    const bottomRight = toCell(grid, { x: b.x + b.w + padding, y: b.y + b.h + padding });
    for (let row = topLeft.row; row <= bottomRight.row; row++) {
      for (let col = topLeft.col; col <= bottomRight.col; col++) {
        cost[row * cols + col] = OBSTACLE_COST;
      }
    }
  }

  return grid;
}

interface OpenEntry {
  col: number;
  row: number;
  dir: number;
  g: number;
  f: number;
}

const DIRS = [
  { dc: 1, dr: 0 },
  { dc: -1, dr: 0 },
  { dc: 0, dr: 1 },
  { dc: 0, dr: -1 },
];

/** Simple grid A* with a Manhattan heuristic and a penalty for changing direction. */
function astar(
  grid: Grid,
  start: { col: number; row: number },
  goal: { col: number; row: number },
): Point[] | null {
  const { cols, rows, cost } = grid;
  const key = (col: number, row: number, dir: number): string => `${col},${row},${dir}`;

  const startEntry: OpenEntry = { ...start, dir: -1, g: 0, f: 0 };
  const open = new Map<string, OpenEntry>([[key(start.col, start.row, -1), startEntry]]);
  const cameFrom = new Map<string, string>();
  const closed = new Set<string>();
  const bestG = new Map<string, number>([[key(start.col, start.row, -1), 0]]);

  const heuristic = (col: number, row: number): number =>
    Math.abs(goal.col - col) + Math.abs(goal.row - row);

  let goalKey: string | null = null;

  while (open.size > 0) {
    let currentKey = '';
    let current: OpenEntry | null = null;
    for (const [k, entry] of open) {
      if (!current || entry.f < current.f) {
        current = entry;
        currentKey = k;
      }
    }
    if (!current) break;
    open.delete(currentKey);
    closed.add(currentKey);

    if (current.col === goal.col && current.row === goal.row) {
      goalKey = currentKey;
      break;
    }

    for (let dirIdx = 0; dirIdx < DIRS.length; dirIdx++) {
      const dir = DIRS[dirIdx] as { dc: number; dr: number };
      const nCol = current.col + dir.dc;
      const nRow = current.row + dir.dr;
      if (nCol < 0 || nCol >= cols || nRow < 0 || nRow >= rows) continue;

      const nKey = key(nCol, nRow, dirIdx);
      if (closed.has(nKey)) continue;

      const cellCost = 1 + (cost[nRow * cols + nCol] ?? 0);
      const turnCost = current.dir !== -1 && current.dir !== dirIdx ? TURN_PENALTY : 0;
      const g = current.g + cellCost + turnCost;

      const prevBest = bestG.get(nKey);
      if (prevBest !== undefined && g >= prevBest) continue;

      bestG.set(nKey, g);
      cameFrom.set(nKey, currentKey);
      open.set(nKey, { col: nCol, row: nRow, dir: dirIdx, g, f: g + heuristic(nCol, nRow) });
    }
  }

  if (!goalKey) return null;

  const cellPath: Array<{ col: number; row: number }> = [];
  let cur: string | null = goalKey;
  while (cur) {
    const [colStr, rowStr] = cur.split(',');
    cellPath.push({ col: Number(colStr), row: Number(rowStr) });
    cur = cameFrom.get(cur) ?? null;
  }
  cellPath.reverse();

  return cellPath.map((c) => toPoint(grid, c.col, c.row));
}

/**
 * The grid path's cells are centered on a coarse 20px grid, which generally doesn't land
 * exactly on the continuous stubOut/stubIn coordinates. Rather than bridging the gap with an
 * extra perpendicular corner (which reads as a needless little zigzag right at the port), shift
 * the path's leading and trailing straight runs sideways so they align exactly with the stub -
 * the run's own length absorbs the few pixels of grid-rounding instead of adding a new segment.
 * Returns null when the two runs would overlap - meaning the whole grid path is really just one
 * straight run with no bend in it at all (e.g. start and goal landed in the same row/column),
 * so there's nothing for a "shift this run" adjustment to anchor to. The caller falls back to
 * `directBridge` for that case, which connects the stubs directly instead of replaying a coarse
 * grid path whose only content was rounding noise.
 */
function alignRunsToStubs(gridPath: Point[], stubOut: Point, stubIn: Point): Point[] | null {
  const points = gridPath.map((p) => ({ ...p }));
  const n = points.length;
  // Fewer than 3 points can't contain a bend either (0 or 1 grid moves) - same "nothing to
  // anchor an alignment to" situation as the overlap check below.
  if (n < 3) return null;

  const p0 = points[0] as Point;
  const p1 = points[1] as Point;
  const leadHorizontal = p0.y === p1.y;
  const leadCrossVal = leadHorizontal ? p0.y : p0.x;
  let leadEnd = 0;
  while (
    leadEnd < n &&
    (leadHorizontal
      ? (points[leadEnd] as Point).y === leadCrossVal
      : (points[leadEnd] as Point).x === leadCrossVal)
  ) {
    leadEnd++;
  }

  const pLast = points[n - 1] as Point;
  const pPrev = points[n - 2] as Point;
  const tailHorizontal = pLast.y === pPrev.y;
  const tailCrossVal = tailHorizontal ? pLast.y : pLast.x;
  let tailStart = n;
  while (
    tailStart > 0 &&
    (tailHorizontal
      ? (points[tailStart - 1] as Point).y === tailCrossVal
      : (points[tailStart - 1] as Point).x === tailCrossVal)
  ) {
    tailStart--;
  }

  // The two runs constrain different axes (the common case: one bend separates them, e.g. a
  // horizontal run into a vertical one) whenever leadHorizontal !== tailHorizontal - in that
  // case their index ranges legitimately touch or overlap at the shared corner point, and
  // aligning both is safe since each only ever writes its own axis. Only bail to the caller's
  // fallback bridge when they constrain the SAME axis and still overlap, meaning there's no
  // real bend between them at all (e.g. a dead-straight path) to anchor an alignment to.
  if (leadHorizontal === tailHorizontal && leadEnd > tailStart) return null;

  for (let i = 0; i < leadEnd; i++) {
    const p = points[i] as Point;
    if (leadHorizontal) p.y = stubOut.y;
    else p.x = stubOut.x;
  }
  for (let i = tailStart; i < n; i++) {
    const p = points[i] as Point;
    if (tailHorizontal) p.y = stubIn.y;
    else p.x = stubIn.x;
  }
  // The cross-axis now matches exactly, but the along-axis (how far the run travels before its
  // next turn) is still wherever the grid's rounding put it - snap the very first/last point to
  // the stub outright so the run terminates exactly there instead of a couple of leftover pixels
  // short/long of it (which would otherwise render as its own tiny extra segment).
  points[0] = { ...stubOut };
  points[n - 1] = { ...stubIn };
  return points;
}

/**
 * Connects the two stubs directly with at most one corner, ignoring the coarse A* grid
 * entirely - used both when no grid path exists at all, and when the grid path that was found
 * turned out to carry no real bend (see `alignRunsToStubs`), since in either case the exact
 * stub coordinates already say everything the route needs to.
 */
function directBridge(from: Point, to: Point, stubOut: Point, stubIn: Point): Point[] {
  const points: Point[] = [from, stubOut];
  if (stubOut.x !== stubIn.x && stubOut.y !== stubIn.y) {
    points.push({ x: stubIn.x, y: stubOut.y });
  }
  points.push(stubIn, to);
  return collapseColinear(points);
}

/**
 * Grid-based orthogonal A* route between two port anchors, routing around (not through)
 * other components and preferring not to run along `otherWires` (the polylines of wires already
 * drawn). Falls back to the simple one-corner route if no path is found (e.g. the grid is fully
 * boxed in) so a connection is never left unrendered.
 */
export function autoRouteAStar(
  from: PortAnchor,
  to: PortAnchor,
  components: Component[],
  excludeIds: Set<ComponentId>,
  stubStartLen: number | null = null,
  stubEndLen: number | null = null,
  otherWires: Point[][] = [],
): Point[] {
  const stubOut = stubPoint(from, to.pos, stubStartLen ?? WIRE_STUB);
  const stubIn = stubPoint(to, from.pos, stubEndLen ?? WIRE_STUB);

  const grid = buildGrid(components, excludeIds, stubOut, stubIn);
  markWires(grid, otherWires);
  const startCell = toCell(grid, stubOut);
  const goalCell = toCell(grid, stubIn);

  const gridPath = astar(grid, startCell, goalCell);
  if (!gridPath) return directBridge(from.pos, to.pos, stubOut, stubIn);

  const alignedPath = alignRunsToStubs(gridPath, stubOut, stubIn);
  if (!alignedPath) return directBridge(from.pos, to.pos, stubOut, stubIn);

  const firstGridPoint = alignedPath[0] as Point;
  const lastGridPoint = alignedPath[alignedPath.length - 1] as Point;
  const points: Point[] = [from.pos, stubOut];
  // Only needed as a fallback for the rare short-path case alignRunsToStubs declines to touch.
  if (stubOut.x !== firstGridPoint.x && stubOut.y !== firstGridPoint.y) {
    points.push({ x: firstGridPoint.x, y: stubOut.y });
  }
  points.push(...alignedPath);
  if (lastGridPoint.x !== stubIn.x && lastGridPoint.y !== stubIn.y) {
    points.push({ x: stubIn.x, y: lastGridPoint.y });
  }
  points.push(stubIn, to.pos);
  return collapseColinear(points);
}
