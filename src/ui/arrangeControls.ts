import { appState } from '../app/AppState';
import { canEdit } from '../app/modes';
import { getSelectedComponents, onSelectionChange } from '../interaction/selection';
import {
  getComponentRotation,
  setComponentRotation,
  isComponentMirrored,
  setComponentMirrored,
  isMirrorableType,
} from '../interaction/componentContextMenu';
import { redrawAllConnections } from '../wires/connection';
import { iconButton } from './iconButton';

/** Rotates every selected component by `deltaDeg` about its own center - the same operation the
 * right-click menu performs, applied to the whole selection at once. */
function rotateSelection(deltaDeg: number): void {
  const selected = getSelectedComponents();
  if (selected.length === 0) return;
  for (const comp of selected) {
    setComponentRotation(comp, getComponentRotation(comp) + deltaDeg);
  }
  redrawAllConnections();
  appState.markDirty();
}

/** Flips every selected component horizontally. Each one is toggled independently, so a mixed
 * selection ends up all-flipped rather than some flipping back. */
function flipSelection(): void {
  const selected = getSelectedComponents().filter((c) => isMirrorableType(c.type));
  if (selected.length === 0) return;
  const anyUnmirrored = selected.some((c) => !isComponentMirrored(c));
  for (const comp of selected) setComponentMirrored(comp, anyUnmirrored);
  redrawAllConnections();
  appState.markDirty();
}

/** The toolbar's arrange section: rotate the selection either way, and flip it horizontally.
 * Every button here edits the diagram, so all three are disabled while the simulation is
 * running (canEdit) and while nothing is selected. Flip additionally needs a selection whose
 * artwork survives being mirrored - see isMirrorableType. */
export function renderArrangeControls(container: HTMLElement): void {
  const rotateCcwBtn = iconButton('rotateCcw', 'Rotate counter-clockwise', () =>
    rotateSelection(-90),
  );
  const rotateCwBtn = iconButton('rotateCw', 'Rotate clockwise', () => rotateSelection(90));
  const flipBtn = iconButton('flipHorizontal', 'Flip horizontally', flipSelection);

  function refresh(): void {
    const selected = getSelectedComponents();
    const editable = canEdit(appState.mode) && selected.length > 0;
    rotateCcwBtn.disabled = !editable;
    rotateCwBtn.disabled = !editable;

    const mirrorable = selected.filter((c) => isMirrorableType(c.type));
    flipBtn.disabled = !editable || mirrorable.length === 0;
    flipBtn.title = flipBtn.disabled
      ? 'Flip horizontally (cylinders only - other symbols would print their port labels backwards)'
      : 'Flip horizontally';
  }
  onSelectionChange(refresh);
  appState.onModeChange(refresh);
  refresh();

  container.append(rotateCcwBtn, rotateCwBtn, flipBtn);
}
