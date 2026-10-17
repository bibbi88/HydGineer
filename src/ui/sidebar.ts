import { renderComponentIcon } from '../components/iconPreview';

/** Drag payload MIME type carrying a component type from a library tile to the canvas - read by
 * the workspace's drop handler set up in main.ts. */
export const COMPONENT_DRAG_MIME = 'application/x-pneugineer-component';

// dataTransfer.getData() only actually returns its payload on the 'drop' event itself - browsers
// withhold it during 'dragover'/'dragenter' (so a page can't snoop a cross-origin drag's contents
// before the user commits to dropping there). main.ts's dragover handler needs to know which
// component type is being dragged well before that, to preview whether it'd splice onto a wire -
// so the type is tracked here instead, in a plain module variable set/cleared alongside the same
// dragstart/dragend that already exists on each tile.
let draggedType: string | null = null;

export function getDraggedComponentType(): string | null {
  return draggedType;
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
const PARENT_OF: Record<string, string> = {
  'Mechanical/Manual': 'Directional valves',
  'Air operated': 'Directional valves',
  'Solenoid operated': 'Directional valves',
};

function createCategoryDetails(
  category: string,
  itemCount: number
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

export function renderComponentLibrary(container: HTMLElement, groups: SidebarGroupSpec[]): void {
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
      // canvas places it exactly where dropped - both go through the same onClick/spawn path,
      // just with the drop's world position substituted for the view-center one.
      tile.addEventListener('click', item.onClick);
      tile.draggable = true;
      tile.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(COMPONENT_DRAG_MIME, item.type);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
        tile.classList.add('dragging');
        draggedType = item.type;
      });
      tile.addEventListener('dragend', () => {
        tile.classList.remove('dragging');
        draggedType = null;
      });
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
