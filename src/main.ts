import './ui/styles/app.css';
import { initViewport } from './ui/viewport';
import { renderComponentLibrary, COMPONENT_DRAG_MIME, getDraggedComponentType } from './ui/sidebar';
import { placeableComponentsByCategory, type ComponentFactoryContext } from './components/registry';
import { initLinking } from './interaction/linking';
import { initMarquee } from './interaction/marquee';
import { initKeyboard } from './interaction/keyboard';
import { initWireSplitting } from './interaction/wireSplitting';
import {
  trySpliceOntoWire,
  findNearestWireHit,
  setWireInsertHighlight,
  isWireInsertableType,
} from './interaction/wireInsertion';
import { placeComponent } from './interaction/spawn';
import { initValveActuatorSwap } from './interaction/valveActuatorSwap';
import { initClipboard } from './interaction/clipboard';
import { initWires } from './wires/connection';
import { initWireHandles } from './wires/handles';
import { startSimLoop } from './sim/loop';
import { appState } from './app/AppState';
import { renderTopbar } from './ui/topbar';
import { showRestoreBanner } from './ui/restoreBanner';
import { scheduleAutosave, readAutosave, clearAutosave } from './persistence/autosave';
import { loadProject } from './persistence/project';
import { initHistory, pushHistory, resetHistory } from './history/historyStore';
import { renderInspector } from './ui/inspector';
import { initPageFrame } from './ui/pageFrame';
import { resetCylinderLetters } from './components/shared/letters';
import { snap } from './core/grid';
import { canEdit } from './app/modes';
import { initConfirmBeforeUnload } from './app/confirmClose';

const workspaceQuery = document.querySelector<HTMLElement>('.workspace');
const viewportQuery = document.getElementById('viewport');
const gridLayerQuery = document.getElementById('gridLayer');
const frameLayerQuery = document.getElementById('frameLayer') as SVGSVGElement | null;
const compLayerQuery = document.getElementById('compLayer');
const connLayerQuery = document.getElementById('connLayer') as SVGSVGElement | null;
const handleLayerQuery = document.getElementById('handleLayer') as SVGSVGElement | null;
const sidebarButtonsQuery = document.getElementById('sidebarButtons');
const topbarQuery = document.getElementById('topbar');
const inspectorQuery = document.getElementById('inspector');

if (
  !workspaceQuery ||
  !viewportQuery ||
  !gridLayerQuery ||
  !frameLayerQuery ||
  !compLayerQuery ||
  !connLayerQuery ||
  !handleLayerQuery ||
  !sidebarButtonsQuery ||
  !topbarQuery ||
  !inspectorQuery
) {
  throw new Error('Missing required DOM scaffold elements');
}

const workspaceEl: HTMLElement = workspaceQuery;
const gridLayerEl: HTMLElement = gridLayerQuery;
const frameLayer: SVGSVGElement = frameLayerQuery;
const compLayer: HTMLElement = compLayerQuery;
const connLayer: SVGSVGElement = connLayerQuery;
const handleLayer: SVGSVGElement = handleLayerQuery;
const sidebarButtons: HTMLElement = sidebarButtonsQuery;
const topbarEl: HTMLElement = topbarQuery;
const inspectorEl: HTMLElement = inspectorQuery;

const viewport = initViewport(viewportQuery, workspaceEl, gridLayerEl);
initWires(connLayer, viewport, workspaceEl);
initWireHandles(handleLayer, viewport, workspaceEl);
initLinking(connLayer, viewport, workspaceEl);
initMarquee(workspaceEl, connLayer);
initKeyboard();
initWireSplitting(compLayer, viewport, workspaceEl);
initConfirmBeforeUnload();

const factoryCtx: ComponentFactoryContext = { compLayer };
initHistory(factoryCtx, viewport);
initValveActuatorSwap(factoryCtx, viewport);
initClipboard(factoryCtx, viewport, workspaceEl);

function addComponentAtViewCenter(type: string): void {
  const rect = workspaceEl.getBoundingClientRect();
  const world = viewport.clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  placeComponent(type, factoryCtx, viewport, snap(world.x), snap(world.y));
}

