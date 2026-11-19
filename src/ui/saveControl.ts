/**
 * The toolbar's Save: one button, and a small ▾ beside it opening a menu with Save and Save as
 * (and Save all with several circuits open), and which file the circuit is saved to.
 *
 * Where the page can write back to a file the button reads "Save as" until the circuit has a
 * file, "Save" after that; where it can't (Firefox, Safari), every save is a download and it
 * always reads "Save".
 */
import { iconButton, setIconButtonLabel } from './iconButton';
import { attachDropdown, menuArrowButton } from './dropdownMenu';

export interface SaveControlDeps {
  save(): void;
  saveAs(): void;
  /** Save all, offered while more than one circuit is open; null hides it. */
  saveAll(): (() => void) | null;
  /** How many circuits are open, for Save all's label. */
  docCount(): number;
  canWriteBack(): boolean;
  /** The active circuit's file name, or null if it has none yet. */
  fileName(): string | null;
}

export interface SaveControl {
  el: HTMLElement;
  /** Re-reads the state: call when the file handles or the active circuit change. */
  refresh(): void;
}

export function createSaveControl(deps: SaveControlDeps): SaveControl {
  const wrap = document.createElement('span');
  wrap.className = 'splitButton saveControl';

  const main = iconButton('save', 'Save', () => deps.save());
  main.classList.add('saveMainBtn');
  const arrow = menuArrowButton('Save options');
  wrap.append(main, arrow);

  function refresh(): void {
    const writeBack = deps.canWriteBack();
    const file = deps.fileName();
    const label = writeBack && !file ? 'Save as' : 'Save';
    const tip = file
      ? `Save to ${file} (Ctrl+S) - the ▾ has Save as`
      : writeBack
        ? 'Save as - pick where; later saves go there (Ctrl+S)'
        : 'Save - download the file (Ctrl+S)';
    setIconButtonLabel(main, tip, label);
    main.setAttribute('aria-label', label);
  }

  attachDropdown(wrap, arrow, 'Save', (b) => {
    const writeBack = deps.canWriteBack();
    const file = deps.fileName();
    const saveHint = !writeBack
      ? 'Download the file'
      : file
        ? `Write the changes to ${file}`
        : 'Pick where, then later saves go there';
    const nodes: Node[] = [
      b.row({ icon: 'save', title: 'Save', hint: saveHint, keys: ['Ctrl', 'S'], run: deps.save }),
      b.row({
        icon: 'save',
        title: 'Save as…',
        hint: 'A new file, in a new place or under a new name',
        keys: ['Ctrl', 'Shift', 'S'],
        run: deps.saveAs,
      }),
    ];
    const all = deps.saveAll();
    if (all) {
      nodes.push(
        b.row({
          icon: 'document',
          title: `Save all (${deps.docCount()})`,
          hint: 'Every open circuit',
          run: all,
        }),
      );
    }
    if (file) {
      const name = document.createElement('b');
      name.textContent = file;
      nodes.push(b.footer(['Saved to ', name]));
    } else nodes.push(b.footer(['Not saved to a file yet']));
    return nodes;
  });

  refresh();
  return { el: wrap, refresh };
}
