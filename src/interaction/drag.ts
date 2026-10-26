import type { Component } from '../core/types';
import type { ViewportAdapter } from '../ui/viewport';
import { appState } from '../app/AppState';
import { canEdit } from '../app/modes';
import { snap } from '../core/grid';
import { getSelectedComponents, selectOnly, toggleSelection } from './selection';
import { redrawAllConnections } from '../wires/connection';
import { computePortSnapCorrection } from './portSnap';
import { rotateSelection } from './componentContextMenu';
import { startLinkingNear } from './linking';
import { hitBoundsOf } from '../components/shared/svgHelpers';

export function makeDraggable(comp: Component, viewport: ViewportAdapter): void {
  comp.el.classList.add('draggable');

  comp.el.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest('.port')) return;
    // A component that hosts its own editable text (e.g. a text annotation) needs plain clicks
    // inside it to place a text cursor, not start dragging the whole component.
    if ((e.target as Element).closest('[contenteditable="true"]')) return;

    // The component's div/svg spans a padded canvas well beyond its drawn body (room for pilot
    // stubs, labels, etc.), so without this a click in that empty margin - meant for a wire or
    // handle that happens to pass through it - would instead grab/select the component. Limiting
    // the click-to-drag area to the same tight box the selection outline already uses keeps that
    // margin free for whatever's actually there.
    // A press just beside one of the component's ports draws a wire from it (see linking.ts) -
    // only while editing, since during a run a press on a component operates it.
    if (canEdit(appState.mode) && !e.ctrlKey && !e.metaKey && startLinkingNear(comp, e)) return;

    // The box follows a valve's sliding frame (see ComponentShell.followFrame), so the valve
    // is grabbed where it's drawn.
    const world = viewport.clientToWorld(e.clientX, e.clientY);
    const b = hitBoundsOf(comp.el) ?? comp.getBounds();
    if (world.x < b.x || world.x > b.x + b.w || world.y < b.y || world.y > b.y + b.h) {
      // This component's own div still spans its full padded canvas (room for pilot stubs,
      // labels, a 5/2 valve's sliding travel, etc.) well beyond the tight box just checked, and -
      // being an ordinary HTML element - captures every click across that whole rectangle
      // regardless of how little of it is actually drawn on. A wire routed through that empty
      // margin would otherwise sit permanently unclickable underneath it.
      //
      // Briefly stepping out of the way and re-checking with elementFromPoint (rather than just
      // letting the browser's own mouseup/click go find a new target on its own) matters because
      // a native click event's target isn't simply "wherever mouseup lands" when it differs from
      // mousedown's target - it's constrained to their nearest common ancestor, which here would
      // be nowhere near the wire. Manually dispatching a fresh click directly at whatever's
      // actually underneath sidesteps that - the same forwarding trick wireSplitting.ts's own
      // hand-off (via linking.ts's onDrop) already relies on for a wire's hitEl.
      comp.el.style.pointerEvents = 'none';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      comp.el.style.pointerEvents = '';
      under
        ?.closest('.wireHit')
        ?.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: e.clientX, clientY: e.clientY }),
        );
      return;
    }

    // Ctrl/Cmd+click adds the component to the selection, or takes it back out, without
    // dragging anything. Only while editing: during a run Ctrl+click latches push buttons.
    if ((e.ctrlKey || e.metaKey) && canEdit(appState.mode)) {
      e.preventDefault();
      e.stopPropagation();
      toggleSelection(comp.id);
      return;
    }

    if (!appState.selectedComponents.has(comp.id)) {
      selectOnly(comp.id);
    }

    // Selecting (to inspect/tweak a component's live parameters, e.g. a flow control valve's
    // percentage, while a simulation is running) should work regardless of mode - only the drag
    // itself, an actual layout edit, stays restricted to STOP so a running simulation can't have
    // its components rearranged out from under it.
    if (!canEdit(appState.mode)) return;

    const dragging = getSelectedComponents();
    const startWorld = viewport.clientToWorld(e.clientX, e.clientY);
    const origins = new Map(dragging.map((c) => [c.id, { x: c.x, y: c.y }]));

    e.preventDefault();
    e.stopPropagation();

    function onMove(ev: MouseEvent): void {
      const world = viewport.clientToWorld(ev.clientX, ev.clientY);
      const dx = world.x - startWorld.x;
      const dy = world.y - startWorld.y;
      for (const c of dragging) {
        const origin = origins.get(c.id);
        if (!origin) continue;
        c.setPos(snap(origin.x + dx), snap(origin.y + dy));
      }

      // Port-to-port alignment only makes sense with a single, unambiguous "this is what I'm
      // aligning" component - with a multi-selection drag there's no single set of ports to
      // magnet-snap without the correction fighting the group's own relative layout.
      if (dragging.length === 1) {
        const correction = computePortSnapCorrection(comp, viewport);
        if (correction.dx !== 0 || correction.dy !== 0) {
          comp.setPos(comp.x + correction.dx, comp.y + correction.dy);
        }
      }

      redrawAllConnections();
    }

    // A right-click while dragging turns the dragged components a quarter (Shift: the other
    // way) instead of opening the context menu - so they can be turned on the way. The R key
    // does the same (see keyboard.ts).
    function onRightDown(ev: MouseEvent): void {
      if (ev.button !== 2) return;
      ev.preventDefault();
      ev.stopPropagation();
      window.addEventListener('contextmenu', swallowContextMenu, true);
      rotateSelection(ev.shiftKey ? -90 : 90);
    }
    // Browsers send the context menu event on the right button's press or on its release - the
    // latter possibly after the left one is let go - so it's swallowed once whenever it comes.
    function swallowContextMenu(ev: MouseEvent): void {
      ev.preventDefault();
      ev.stopPropagation();
      window.removeEventListener('contextmenu', swallowContextMenu, true);
    }

    function onUp(ev: MouseEvent): void {
      if (ev.button !== 0) return;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousedown', onRightDown, true);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousedown', onRightDown, true);
  });
}
