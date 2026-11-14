import type { Component, Connection, ConnectionEndpoint, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createPort, createSvgEl } from './shared/svgHelpers';

export const JUNCTION_TYPE = 'junction';

export interface JunctionGeometry {
  svgW: number;
  svgH: number;
  dotRadius: number;
}

export const JUNCTION_DEFAULT_GEOMETRY: JunctionGeometry = {
  svgW: 14,
  svgH: 14,
  dotRadius: 4,
};

/** The wire a junction sits on when it joins a branch onto it without cutting it in two - a
 * "tap" (see wires/taps.ts) - named by that wire's two ends, so it survives save and load. */
export interface JunctionHost {
  from: ConnectionEndpoint;
  to: ConnectionEndpoint;
}

function isEndpoint(v: unknown): v is ConnectionEndpoint {
  const e = v as ConnectionEndpoint | null;
  return !!e && typeof e.id === 'number' && typeof e.port === 'string';
}

export function readJunctionHost(data: Record<string, unknown>): JunctionHost | null {
  const h = data.host as { from?: unknown; to?: unknown } | null | undefined;
  return h && isEndpoint(h.from) && isEndpoint(h.to) ? { from: h.from, to: h.to } : null;
}

const sameEnd = (a: ConnectionEndpoint, b: ConnectionEndpoint): boolean =>
  a.id === b.id && a.port === b.port;

/** Whether `conn` is the wire `host` names (either way round). */
export function isHostWire(host: JunctionHost, conn: Connection): boolean {
  return (
    (sameEnd(host.from, conn.from) && sameEnd(host.to, conn.to)) ||
    (sameEnd(host.from, conn.to) && sameEnd(host.to, conn.from))
  );
}

/** `host` with its component ids mapped through `idMap` (a load or a paste gives every
 * component a new id) - null if either end isn't among them. */
export function remapJunctionHost(
  host: JunctionHost,
  idMap: Map<number, number>,
): JunctionHost | null {
  const from = idMap.get(host.from.id);
  const to = idMap.get(host.to.id);
  if (from === undefined || to === undefined) return null;
  return { from: { id: from, port: host.from.port }, to: { id: to, port: host.to.port } };
}

export function drawJunctionBody(g: SVGElement, geo: JunctionGeometry): { cx: number; cy: number } {
  const cx = geo.svgW / 2;
  const cy = geo.svgH / 2;
  g.appendChild(createSvgEl('circle', { cx, cy, r: geo.dotRadius, fill: '#111' }));
  return { cx, cy };
}

export function createJunction(
  compLayer: HTMLElement,
  x: number,
  y: number,
  entryOrientation: 'H' | 'V' = 'H',
): Component {
  const geo = JUNCTION_DEFAULT_GEOMETRY;
  const shell = buildComponentShell(compLayer, JUNCTION_TYPE, x, y, geo.svgW, geo.svgH, '');
  const { cx, cy } = drawJunctionBody(shell.svg, geo);

  const ports = {
    P: createPort(shell.svg, 'P', cx, cy, entryOrientation, { radius: geo.dotRadius }),
  };
  let host: JunctionHost | null = null;

  const comp: Component = {
    id: uid(),
    type: JUNCTION_TYPE,
    el: shell.el,
    x,
    y,
    svgW: geo.svgW,
    svgH: geo.svgH,
    gx: 0,
    gy: 0,
    ports,

    conductivityRule(): PortConnection[] {
      return [];
    },

    // The axis a new branch leaves along (see wireSplitting.ts: across the line the junction
    // was placed on), saved so it survives a reload. Older saves have none and keep 'H'.
    snapshot(): Record<string, unknown> {
      return { orientation: ports.P.entryOrientation, host };
    },
    restore(data: Record<string, unknown>): void {
      if (data.orientation === 'H' || data.orientation === 'V') {
        ports.P.entryOrientation = data.orientation;
      }
      host = readJunctionHost(data);
    },
    reset(): void {},

    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
  };

  return comp;
}
