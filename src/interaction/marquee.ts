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
/** A component's drawn symbol on screen - its selection outline's box, which follows its
 * rotation and a switching valve's sliding frame - or its whole element if it has none. */
function drawnBox(el: HTMLElement): DOMRect {
  const box = el.querySelector<HTMLElement>(':scope > .boundsBox')?.getBoundingClientRect();
  return box && (box.width > 0 || box.height > 0) ? box : el.getBoundingClientRect();
}

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
      marqueeEl.classList.toggle('marqueeCrossing', ev.clientX < startX);
    }

    function onUp(ev: MouseEvent): void {
      const x1 = Math.min(startX, ev.clientX);
      const x2 = Math.max(startX, ev.clientX);
      const y1 = Math.min(startY, ev.clientY);
      const y2 = Math.max(startY, ev.clientY);

      // Dragged left to right: only what lies wholly inside the box. Right to left: whatever it
      // touches - as in CAD programs. Either way measured on the drawn symbol, not the room
      // round it for port labels and pilot lines, so a box round a junction next to a valve
      // doesn't take the valve too.
      const crossing = ev.clientX < startX;
      for (const c of appState.components) {
        const r = drawnBox(c.el);
        const hit = crossing
          ? r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1
          : r.left >= x1 && r.right <= x2 && r.top >= y1 && r.bottom <= y2;
        if (hit) addToSelection(c.id);
      }

      marqueeEl.remove();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}
