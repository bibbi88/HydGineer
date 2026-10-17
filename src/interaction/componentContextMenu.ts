import type { Component } from '../core/types';
import { appState } from '../app/AppState';
import { canEdit } from '../app/modes';
import { showContextMenu } from './contextMenu';
import { redrawAllConnections, removeComponentAndConnections } from '../wires/connection';
import { selectOnly, getSelectedComponents } from './selection';
import { copySelection } from './clipboard';
import { CYLINDER_SINGLE_TYPE } from '../components/cylinderSingle';
import { CYLINDER_DOUBLE_TYPE } from '../components/cylinderDouble';

export function getComponentRotation(comp: Component): number {
  return Number(comp.el.dataset.rot ?? '0');
}

/** Sets `comp`'s rotation to an absolute angle (normalized to [0, 360)) - the one place that
 * actually writes `dataset.rot` and the CSS transform together, so a project reload (see
 * persistence/project.ts) can restore it the same way a right-click rotate sets it. */
export function setComponentRotation(comp: Component, deg: number): void {
  const next = ((deg % 360) + 360) % 360;
  comp.el.dataset.rot = String(next);
  comp.el.style.transform = `translate(-50%, -50%) rotate(${next}deg)`;
}

export function isComponentMirrored(comp: Component): boolean {
  return comp.el.dataset.mirror === '1';
}

/** Flips the component's artwork left-right (about its own center), independent of rotation.
 * Applied to the inner svg rather than `comp.el` so the name label and other HTML children stay
 * readable; port positions follow automatically since wires measure them from the live DOM. */
export function setComponentMirrored(comp: Component, mirrored: boolean): void {
  const svg = comp.el.querySelector<SVGSVGElement>('svg.compSvg');
  if (!svg) return;
  if (mirrored) comp.el.dataset.mirror = '1';
  else delete comp.el.dataset.mirror;
  svg.style.transform = mirrored ? 'scaleX(-1)' : '';
}

/** Mirroring flips the whole component svg, port labels and all, so it's offered only for the
 * artwork that reads correctly reversed - the cylinders, whose own name label is HTML outside
 * that svg. On a valve it would leave every port number printed backwards, so the toolbar's
 * flip button (see ui/arrangeControls.ts) disables itself on the same basis this menu hides
 * the entry. */
const MIRRORABLE_TYPES = new Set<string>([CYLINDER_SINGLE_TYPE, CYLINDER_DOUBLE_TYPE]);

export function isMirrorableType(type: string): boolean {
  return MIRRORABLE_TYPES.has(type);
}

function rotateComponent(comp: Component, deltaDeg: number): void {
  setComponentRotation(comp, getComponentRotation(comp) + deltaDeg);
}

export function wireUpComponentContextMenu(comp: Component): void {
  comp.el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canEdit(appState.mode)) return;

    // Right-clicking a component that's already part of a larger selection (e.g. from a
    // marquee) keeps that whole selection, so "Copy" below copies the group - only right-
    // clicking something outside the current selection narrows it to just that one.
    if (!appState.selectedComponents.has(comp.id)) selectOnly(comp.id);
    const selectionSize = getSelectedComponents().length;

    showContextMenu(e.clientX, e.clientY, [
      { label: 'Rotate ↻ Clockwise', onClick: () => rotateComponent(comp, 90) },
      { label: 'Rotate ↺ Counter-clockwise', onClick: () => rotateComponent(comp, -90) },
      ...(MIRRORABLE_TYPES.has(comp.type)
        ? [
            {
              label: 'Mirror ⇋',
              onClick: () => {
                setComponentMirrored(comp, !isComponentMirrored(comp));
                redrawAllConnections();
                appState.markDirty();
              },
            },
          ]
        : []),
      {
        label: selectionSize > 1 ? `Copy (${selectionSize})` : 'Copy',
        onClick: () => copySelection(),
      },
      ...(comp.contextMenuItems?.() ?? []),
      {
        label: selectionSize > 1 ? `Delete (${selectionSize})` : 'Delete',
        onClick: () => {
          for (const c of getSelectedComponents()) removeComponentAndConnections(c.id);
          redrawAllConnections();
        },
      },
    ]);
  });
}
