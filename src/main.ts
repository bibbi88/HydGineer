import './ui/styles/app.css';
import { initViewport } from './ui/viewport';
import { renderComponentLibrary } from './ui/sidebar';
import { placeableComponentsByCategory, type ComponentFactoryContext } from './components/registry';
import { initLinking } from './interaction/linking';
import { initMarquee } from './interaction/marquee';
import { initKeyboard } from './interaction/keyboard';
import { initPlcMonitor } from './ui/plcMonitor';
import { initWireSplitting } from './interaction/wireSplitting';
import { initLibraryDrag } from './interaction/libraryDrag';
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
initPlcMonitor();
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
  initLibraryDrag(factoryCtx, viewport, workspaceEl),
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
