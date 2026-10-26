import type { Component, ComponentId, PortKey } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { createConnection } from '../wires/connection';
import { JUNCTION_TYPE } from '../components/junction';
import { createSvgEl } from '../components/shared/svgHelpers';
import { pathFromPoints, stubPoint } from '../geometry/routing';
import { worldPortAnchor } from '../geometry/connectionGeometry';
import { PORT_GRAB_RADIUS, PORT_SNAP_RADIUS, WIRE_STUB } from '../sim/constants';

export interface PendingPort {
  compId: ComponentId;
  port: PortKey;
}

let pendingPort: PendingPort | null = null;
let previewPath: SVGPathElement | null = null;
let hoveredPortEl: SVGCircleElement | null = null;
let viewportRef: ViewportAdapter | null = null;
let workspaceRef: HTMLElement | null = null;

export function initLinking(
  connLayer: SVGSVGElement,
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): void {
  viewportRef = viewport;
  workspaceRef = workspaceEl;
  previewPath = createSvgEl('path', { class: 'wireGhost', fill: 'none' });
  connLayer.appendChild(previewPath);

  workspaceEl.addEventListener('mousemove', (e) => {
    updateHover(e.clientX, e.clientY);
    updatePreview(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', (e) => onDrop(e.clientX, e.clientY));
}

function portWorldPos(comp: Component, portKey: PortKey): { x: number; y: number } {
  const port = comp.ports[portKey];
  const viewport = viewportRef;
  if (!port || !viewport) return { x: 0, y: 0 };
  const rect = port.el.getBoundingClientRect();
  return viewport.clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

/** The port nearest the pointer within `radius` screen px - when a wire is being drawn, only
 * one it could actually be connected to (not its own starting port, nor a terminal of the other
 * domain). `only` limits the search to one component. */
function nearestPort(
  clientX: number,
  clientY: number,
  radius: number,
  only?: Component,
): { comp: Component; port: PortKey; el: SVGCircleElement } | null {
  let best: { comp: Component; port: PortKey; el: SVGCircleElement } | null = null;
  let bestDist = radius;
  for (const c of only ? [only] : appState.components) {
    for (const port of Object.values(c.ports)) {
      if (pendingPort) {
        if (pendingPort.compId === c.id && pendingPort.port === port.key) continue;
        if (!portDomainsCompatible(pendingPort.compId, pendingPort.port, c.id, port.key)) continue;
      }
      const rect = port.el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(clientX - cx, clientY - cy);
      if (dist <= bestDist) {
        bestDist = dist;
        best = { comp: c, port: port.key, el: port.el as SVGCircleElement };
      }
    }
  }
  return best;
}

function updateHover(clientX: number, clientY: number): void {
  const nearest = nearestPort(clientX, clientY, PORT_SNAP_RADIUS)?.el ?? null;

  if (hoveredPortEl && hoveredPortEl !== nearest) {
    hoveredPortEl.classList.remove('portHover');
  }
  nearest?.classList.add('portHover');
  hoveredPortEl = nearest;
}

/** Electrical terminals only wire to electrical terminals (and pneumatic to pneumatic) - a
 * junction is domain-neutral, so either kind can run into one. */
function portDomainsCompatible(aId: number, aPort: string, bId: number, bPort: string): boolean {
  const a = appState.findComponent(aId);
  const b = appState.findComponent(bId);
  if (!a || !b || a.type === JUNCTION_TYPE || b.type === JUNCTION_TYPE) return true;
  return (a.ports[aPort]?.electrical ?? false) === (b.ports[bPort]?.electrical ?? false);
}

function updatePreview(clientX: number, clientY: number): void {
  if (!previewPath) return;
  if (!pendingPort || !viewportRef) {
    previewPath.setAttribute('d', '');
    return;
  }
  const comp = appState.findComponent(pendingPort.compId);
  if (!comp) return;
  const to = viewportRef.clientToWorld(clientX, clientY);
  const anchor = workspaceRef
    ? worldPortAnchor(viewportRef, workspaceRef, comp, pendingPort.port)
    : null;
  if (!anchor) {
    previewPath.setAttribute('d', pathFromPoints([portWorldPos(comp, pendingPort.port), to]));
    return;
  }
  // Same start the finished wire will have - a short stub out of the port - then one right
  // angle to the pointer, rather than a diagonal straight line.
  const stub = stubPoint(anchor, to, WIRE_STUB);
  const corner = anchor.entryOrientation === 'V' ? { x: stub.x, y: to.y } : { x: to.x, y: stub.y };
  previewPath.setAttribute('d', pathFromPoints([anchor.pos, stub, corner, to]));
}

/**
 * Resolves a press-drag-release: a port it can connect to within snap reach of the pointer
 * (the one lit up) completes the connection - the pointer needn't be right on the port circle;
 * otherwise a wire under the pointer hands off to the splice-into-a-junction handler
 * (wireSplitting.ts, registered via setWireClickInterceptor on the wire itself), and anything
 * else (including releasing back over the starting port) just cancels.
 */
function onDrop(clientX: number, clientY: number): void {
  if (!pendingPort) return;
  const from = pendingPort;

  const target = nearestPort(clientX, clientY, PORT_SNAP_RADIUS);
  if (target) {
    createConnection(
      { id: from.compId, port: from.port },
      { id: target.comp.id, port: target.port },
    );
    cancelLinking();
    return;
  }

  const targetEl = document.elementFromPoint(clientX, clientY);
  if (targetEl?.closest('.port')) {
    cancelLinking();
    return;
  }

  // wireSplitting.ts's interceptor reads the still-in-flight pendingPort via getPendingPort(),
  // so it must run before cancelLinking() clears it below - dispatching a synthetic click here
  // (rather than importing and calling that module directly) keeps this module decoupled from
  // it, matching how the interceptor was already wired into the wire's own click handling.
  const hitEl = targetEl?.closest('.wireHit');
  hitEl?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));

  cancelLinking();
}

export function isLinking(): boolean {
  return pendingPort !== null;
}

/** The port a drag-to-link gesture started from, while it's still in flight - null once the
 * gesture ends (dropped or cancelled). Used by wireSplitting.ts to complete the link when the
 * gesture is released onto a wire instead of a port. */
export function getPendingPort(): PendingPort | null {
  return pendingPort;
}

export function cancelLinking(): void {
  pendingPort = null;
  previewPath?.setAttribute('d', '');
}

/**
 * Starts a wire from whichever of `comp`'s ports is within grab reach of the pointer, if any -
 * so a press just beside a port, not only right on its small circle, draws a wire from it.
 * Returns whether it did (the caller then leaves the press alone).
 */
export function startLinkingNear(comp: Component, e: MouseEvent): boolean {
  if (pendingPort) return false;
  const near = nearestPort(e.clientX, e.clientY, PORT_GRAB_RADIUS, comp);
  if (!near) return false;
  e.stopPropagation();
  e.preventDefault();
  pendingPort = { compId: comp.id, port: near.port };
  updateHover(e.clientX, e.clientY);
  updatePreview(e.clientX, e.clientY);
  return true;
}

export function wireUpPortLinking(comp: Component): void {
  for (const port of Object.values(comp.ports)) {
    port.el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      pendingPort = { compId: comp.id, port: port.key };
      updateHover(e.clientX, e.clientY);
      updatePreview(e.clientX, e.clientY);
    });
  }
}
