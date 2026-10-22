import { renderComponentIcon } from '../components/iconPreview';
import type { LibraryDragHandler } from '../interaction/libraryDrag';

/** How far, px, the pointer has to move with the button down before a press on a tile becomes
 * a drag rather than a click. */
const DRAG_THRESHOLD = 5;

/**
 * Lets `tile` be dragged out onto the canvas. A plain mouse drag rather than the browser's own
 * drag-and-drop: during a native drag the page gets no key presses and no other mouse buttons,
 * so the component couldn't be rotated (R, or a right-click) before it's dropped.
 */
function makeTileDraggable(tile: HTMLButtonElement, type: string, drag: LibraryDragHandler): void {
  let dragged = false;

  tile.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    dragged = false;

    function onMove(ev: MouseEvent): void {
      if (!dragged) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        dragged = true;
        tile.classList.add('dragging');
        drag.start(type);
      }
      drag.move(ev.clientX, ev.clientY);
    }

    function onUp(ev: MouseEvent): void {
      if (ev.button !== 0) return;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!dragged) return;
      tile.classList.remove('dragging');
      drag.drop(ev.clientX, ev.clientY);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // A drag released back over its own tile still fires a click there - that's not a click.
  tile.addEventListener(
    'click',
    (e) => {
      if (!dragged) return;
      dragged = false;
      e.stopImmediatePropagation();
    },
    true,
  );
}

export interface SidebarItemSpec {
  type: string;
  label: string;
  onClick: () => void;
}

export interface SidebarGroupSpec {
  category: string;
  items: SidebarItemSpec[];
}

/** Categories nested under a shared parent dropdown instead of sitting at the top level - the
 * directional valves are split by actuation, but all three are "the valves" when scanning. */
const PARENT_OF: Record<string, string> = {};

function createCategoryDetails(
  category: string,
  itemCount: number,
): { details: HTMLDetailsElement; count: HTMLSpanElement } {
  const details = document.createElement('details');
  // All categories start collapsed so the library stays scannable at a glance.
  details.className = 'libCategory';

  const summary = document.createElement('summary');
  const name = document.createElement('span');
  name.className = 'libCategoryName';
  name.textContent = category;
  const count = document.createElement('span');
  count.className = 'libCategoryCount';
  count.textContent = String(itemCount);
  summary.append(name, count);
  details.appendChild(summary);
  return { details, count };
}

export function renderComponentLibrary(
  container: HTMLElement,
  groups: SidebarGroupSpec[],
  drag?: LibraryDragHandler,
): void {
  const filterInput = document.createElement('input');
  filterInput.type = 'search';
  filterInput.className = 'libFilter';
  filterInput.placeholder = 'Filter components…';
  filterInput.setAttribute('aria-label', 'Filter components');
  container.appendChild(filterInput);

  const groupEntries: Array<{
    details: HTMLDetailsElement;
    tiles: Array<{ el: HTMLButtonElement; label: string }>;
  }> = [];

  const parentEntries = new Map<
    string,
    {
      details: HTMLDetailsElement;
      count: HTMLSpanElement;
      body: HTMLDivElement;
      itemCount: number;
      children: HTMLDetailsElement[];
    }
  >();

  for (const group of groups) {
    const { details } = createCategoryDetails(group.category, group.items.length);

    const grid = document.createElement('div');
    grid.className = group.items.length === 1 ? 'libGrid libGrid--single' : 'libGrid';

    const tiles: Array<{ el: HTMLButtonElement; label: string }> = [];
    for (const item of group.items) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'libTile';
      tile.id = `add-${item.type}`;
      tile.title = item.label;
      tile.appendChild(renderComponentIcon(item.type));

      const label = document.createElement('span');
      label.className = 'libTileLabel';
      label.textContent = item.label;
      tile.appendChild(label);

      // Click still places at the view center (fast, no aiming needed); dragging onto the
      // canvas places it exactly where dropped (see interaction/libraryDrag.ts).
      tile.addEventListener('click', item.onClick);
      if (drag) makeTileDraggable(tile, item.type, drag);
      grid.appendChild(tile);
      tiles.push({ el: tile, label: item.label });
    }

    details.appendChild(grid);
    groupEntries.push({ details, tiles });

    const parentName = PARENT_OF[group.category];
    if (!parentName) {
      container.appendChild(details);
      continue;
    }
    let parent = parentEntries.get(parentName);
    if (!parent) {
      const created = createCategoryDetails(parentName, 0);
      const body = document.createElement('div');
      body.className = 'libSubcategories';
      created.details.appendChild(body);
      container.appendChild(created.details);
      parent = {
        ...created,
        body,
        itemCount: 0,
        children: [],
      };
      parentEntries.set(parentName, parent);
    }
    details.classList.add('libCategory--sub');
    parent.body.appendChild(details);
    parent.children.push(details);
    parent.itemCount += group.items.length;
    parent.count.textContent = String(parent.itemCount);
  }

  filterInput.addEventListener('input', () => {
    const query = filterInput.value.trim().toLowerCase();
    for (const group of groupEntries) {
      let anyMatch = false;
      for (const tile of group.tiles) {
        const match = query === '' || tile.label.toLowerCase().includes(query);
        tile.el.hidden = !match;
        anyMatch = anyMatch || match;
      }
      group.details.hidden = !anyMatch;
      group.details.open = query !== '' && anyMatch;
    }
    for (const parent of parentEntries.values()) {
      const anyMatch = parent.children.some((child) => !child.hidden);
      parent.details.hidden = !anyMatch;
      parent.details.open = query !== '' && anyMatch;
    }
  });
}
