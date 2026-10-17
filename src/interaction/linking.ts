import type { Component, ComponentId, PortKey } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { createConnection } from '../wires/connection';
import { JUNCTION_TYPE } from '../components/junction';
import { createSvgEl } from '../components/shared/svgHelpers';
import { pathFromPoints, stubPoint } from '../geometry/routing';
import { worldPortAnchor } from '../geometry/connectionGeometry';
import { PORT_HOVER_RADIUS, WIRE_STUB } from '../sim/constants';

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

function findPortOwner(el: Element): PendingPort | null {
  for (const comp of appState.components) {
    for (const port of Object.values(comp.ports)) {
      if (port.el === el) return { compId: comp.id, port: port.key };
    }
  }
  return null;
}

function updateHover(clientX: number, clientY: number): void {
  let nearest: SVGCircleElement | null = null;
  let nearestDist = PORT_HOVER_RADIUS;

  for (const c of appState.components) {
    for (const port of Object.values(c.ports)) {
      const rect = port.el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(clientX - cx, clientY - cy);
      if (dist <= nearestDist) {
        nearestDist = dist;
        nearest = port.el;
      }
    }
  }

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
 * Resolves a press-drag-release: whatever's under the pointer at release decides the outcome -
 * a different port completes the connection, a wire hands off to the splice-into-a-junction
 * handler (wireSplitting.ts, registered via setWireClickInterceptor on the wire itself), and
 * anything else (including releasing back over the starting port) just cancels.
 */
function onDrop(clientX: number, clientY: number): void {
  if (!pendingPort) return;
  const from = pendingPort;

  const targetEl = document.elementFromPoint(clientX, clientY);
  const portEl = targetEl?.closest('.port');
  if (portEl) {
    const owner = findPortOwner(portEl);
    if (
      owner &&
      (owner.compId !== from.compId || owner.port !== from.port) &&
      portDomainsCompatible(from.compId, from.port, owner.compId, owner.port)
    ) {
      createConnection(
        { id: from.compId, port: from.port },
        { id: owner.compId, port: owner.port },
      );
    }
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
