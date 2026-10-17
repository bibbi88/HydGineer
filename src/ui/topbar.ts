import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from './viewport';
import { renderProjectBar, type ProjectBarRefs } from './projectBar';
import { renderToolbar } from './toolbar';
import { renderViewControls } from './viewControls';
import { renderArrangeControls } from './arrangeControls';
import { createSvgEl } from '../components/shared/svgHelpers';

/** The app's mark and name, with the build version (yymmdd, see vite.config.ts) under it. The
 * mark is a double-acting cylinder: barrel, piston and rod. */
function renderBrand(container: HTMLElement): void {
  const brand = document.createElement('div');
  brand.className = 'brand';

  const logo = createSvgEl('svg', {
    class: 'brandLogo',
    viewBox: '0 0 32 32',
    width: 28,
    height: 28,
    'aria-hidden': 'true',
  });
  logo.append(
    createSvgEl('rect', { x: 1, y: 1, width: 30, height: 30, rx: 7, fill: '#1d3b8b' }),
    createSvgEl('rect', {
      x: 5,
      y: 10,
      width: 15,
      height: 12,
      rx: 1.5,
      fill: 'none',
      stroke: '#fff',
      'stroke-width': 2,
    }),
    createSvgEl('rect', { x: 10, y: 11, width: 3, height: 10, fill: '#5fa8ff' }),
    createSvgEl('line', {
      x1: 13,
      y1: 16,
      x2: 28,
      y2: 16,
      stroke: '#fff',
      'stroke-width': 2.5,
      'stroke-linecap': 'round',
    }),
  );

  const text = document.createElement('div');
  text.className = 'brandText';
  const name = document.createElement('span');
  name.className = 'brandName';
  const pneu = document.createElement('span');
  pneu.className = 'brandNameAccent';
  pneu.textContent = 'Pneu';
  name.append(pneu, 'Gineer');
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
 * window, zoom to selection) and arranging the selection (rotate, flip).
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
  renderToolbar(section('Simulation'));
  renderViewControls(section('View'), viewport, workspaceEl);
  renderArrangeControls(section('Arrange'));

  return projectRefs;
}
