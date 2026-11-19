/**
 * The toolbar's dropdown menus - the ▾ beside Save and beside Open: a panel under the button with
 * rows (an icon tile, a bold title, a one-line explanation, optionally key caps), section headings
 * and a footer. Opened by the arrow; ↑/↓ move between rows, Enter picks, Esc closes and gives the
 * focus back to the arrow; a click outside or a window resize closes it. Opened from the keyboard,
 * the first row gets the focus. ARIA: the arrow has aria-haspopup / aria-expanded, the panel is a
 * menu and the rows menu items.
 */
import { createIcon, type IconName } from './icons';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export interface MenuRowOptions {
  icon: IconName;
  title: string;
  hint?: string;
  keys?: string[];
  /** A plainer, tighter row - for long lists such as the examples. */
  compact?: boolean;
  run(): void;
}

export interface DropdownBuilder {
  row(opts: MenuRowOptions): HTMLButtonElement;
  heading(text: string): HTMLElement;
  /** A footer under a thin rule, `content` beside a file icon. */
  footer(content: Array<Node | string>): HTMLElement;
  /** A muted line of text (e.g. "No recent files"). */
  note(text: string): HTMLElement;
}

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

/** Wires `arrow` to open a menu under `anchor`, its contents made by `build` each time. */
export function attachDropdown(
  anchor: HTMLElement,
  arrow: HTMLButtonElement,
  label: string,
  build: (b: DropdownBuilder) => Array<Node>,
): { close(): void } {
  arrow.setAttribute('aria-haspopup', 'true');
  arrow.setAttribute('aria-expanded', 'false');
  let menu: HTMLElement | null = null;

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

  const builder: DropdownBuilder = {
    row({ icon, title, hint, keys, compact, run }) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = compact ? 'saveMenuRow saveMenuRow--compact' : 'saveMenuRow';
      b.setAttribute('role', 'menuitem');
      b.tabIndex = -1;
      const tile = document.createElement('span');
      tile.className = 'saveMenuTile';
      tile.appendChild(createIcon(icon));
      const text = document.createElement('span');
      text.className = 'saveMenuText';
      const t = document.createElement('b');
      t.textContent = title;
      text.appendChild(t);
      if (hint) {
        const h = document.createElement('small');
        h.textContent = hint;
        text.appendChild(h);
      }
      b.append(tile, text);
      if (keys) b.appendChild(keyCaps(keys));
      b.addEventListener('click', () => {
        close();
        run();
      });
      return b;
    },
    heading(text) {
      const h = document.createElement('div');
      h.className = 'menuHeading';
      h.setAttribute('role', 'presentation');
      h.textContent = text;
      return h;
    },
    footer(content) {
      const foot = document.createElement('div');
      foot.className = 'saveMenuFoot';
      foot.appendChild(createIcon('document'));
      const span = document.createElement('span');
      span.append(...content);
      foot.appendChild(span);
      return foot;
    },
    note(text) {
      const n = document.createElement('div');
      n.className = 'menuNote';
      n.textContent = text;
      return n;
    },
  };

  function open(fromKeyboard: boolean): void {
    if (menu) return;
    const m = document.createElement('div');
    m.className = 'saveMenu';
    m.setAttribute('role', 'menu');
    m.setAttribute('aria-label', label);
    m.addEventListener('mousedown', (e) => e.preventDefault());
    m.append(...build(builder));
    const rows = (): HTMLElement[] => [...m.querySelectorAll<HTMLElement>('[role="menuitem"]')];

    m.addEventListener('keydown', (e) => {
      const list = rows();
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = i < 0 ? 0 : (i + step + list.length) % list.length;
        list[next]?.focus();
      } else if (e.key === 'Enter') {
        if (i >= 0) {
          e.preventDefault();
          list[i]?.click();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Tab') close();
    });

    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const width = m.offsetWidth || 330;
    m.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - width - 4))}px`;
    m.style.top = `${r.bottom + 4}px`;
    menu = m;
    arrow.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onOutside, true);
    window.addEventListener('resize', onResize);
    if (fromKeyboard) rows()[0]?.focus();
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
  return { close: () => close() };
}

/** The narrow ▾ button beside a toolbar button. */
export function menuArrowButton(label: string): HTMLButtonElement {
  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.className = 'iconBtn iconBtn--menuArrow';
  arrow.title = label;
  arrow.setAttribute('aria-label', label);
  arrow.appendChild(createIcon('chevronDown'));
  return arrow;
}
