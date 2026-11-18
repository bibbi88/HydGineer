/**
 * The toolbar's Save: one button, and a small ▾ beside it opening a menu with Save and Save as
 * (and Save all with several circuits open), and which file the circuit is saved to.
 *
 * Where the page can write back to a file the button reads "Save as" until the circuit has a
 * file, "Save" after that; where it can't (Firefox, Safari), every save is a download and it
 * always reads "Save".
 */
import { createIcon, type IconName } from './icons';

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

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function keyCaps(keys: string[]): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'saveMenuKeys';
  for (const k of keys) {
    const kbd = document.createElement('kbd');
    kbd.textContent = k === 'Ctrl' && isMac ? '⌘' : k;
    wrap.appendChild(kbd);
  }
  return wrap;
}

export function createSaveControl(deps: SaveControlDeps): SaveControl {
  const wrap = document.createElement('span');
  wrap.className = 'splitButton saveControl';

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'iconBtn iconBtn--labelled saveMainBtn';
  const mainLabel = document.createElement('span');
  mainLabel.className = 'iconBtnLabel';
  main.append(createIcon('save'), mainLabel);
  main.addEventListener('click', () => deps.save());

  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.className = 'iconBtn iconBtn--menuArrow';
  arrow.title = 'Save options';
  arrow.setAttribute('aria-label', 'Save options');
  arrow.setAttribute('aria-haspopup', 'true');
  arrow.setAttribute('aria-expanded', 'false');
  arrow.appendChild(createIcon('chevronDown'));
  wrap.append(main, arrow);

  let menu: HTMLElement | null = null;

  function refresh(): void {
    const writeBack = deps.canWriteBack();
    const file = deps.fileName();
    const label = writeBack && !file ? 'Save as' : 'Save';
    mainLabel.textContent = label;
    const tip = file
      ? `Save to ${file} (Ctrl+S) - the ▾ has Save as`
      : writeBack
        ? 'Save as - pick where; later saves go there (Ctrl+S)'
        : 'Save - download the file (Ctrl+S)';
    main.title = tip;
    main.setAttribute('aria-label', label);
  }

  function close(focusArrow = false): void {
    if (!menu) return;
    menu.remove();
    menu = null;
    arrow.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside, true);
    window.removeEventListener('resize', onResize);
    if (focusArrow) arrow.focus();
  }
  function onOutside(e: MouseEvent): void {
    if (menu && !menu.contains(e.target as Node) && !arrow.contains(e.target as Node)) close();
  }
  function onResize(): void {
    close();
  }

  function row(
    icon: IconName,
    title: string,
    hint: string,
    keys: string[] | null,
    run: () => void,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'saveMenuRow';
    b.setAttribute('role', 'menuitem');
    b.tabIndex = -1;
    const tile = document.createElement('span');
    tile.className = 'saveMenuTile';
    tile.appendChild(createIcon(icon));
    const text = document.createElement('span');
    text.className = 'saveMenuText';
    const t = document.createElement('b');
    t.textContent = title;
    const h = document.createElement('small');
    h.textContent = hint;
    text.append(t, h);
    b.append(tile, text);
    if (keys) b.appendChild(keyCaps(keys));
    b.addEventListener('click', () => {
      close();
      run();
    });
    return b;
  }

  function open(fromKeyboard: boolean): void {
    if (menu) return;
    const writeBack = deps.canWriteBack();
    const file = deps.fileName();
    const m = document.createElement('div');
    m.className = 'saveMenu';
    m.setAttribute('role', 'menu');
    m.setAttribute('aria-label', 'Save');
    m.addEventListener('mousedown', (e) => e.preventDefault());

    const saveHint = !writeBack
      ? 'Download the file'
      : file
        ? `Write the changes to ${file}`
        : 'Pick where, then later saves go there';
    const rows = [
      row('save', 'Save', saveHint, ['Ctrl', 'S'], () => deps.save()),
      row(
        'save',
        'Save as…',
        'A new file, in a new place or under a new name',
        ['Ctrl', 'Shift', 'S'],
        () => deps.saveAs(),
      ),
    ];
    const all = deps.saveAll();
    if (all) {
      rows.push(row('document', `Save all (${deps.docCount()})`, 'Every open circuit', null, all));
    }
    m.append(...rows);

    const foot = document.createElement('div');
    foot.className = 'saveMenuFoot';
    foot.appendChild(createIcon('document'));
    const footText = document.createElement('span');
    if (file) {
      const b = document.createElement('b');
      b.textContent = file;
      footText.append('Saved to ', b);
    } else footText.textContent = 'Not saved to a file yet';
    foot.appendChild(footText);
    m.appendChild(foot);

    m.addEventListener('keydown', (e) => {
      const i = rows.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = i < 0 ? 0 : (i + step + rows.length) % rows.length;
        rows[next]?.focus();
      } else if (e.key === 'Enter') {
        if (i >= 0) {
          e.preventDefault();
          rows[i]?.click();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Tab') close();
    });

    document.body.appendChild(m);
    const r = wrap.getBoundingClientRect();
    const width = m.offsetWidth || 330;
    m.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - width - 4))}px`;
    m.style.top = `${r.bottom + 4}px`;
    menu = m;
    arrow.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onOutside, true);
    window.addEventListener('resize', onResize);
    if (fromKeyboard) rows[0]?.focus();
  }

  arrow.addEventListener('mousedown', (e) => e.preventDefault());
  arrow.addEventListener('click', (e) => {
    if (menu) close();
    // A click from the keyboard (Enter/Space) has no pointer position.
    else open(e.detail === 0);
  });
  arrow.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !menu) {
      e.preventDefault();
      open(true);
    } else if (e.key === 'Escape' && menu) {
      e.preventDefault();
      close(true);
    }
  });

  refresh();
  return { el: wrap, refresh };
}
