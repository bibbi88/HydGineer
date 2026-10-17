import { saveProjectToFile } from '../persistence/save';
import { loadProjectFromPicker } from '../persistence/load';
import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from './viewport';
import { resetHistory } from '../history/historyStore';
import { openExportDialog } from './exportDialog';
import { iconButton } from './iconButton';

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

  container.append(nameInput, saveBtn, loadBtn, exportBtn);

  return {
    getName: () => nameInput.value || 'project',
    setName: (name: string) => {
      nameInput.value = name;
    },
  };
}
