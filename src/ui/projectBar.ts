import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from './viewport';
import { openExportDialog } from './exportDialog';
import { openExportManyDialog } from './exportManyDialog';
import { iconButton } from './iconButton';
import { EXAMPLES } from '../persistence/examples';
import { loadProject } from '../persistence/project';
import { zoomToFit } from '../interaction/zoomToFit';
import { appState } from '../app/AppState';
import { canEdit } from '../app/modes';
import {
  activeDocumentId,
  activeNameChanged,
  isDocumentEmpty,
  listDocuments,
  newDocument,
  prepareToOpen,
  onDocumentsChange,
  setActiveDocumentPath,
} from '../app/documents';
import { createSaveControl } from './saveControl';
import { attachDropdown, menuArrowButton } from './dropdownMenu';
import { canWriteBack, fileHandles, fileNameOf, onFileHandlesChange } from '../persistence/save';
import { openStartScreen } from './startScreen';
import { createFileActions } from './fileActions';
import { showContextMenu, type ContextMenuItem } from '../interaction/contextMenu';

/** A narrow ▾ button beside a toolbar button, opening a menu of related actions under it. */
function menuArrow(label: string, items: () => ContextMenuItem[]): HTMLButtonElement {
  const btn = iconButton('chevronDown', label, () => {
    const r = btn.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 2, items());
  });
  btn.classList.add('iconBtn--menuArrow');
  return btn;
}

function splitButton(main: HTMLButtonElement, arrow: HTMLButtonElement): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'splitButton';
  wrap.append(main, arrow);
  return wrap;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
function timeAgo(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** World px kept free right of an example's drawing for its readouts (see zoomToFit). */
const EXAMPLE_READOUT_ROOM = 130;

export interface ProjectBarRefs {
  getName(): string;
  setName(name: string): void;
  /** The desktop app's start screen (ui/startScreen.ts). */
  showStartScreen?(): void;
}

/** The toolbar's project section: new, save, load, export and the examples. The project's name
 * (its tab's name) is kept here - the tabs, the inspector's own "Project name" row and the page
 * frame's title block all read and write it through the refs returned here. */
export function renderProjectBar(
  container: HTMLElement,
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
  connLayer: SVGSVGElement,
  frameLayer: SVGSVGElement,
  workspaceEl: HTMLElement,
): ProjectBarRefs {
  // The project's name is its tab's name (double-click the tab to rename it, or use the
  // inspector's Project name): what Save proposes as the file name, the title block shows and
  // an export is called. No field of its own in the toolbar.
  let projectName = 'project';

  // A new, empty circuit in a tab of its own - the same as the tab bar's +.
  const newBtn = iconButton('newDocument', 'New circuit', () => newDocument(), 'New');

  // Save, Open and Export, and their ▾ menus - files on disk in the desktop app, downloads and
  // the browser's pickers in a browser (see fileActions.ts).
  const files = createFileActions({
    ctx,
    viewport,
    connLayer,
    frameLayer,
    getName: () => projectName || 'project',
    setName: (name) => {
      projectName = name;
      activeNameChanged();
    },
  });

  // Save, with Save as and the file it goes to under its ▾ (ui/saveControl.ts).
  const saveControl = createSaveControl({
    save: () => void files.save(),
    saveAs: () => void files.saveAs(),
    saveAll: () => (listDocuments().length > 1 ? () => void files.saveAll() : null),
    docCount: () => listDocuments().length,
    canWriteBack,
    fileName: () => fileNameOf(activeDocumentId()),
  });
  onFileHandlesChange(saveControl.refresh);
  onDocumentsChange(saveControl.refresh);

  const loadBtn = iconButton(
    'folderOpen',
    'Open project (Ctrl+O)',
    () => void files.open(),
    'Open',
  );

  const openExport = (): void =>
    openExportDialog(projectName || 'project', connLayer, frameLayer, viewport, workspaceEl);
  const exportBtn = iconButton('download', 'Export image…', openExport, 'Export');
  const exportMenu = menuArrow('More ways to export', () => [
    { label: 'Export…', onClick: openExport },
    {
      label:
        listDocuments().length > 1
          ? `Export several circuits (${listDocuments().length} open)…`
          : 'Export several circuits…',
      onClick: () => openExportManyDialog(connLayer, frameLayer),
    },
  ]);

  /** Opens example `index` (from the menu or the start screen). */
  function openExample(index: number): void {
    const ex = EXAMPLES[index];
    if (!ex || !canEdit(appState.mode)) return;
    const file = ex.file();
    prepareToOpen();
    // An example is a new circuit: it doesn't belong to the file this tab may have come from, so
    // Save asks where to put it instead of writing over that file (desktop app).
    setActiveDocumentPath(undefined);
    fileHandles.delete(activeDocumentId());
    loadProject(file, ctx, viewport);
    projectName = file.name;
    activeNameChanged();
    appState.markDirty();
    // Room on the right for the simulation readouts beside the right-most components.
    requestAnimationFrame(() => zoomToFit(viewport, workspaceEl, EXAMPLE_READOUT_ROOM));
  }
  // Open, and under its ▾ the most recently opened files and the examples - ready-made
  // circuits, opened in a new document (or, if the setting is off, replacing whatever is on the
  // canvas: Undo brings it back).
  const openArrow = menuArrowButton('Recent files and examples');
  const openControl = document.createElement('span');
  openControl.className = 'splitButton openControl';
  openControl.append(loadBtn, openArrow);
  attachDropdown(openControl, openArrow, 'Open', (b) => {
    const recent = document.createElement('div');
    recent.className = 'menuSection';
    recent.append(b.heading('Recent files'), b.note('…'));
    void files.recentFiles(5).then((list) => {
      recent.replaceChildren(b.heading('Recent files'));
      if (list.length === 0) {
        recent.appendChild(
          b.note(
            files.isDesktop || canWriteBack()
              ? 'No recent files yet.'
              : 'Recent files need Chrome, Edge or the desktop app.',
          ),
        );
      }
      for (const f of list) {
        recent.appendChild(
          b.row({
            icon: 'document',
            title: f.name,
            hint: f.detail || `Last opened or saved ${timeAgo(f.at)}`,
            run: () => void f.open(),
          }),
        );
      }
    });
    const examplesList = document.createElement('div');
    examplesList.className = 'menuSection menuScroll';
    EXAMPLES.forEach((ex, i) => {
      examplesList.appendChild(
        b.row({ icon: 'newDocument', title: ex.title, compact: true, run: () => openExample(i) }),
      );
    });
    return [
      b.row({
        icon: 'folderOpen',
        title: 'Open…',
        hint: 'A project file from your computer',
        keys: ['Ctrl', 'O'],
        run: () => void files.open(),
      }),
      recent,
      b.heading('Examples'),
      examplesList,
    ];
  });

  container.append(newBtn, openControl, saveControl.el, splitButton(exportBtn, exportMenu));

  return {
    showStartScreen: () =>
      openStartScreen(
        {
          newCircuit: () => {
            // The app opens with one empty circuit: that's the new one.
            if (!isDocumentEmpty(activeDocumentId())) newDocument();
          },
          open: () => files.open(),
          openRecent: (path) => files.openRecent(path),
          examples: EXAMPLES.map((ex, i) => ({ title: ex.title, open: () => openExample(i) })),
        },
        __APP_VERSION__,
      ),
    getName: () => projectName || 'project',
    setName: (name: string) => {
      projectName = name;
      activeNameChanged();
    },
  };
}
