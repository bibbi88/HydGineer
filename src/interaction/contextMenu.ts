export interface ContextMenuItem {
  label: string;
  onClick: () => void;
}

let menuEl: HTMLDivElement | null = null;

function closeMenu(): void {
  menuEl?.remove();
  menuEl = null;
}

/** Room, px, kept between the menu and the window's edge. */
const EDGE = 4;

/** Moves `menu`, opened at (x, y), back inside the window: it opens to the left of the click
 * if there's no room on its right (a click in the inspector, at the window's right edge), and
 * upward if there's none below. */
function keepOnScreen(menu: HTMLElement, x: number, y: number): void {
  const { width, height } = menu.getBoundingClientRect();
  const maxX = window.innerWidth - EDGE;
  const maxY = window.innerHeight - EDGE;
  const left = x + width > maxX ? Math.max(EDGE, Math.min(x, maxX) - width) : x;
  const top = y + height > maxY ? Math.max(EDGE, Math.min(y, maxY) - height) : y;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function showContextMenu(clientX: number, clientY: number, items: ContextMenuItem[]): void {
  closeMenu();

  const menu = document.createElement('div');
  menu.className = 'ctxmenu';
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;

  for (const item of items) {
    const btn = document.createElement('button');
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      item.onClick();
      closeMenu();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  menuEl = menu;
  keepOnScreen(menu, clientX, clientY);

  setTimeout(() => {
    window.addEventListener(
      'click',
      (e) => {
        if (menuEl && !menuEl.contains(e.target as Node)) closeMenu();
      },
      { once: true },
    );
  }, 0);
}