// Dragging a library tile onto the canvas places it wherever it's dropped (like a click, snapped
// to the grid) rather than always at the view center - an unsnapped drop would otherwise leave
// every wire into/out of it with the same off-grid jog a click-insert used to.
// While dragging a wire-insertable valve (check/throttle/one-way-flow) over the canvas, the
// nearest wire within reach highlights (see .wireInsertTarget in app.css) so it's clear before
// letting go that dropping here will splice it in rather than leave it unconnected. The dragged
// type has to come from sidebar.ts's own tracked variable, not dataTransfer.getData() - browsers
// withhold that payload until the actual 'drop' event.
workspaceEl.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes(COMPONENT_DRAG_MIME)) return;
  // Never offer a drop target while the simulation is running - see placeComponent.
  if (!canEdit(appState.mode)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';

  const draggedType = getDraggedComponentType();
  if (draggedType && isWireInsertableType(draggedType)) {
    const world = viewport.clientToWorld(e.clientX, e.clientY);
    const hit = findNearestWireHit(viewport, workspaceEl, world);
    setWireInsertHighlight(hit?.conn ?? null);
  } else {
    setWireInsertHighlight(null);
  }
});
workspaceEl.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null || !workspaceEl.contains(e.relatedTarget as Node)) {
    setWireInsertHighlight(null);
  }
});
workspaceEl.addEventListener('drop', (e) => {
  const type = e.dataTransfer?.getData(COMPONENT_DRAG_MIME);
  setWireInsertHighlight(null);
  if (!type) return;
  if (!canEdit(appState.mode)) return;
  e.preventDefault();
  const world = viewport.clientToWorld(e.clientX, e.clientY);
  // Dropping a check/throttle/one-way-flow valve close enough to an existing wire splices it
  // into that wire (two new connections either side of it) instead of landing unconnected on
  // top of it - see interaction/wireInsertion.ts for which types support this and why.
  const spliced = trySpliceOntoWire(type, factoryCtx, viewport, workspaceEl, world);
  if (spliced) return;
  placeComponent(type, factoryCtx, viewport, snap(world.x), snap(world.y));
});

renderComponentLibrary(
  sidebarButtons,
  placeableComponentsByCategory().map((group) => ({
    category: group.category,
    items: group.items.map(({ type, label }) => ({
      type,
      label,
      onClick: () => addComponentAtViewCenter(type),
    })),
  })),
);
// Building each cylinder's sidebar icon just spawned a real (throwaway) instance of it, which
// consumed letters from the same counter real placement uses - reset it so the first cylinder
// the user actually places still starts at "A".
resetCylinderLetters();

const projectBar = renderTopbar(topbarEl, factoryCtx, viewport, connLayer, frameLayer, workspaceEl);
// The library is an editing tool, so it greys out and stops responding while the simulation
// runs - matching the toolbar's own disabled buttons, rather than looking usable but silently
// refusing every click.
function refreshLibraryEnabled(): void {
  sidebarButtons.classList.toggle('libraryDisabled', !canEdit(appState.mode));
}
appState.onModeChange(refreshLibraryEnabled);
refreshLibraryEnabled();

// Port dots are a wiring aid; while the simulation runs (or is paused) nothing can be wired,
// so they're hidden to let the circuit read like a clean drawing.
function refreshSimulatingClass(): void {
  workspaceEl.classList.toggle('simulating', !canEdit(appState.mode));
}
appState.onModeChange(refreshSimulatingClass);
refreshSimulatingClass();

renderInspector(inspectorEl, projectBar);
initPageFrame(frameLayer, projectBar, viewport, workspaceEl);
startSimLoop();

appState.onChange(() => {
  const name = projectBar.getName();
  scheduleAutosave(name);
  pushHistory(name);
});

const autosaved = readAutosave();
if (autosaved) {
  showRestoreBanner(
    () => {
      resetHistory();
      loadProject(autosaved.file, factoryCtx, viewport);
      projectBar.setName(autosaved.file.name);
    },
    () => clearAutosave(),
  );
}
