import { appState } from '../app/AppState';
import { addToSelection, clearSelection } from './selection';

/**
 * `connLayer` is a fixed-size box (the workspace's own on-screen size, before #viewport's
 * pan/zoom transform is applied to it) - once panned further than about one viewport's worth
 * from the origin, that box's own on-screen position drifts entirely outside the visible
 * .workspace area, even though the diagram *content* inside it (positioned in world coordinates,
 * with overflow: visible) still renders correctly wherever it's panned to. An "empty canvas"
 * mousedown past that point never actually lands on connLayer any more - it falls through to
 * workspaceEl itself - so both are accepted as valid places to start a marquee, not just
 * connLayer alone (which is all that's ever hit near the origin, where connLayer's box still
 * covers the full visible viewport).
 */
export function initMarquee(workspaceEl: HTMLElement, connLayer: SVGSVGElement): void {
  workspaceEl.addEventListener('mousedown', (e) => {
    if (e.target !== connLayer && e.target !== workspaceEl) return;
    if (e.button !== 0) return;
    // Alt + left is the viewport's own pan gesture (ui/viewport.ts) - without this the press
    // would start a marquee at the same time as the pan, leaving a rubber band stretching
    // across the screen while the view slides under it.
    if (e.altKey) return;

    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) clearSelection();

    const startX = e.clientX;
    const startY = e.clientY;

    const marqueeEl = document.createElement('div');
    marqueeEl.className = 'marquee';
    document.body.appendChild(marqueeEl);

    function updateRect(curX: number, curY: number): void {
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      marqueeEl.style.left = `${x}px`;
      marqueeEl.style.top = `${y}px`;
      marqueeEl.style.width = `${Math.abs(curX - startX)}px`;
      marqueeEl.style.height = `${Math.abs(curY - startY)}px`;
    }
    updateRect(startX, startY);

    function onMove(ev: MouseEvent): void {
      updateRect(ev.clientX, ev.clientY);
    }

    function onUp(ev: MouseEvent): void {
      const x1 = Math.min(startX, ev.clientX);
      const x2 = Math.max(startX, ev.clientX);
      const y1 = Math.min(startY, ev.clientY);
      const y2 = Math.max(startY, ev.clientY);

      for (const c of appState.components) {
        const r = c.el.getBoundingClientRect();
        const intersects = r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1;
        if (intersects) addToSelection(c.id);
      }

      marqueeEl.remove();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}
