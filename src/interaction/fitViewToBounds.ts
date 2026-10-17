import type { ViewportAdapter } from '../ui/viewport';
import type { WorldBounds } from '../geometry/contentBounds';

const DEFAULT_PADDING_PX = 60;

/** The inverse of fitViewToWorldRect: the world-space rect currently visible inside
 * `workspaceEl`, given `viewport`'s current pan/zoom - what "export the current view" (see
 * ui/exportDialog.ts) crops an export to, letting a pan/zoom the user already did double as a
 * crop tool instead of needing a separate region-drag UI. */
export function computeVisibleWorldBounds(
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
): WorldBounds {
  const rect = workspaceEl.getBoundingClientRect();
  const topLeft = viewport.clientToWorld(rect.left, rect.top);
  const bottomRight = viewport.clientToWorld(rect.right, rect.bottom);
  return { minX: topLeft.x, minY: topLeft.y, maxX: bottomRight.x, maxY: bottomRight.y };
}

/** Pans/zooms `viewport` so a world-space rect is centered and fully visible in `workspaceEl`,
 * with a flat pixel margin around it - the shared math behind zoomToFit.ts (fits the diagram's
 * own content bounds) and ui/pageFrame.ts (fits the page frame itself, so picking a sheet size
 * doesn't leave most of it off-screen). setTransform itself clamps to the viewport's own
 * min/max zoom. */
export function fitViewToWorldRect(
  viewport: ViewportAdapter,
  workspaceEl: HTMLElement,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  paddingPx = DEFAULT_PADDING_PX,
): void {
  const wsRect = workspaceEl.getBoundingClientRect();
  const availW = Math.max(1, wsRect.width - paddingPx * 2);
  const availH = Math.max(1, wsRect.height - paddingPx * 2);
  const rectW = Math.max(1, rect.maxX - rect.minX);
  const rectH = Math.max(1, rect.maxY - rect.minY);
  const scale = Math.min(availW / rectW, availH / rectH);

  const worldCx = (rect.minX + rect.maxX) / 2;
  const worldCy = (rect.minY + rect.maxY) / 2;
  viewport.setTransform(
    scale,
    wsRect.width / 2 - worldCx * scale,
    wsRect.height / 2 - worldCy * scale,
  );

  // setTransform clamps the scale but keeps the pan offset it was handed, so a rect small
  // enough (or large enough) to want a scale past either zoom limit would end up centered for a
  // zoom level that was refused - visibly off to one side. Re-center on the scale that actually
  // landed. Fitting a single small component, which is exactly what "zoom to selection" does,
  // hits the maximum almost every time.
  const applied = viewport.getTransform().scale;
  if (applied !== scale) {
    viewport.setTransform(
      applied,
      wsRect.width / 2 - worldCx * applied,
      wsRect.height / 2 - worldCy * applied,
    );
  }
}
