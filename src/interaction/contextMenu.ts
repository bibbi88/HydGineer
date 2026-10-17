export interface ContextMenuItem {
  label: string;
  onClick: () => void;
}

let menuEl: HTMLDivElement | null = null;

function closeMenu(): void {
  menuEl?.remove();
  menuEl = null;
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
