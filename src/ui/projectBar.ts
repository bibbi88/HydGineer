import { saveProjectToFile } from '../persistence/save';
import { loadProjectFromPicker } from '../persistence/load';
import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from './viewport';
import { resetHistory } from '../history/historyStore';
import { openExportDialog } from './exportDialog';
import { iconButton } from './iconButton';
import { EXAMPLES } from '../persistence/examples';
import { loadProject } from '../persistence/project';
import { zoomToFit } from '../interaction/zoomToFit';
import { appState } from '../app/AppState';
import { canEdit } from '../app/modes';

/** World px kept free right of an example's drawing for its readouts (see zoomToFit). */
const EXAMPLE_READOUT_ROOM = 130;

export interface ProjectBarRefs {
  getName(): string;
  setName(name: string): void;
}

/** The toolbar's project section: the project name, then save, load and export. The name field
 * is the canonical copy - the inspector's own "Project name" row and the page frame's title
 * block both read and write it through the refs returned here, rather than keeping their own. */
export function renderProjectBar(
  container: HTMLElement,
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
  connLayer: SVGSVGElement,
  frameLayer: SVGSVGElement,
  workspaceEl: HTMLElement,
): ProjectBarRefs {
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = 'project';
  nameInput.className = 'projectName';
  nameInput.title = 'Project name';
  nameInput.setAttribute('aria-label', 'Project name');

  const saveBtn = iconButton(
    'save',
    'Save project',
    () => void saveProjectToFile(nameInput.value || 'project'),
  );

  const loadBtn = iconButton('folderOpen', 'Load project', () => {
    // Reset history only once a file was actually picked - loadProjectFromPicker itself
    // does the clear+rebuild, so this must run right before that, not before the picker
    // even opens (a cancelled picker shouldn't wipe undo history for nothing).
    void loadProjectFromPicker(ctx, viewport, resetHistory).then((loadedName) => {
      if (loadedName) nameInput.value = loadedName;
    });
  });

  const exportBtn = iconButton('download', 'Export image…', () => {
    openExportDialog(nameInput.value || 'project', connLayer, frameLayer, viewport, workspaceEl);
  });

  // Ready-made circuits to start from - replaces whatever is on the canvas (Undo brings it
  // back; no confirm() dialog, which embedded viewers suppress).
  const examples = document.createElement('select');
  examples.className = 'exampleSelect';
  examples.title = 'Load an example circuit';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Examples…';
  examples.appendChild(placeholder);
  EXAMPLES.forEach((ex, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = ex.title;
    examples.appendChild(o);
  });
  examples.addEventListener('change', () => {
    const ex = EXAMPLES[Number(examples.value)];
    examples.value = '';
    if (!ex || !canEdit(appState.mode)) return;
    const file = ex.file();
    loadProject(file, ctx, viewport);
    nameInput.value = file.name;
    appState.markDirty();
    // Room on the right for the simulation readouts beside the right-most components.
    requestAnimationFrame(() => zoomToFit(viewport, workspaceEl, EXAMPLE_READOUT_ROOM));
  });

  container.append(nameInput, saveBtn, loadBtn, exportBtn, examples);

  return {
    getName: () => nameInput.value || 'project',
    setName: (name: string) => {
      nameInput.value = name;
    },
  };
}
