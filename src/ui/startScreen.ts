import { createSvgEl } from '../components/shared/svgHelpers';
import { listRecentFiles } from '../app/recentFiles';
import { fileBaseName } from '../app/desktopBridge';

export interface StartScreenActions {
  newCircuit(): void;
  open(): Promise<void>;
  /** A recent file; whether it opened (a file that's gone stays on the start screen). */
  openRecent(path: string): Promise<boolean>;
  examples: Array<{ title: string; open(): void }>;
}

let current: HTMLElement | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;

export function closeStartScreen(): void {
  current?.remove();
  current = null;
  if (onKey) window.removeEventListener('keydown', onKey);
  onKey = null;
}

export function isStartScreenOpen(): boolean {
  return current !== null;
}

function logo(size: number): SVGSVGElement {
  const svg = createSvgEl('svg', {
    viewBox: '0 0 32 32',
    width: size,
    height: size,
    'aria-hidden': 'true',
  }) as SVGSVGElement;
  svg.append(
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
  return svg;
}

function folderOf(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join(path.includes('\\') ? '\\' : '/');
}

function ago(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString();
}

function actionButton(label: string, hint: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'startAction';
  const strong = document.createElement('strong');
  strong.textContent = label;
  const small = document.createElement('span');
  small.textContent = hint;
  btn.append(strong, small);
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * The desktop app's start screen: the app's mark and version, New circuit and Open project, the
 * recently opened files, and the examples. Closes when something is picked - or with Esc, or ✕,
 * leaving the empty circuit it opened with.
 */
export function openStartScreen(actions: StartScreenActions, version: string): void {
  closeStartScreen();
  const screen = document.createElement('div');
  screen.className = 'startScreen';
  screen.setAttribute('role', 'dialog');
  screen.setAttribute('aria-label', 'Start');

  const card = document.createElement('div');
  card.className = 'startCard';
  screen.appendChild(card);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'startClose';
  close.textContent = '✕';
  close.title = 'Close (Esc)';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', closeStartScreen);

  // Left: who we are, and the two things you usually do first.
  const side = document.createElement('div');
  side.className = 'startSide';
  const brand = document.createElement('div');
  brand.className = 'startBrand';
  const name = document.createElement('div');
  name.className = 'startName';
  const hyd = document.createElement('span');
  hyd.textContent = 'Hyd';
  name.append(hyd, 'Gineer');
  const tagline = document.createElement('div');
  tagline.className = 'startTagline';
  tagline.textContent = 'Hydraulic circuit editor and simulator';
  const ver = document.createElement('div');
  ver.className = 'startVersion';
  ver.textContent = `Version ${version}`;
  brand.append(logo(64), name, tagline, ver);

  const actionsBox = document.createElement('div');
  actionsBox.className = 'startActions';
  actionsBox.append(
    actionButton('New circuit', 'Start with an empty sheet', () => {
      closeStartScreen();
      actions.newCircuit();
    }),
    actionButton('Open project…', 'A .hgcl file on this computer', () => {
      void actions.open().then(() => closeStartScreen());
    }),
  );
  side.append(brand, actionsBox);

  // Right: recent files, then the examples.
  const main = document.createElement('div');
  main.className = 'startMain';

  const recentHead = document.createElement('h2');
  recentHead.textContent = 'Recent';
  main.appendChild(recentHead);
  const recent = listRecentFiles();
  if (recent.length === 0) {
    const none = document.createElement('p');
    none.className = 'startEmpty';
    none.textContent = 'Projects you open or save show up here.';
    main.appendChild(none);
  } else {
    const list = document.createElement('ul');
    list.className = 'startList';
    for (const f of recent) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'startItem';
      btn.title = f.path;
      const title = document.createElement('strong');
      title.textContent = fileBaseName(f.path);
      const where = document.createElement('span');
      where.className = 'startItemPath';
      where.textContent = folderOf(f.path);
      const when = document.createElement('span');
      when.className = 'startItemWhen';
      when.textContent = ago(f.at);
      btn.append(title, when, where);
      btn.addEventListener('click', () => {
        void actions.openRecent(f.path).then((ok) => {
          if (ok) closeStartScreen();
          else li.remove();
        });
      });
      li.appendChild(btn);
      list.appendChild(li);
    }
    main.appendChild(list);
  }

  if (actions.examples.length > 0) {
    const exHead = document.createElement('h2');
    exHead.textContent = 'Examples';
    main.appendChild(exHead);
    const exList = document.createElement('ul');
    exList.className = 'startList startExamples';
    for (const ex of actions.examples) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'startItem';
      const title = document.createElement('strong');
      title.textContent = ex.title;
      btn.appendChild(title);
      btn.addEventListener('click', () => {
        closeStartScreen();
        ex.open();
      });
      li.appendChild(btn);
      exList.appendChild(li);
    }
    main.appendChild(exList);
  }

  card.append(close, side, main);
  document.body.appendChild(screen);
  current = screen;
  onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeStartScreen();
  };
  window.addEventListener('keydown', onKey);
}
