import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from './viewport';
import { renderProjectBar, type ProjectBarRefs } from './projectBar';
import { renderToolbar } from './toolbar';
import { renderRecordButton } from './recordButton';
import { renderViewControls } from './viewControls';
import { renderArrangeControls } from './arrangeControls';
import { iconButton } from './iconButton';
import { createBrandMark } from './brandMark';
import { openSettingsDialog } from './settingsDialog';
import { getSettings, onSettingsChange, updateSettings } from '../app/settings';

/** The app's mark and name, with the build version (yymmdd, see vite.config.ts) under it. The
 * mark is a hydraulic cylinder (see brandMark.ts). */
function renderBrand(container: HTMLElement): void {
  const brand = document.createElement('div');
  brand.className = 'brand';

  const logo = createBrandMark(28, 'brandLogo');

  const text = document.createElement('div');
  text.className = 'brandText';
  const name = document.createElement('span');
  name.className = 'brandName';
  const hyd = document.createElement('span');
  hyd.className = 'brandNameAccent';
  hyd.textContent = 'Hyd';
  name.append(hyd, 'Gineer');
  const version = document.createElement('span');
  version.className = 'brandVersion';
  version.textContent = `v${__APP_VERSION__}`;
  version.title = 'Version (build date, yymmdd)';
  text.append(name, version);

  brand.append(logo, text);
  container.appendChild(brand);
}

/** Builds the application toolbar across the top of the window, grouped so related controls sit
 * together with a divider between groups: the project (name, save, load, export), the
 * simulation and its history (play/stop, pause, step, undo, redo), the view (zoom, fit to
 * window, zoom to selection), arranging the selection (rotate, flip) and the settings.
 *
 * Returns the project refs, since the project name field lives in the first section and both
 * the inspector and the page frame's title block read it from there.
 */
export function renderTopbar(
  container: HTMLElement,
  ctx: ComponentFactoryContext,
  viewport: ViewportAdapter,
  connLayer: SVGSVGElement,
  frameLayer: SVGSVGElement,
  workspaceEl: HTMLElement,
): ProjectBarRefs {
  container.replaceChildren();
  renderBrand(container);

  function section(label: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'topbarSection';
    // Grouping alone is only visible, so the group is also named for screen readers.
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', label);
    container.appendChild(el);
    return el;
  }

  const projectRefs = renderProjectBar(
    section('Project'),
    ctx,
    viewport,
    connLayer,
    frameLayer,
    workspaceEl,
  );
  const simulation = section('Simulation');
  renderToolbar(simulation);
  renderRecordButton(simulation, {
    getName: () => projectRefs.getName(),
    connLayer,
    frameLayer,
    viewport,
    workspaceEl,
  });
  renderViewControls(section('View'), viewport, workspaceEl);
  renderArrangeControls(section('Arrange'));
  // Tips: a toggle, lit while on - the canvas shortcuts and the short explanations in the
  // inspector show only then.
  const tipsBtn = iconButton('tips', 'Show tips', () =>
    updateSettings({ showTips: !getSettings().showTips }),
  );
  const refreshTips = (): void => {
    const on = getSettings().showTips;
    tipsBtn.classList.toggle('iconBtn--active', on);
    tipsBtn.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('tipsOn', on);
  };
  onSettingsChange(refreshTips);
  refreshTips();
  section('Settings').append(
    tipsBtn,
    iconButton('settings', 'Settings', () => openSettingsDialog()),
  );

  return projectRefs;
}
