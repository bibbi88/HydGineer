import type { ViewportAdapter } from '../ui/viewport';
import { computeContentBounds, unionBounds } from '../geometry/contentBounds';
import { getPageFrameWorldBounds } from '../ui/pageFrame';
import { fitViewToWorldRect } from './fitViewToBounds';

/** Pans/zooms the viewport so the whole drawing fits inside the visible workspace, centered,
 * with a flat pixel margin around it.
 *
 * "The whole drawing" means every component's own bounds plus the page frame, when one is
 * switched on - the sheet is the thing being drawn on, and it's usually larger than the
 * circuit, so fitting only the components would leave most of it off-screen and make the button
 * look like it had done nothing. getPageFrameWorldBounds() is null while the frame is off,
 * which is exactly the "if enabled" condition.
 *
 * A no-op only when there's nothing at all to fit around: no components and no frame.
 */
export function zoomToFit(viewport: ViewportAdapter, workspaceEl: HTMLElement): void {
  const bounds = unionBounds(computeContentBounds(), getPageFrameWorldBounds());
  if (!bounds) return;
  fitViewToWorldRect(viewport, workspaceEl, bounds);
}
