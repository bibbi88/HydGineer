/**
 * A floating, non-blocking window that shows a PLC's program running: the same FBD diagram the
 * editor draws, read-only, with every signal colored by its live value and each timer's elapsed
 * time / counter's count beside it. It opens by itself when the simulation starts (if the
 * circuit has a PLC and the user hasn't turned that off), closes when it stops, and leaves the
 * canvas usable underneath so push buttons can still be operated while watching the program.
 */
import type { Component } from '../core/types';
import { appState } from '../app/AppState';
import { Modes, type Mode } from '../app/modes';
import { createSvgEl } from '../components/shared/svgHelpers';
import { getPlcLiveState, isPlc, type PlcLiveState } from '../components/plcLiveState';
import { evaluateGraphNodes, type PlcGraph } from '../sim/plcGraph';
import { drawDiagram, nodeExtent } from './plcDiagram';

const PREFS_KEY = 'hydgineer.plcMonitor';
const DEFAULT_W = 560;
const DEFAULT_H = 380;
const MIN_W = 320;
const MIN_H = 200;
const MARGIN = 20;

interface Prefs {
  /** Open by itself when the simulation starts. */
  auto: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    return { ...parsed, auto: parsed.auto !== false };
  } catch {
    return { auto: true };
  }
}

function savePrefs(update: Partial<Prefs>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...update }));
  } catch {
    // Private browsing / storage disabled - the window just won't remember its place.
  }
}

interface MonitorWindow {
  el: HTMLElement;
  tabs: HTMLElement;
  status: HTMLElement;
  leds: HTMLElement;
  svg: SVGSVGElement;
  legacy: HTMLPreElement;
  active: Component | null;
  /** What the window last drew, so a frame with nothing new redraws nothing. */
  lastKey: string;
  lastTabsKey: string;
  frame: number;
}

let monitor: MonitorWindow | null = null;

function plcs(): Component[] {
  return appState.components.filter(isPlc);
}

/** Call once at startup: opens the monitor when a simulation starts, closes it when it stops. */
export function initPlcMonitor(): void {
  let previous: Mode = appState.mode;
  appState.onModeChange(() => {
    const mode = appState.mode;
    if (mode === Modes.STOP) closePlcMonitor();
    else if (previous === Modes.STOP && loadPrefs().auto && plcs().length > 0) openPlcMonitor();
    previous = mode;
  });
}

export function isPlcMonitorOpen(): boolean {
  return monitor !== null;
}

/** Opens the monitor (or brings it to `comp` if it's already open). Without `comp` it shows the
 * selected PLC, else the first one. */
export function openPlcMonitor(comp?: Component): void {
  const all = plcs();
  const selected = all.find((c) => appState.selectedComponents.has(c.id));
  const target = comp ?? selected ?? all[0] ?? null;
  if (!monitor) monitor = buildWindow();
  monitor.active = target;
  monitor.lastKey = '';
  monitor.lastTabsKey = '';
  update();
}

export function closePlcMonitor(): void {
  if (!monitor) return;
  cancelAnimationFrame(monitor.frame);
  monitor.el.remove();
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
  monitor = null;
}

let drag: { dx: number; dy: number } | null = null;

function onDragMove(e: MouseEvent): void {
  if (!drag || !monitor) return;
  place(monitor.el, e.clientX - drag.dx, e.clientY - drag.dy);
}

function onDragEnd(): void {
  if (!monitor) return;
  const el = monitor.el;
  if (drag) {
    drag = null;
    savePrefs({ x: el.offsetLeft, y: el.offsetTop });
  }
  // The CSS resize handle has no event of its own - a mouseup after it is the end of a resize.
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const prefs = loadPrefs();
  if (w > 0 && h > 0 && (w !== prefs.w || h !== prefs.h)) savePrefs({ w, h });
}

/** Moves the window, keeping at least its title bar on screen. */
function place(el: HTMLElement, x: number, y: number): void {
  const maxX = Math.max(0, window.innerWidth - 80);
  const maxY = Math.max(0, window.innerHeight - 40);
  el.style.left = `${Math.min(Math.max(0, x), maxX)}px`;
  el.style.top = `${Math.min(Math.max(0, y), maxY)}px`;
}

function buildWindow(): MonitorWindow {
  const prefs = loadPrefs();
  const el = document.createElement('div');
  el.className = 'plcMonitor';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'PLC monitor');
  const w = Math.max(MIN_W, prefs.w ?? DEFAULT_W);
  const h = Math.max(MIN_H, prefs.h ?? DEFAULT_H);
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  place(
    el,
    prefs.x ?? window.innerWidth - w - MARGIN,
    prefs.y ?? Math.max(MARGIN, window.innerHeight - h - MARGIN * 4),
  );

  const header = document.createElement('div');
  header.className = 'plcMonitorHeader';
  const title = document.createElement('span');
  title.className = 'plcMonitorTitle';
  title.textContent = 'PLC monitor';
  const tabs = document.createElement('div');
  tabs.className = 'plcMonitorTabs';

  const autoLabel = document.createElement('label');
  autoLabel.className = 'plcMonitorAuto';
  autoLabel.title = 'Open this window by itself when the simulation starts';
  const auto = document.createElement('input');
  auto.type = 'checkbox';
  auto.checked = prefs.auto;
  auto.addEventListener('change', () => savePrefs({ auto: auto.checked }));
  autoLabel.append(auto, document.createTextNode('Open on Play'));

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'plcMonitorClose';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close PLC monitor');
  closeBtn.addEventListener('click', () => closePlcMonitor());
  header.append(title, tabs, autoLabel, closeBtn);

  header.addEventListener('mousedown', (e) => {
    if ((e.target as Element).closest('button, input, label')) return;
    e.preventDefault();
    drag = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop };
  });
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);

  const statusRow = document.createElement('div');
  statusRow.className = 'plcMonitorStatusRow';
  const status = document.createElement('span');
  status.className = 'plcMonitorStatus';
  const leds = document.createElement('div');
  leds.className = 'plcMonitorLeds';
  statusRow.append(status, leds);

  const body = document.createElement('div');
  body.className = 'plcMonitorBody';
  const svg = createSvgEl('svg', {
    class: 'plcCanvas plcMonitorCanvas',
    preserveAspectRatio: 'xMidYMid meet',
  }) as SVGSVGElement;
  const legacy = document.createElement('pre');
  legacy.className = 'plcMonitorLegacy';
  body.append(svg, legacy);

  el.append(header, statusRow, body);
  document.body.appendChild(el);

  return {
    el,
    tabs,
    status,
    leds,
    svg,
    legacy,
    active: null,
    lastKey: '',
    lastTabsKey: '',
    frame: 0,
  };
}

function tabLabels(list: Component[]): Map<Component, string> {
  const names = list.map((c) => getPlcLiveState(c)?.name ?? 'PLC');
  return new Map(
    list.map((c, i) => {
      const name = names[i] as string;
      const clash = names.filter((n) => n === name).length > 1;
      return [
        c,
        clash ? `${name} ${names.slice(0, i + 1).filter((n) => n === name).length}` : name,
      ];
    }),
  );
}

function renderTabs(m: MonitorWindow, list: Component[]): void {
  const labels = tabLabels(list);
  const key = list.map((c) => `${c.id}:${labels.get(c)}:${c === m.active}`).join('|');
  if (key === m.lastTabsKey) return;
  m.lastTabsKey = key;
  m.tabs.replaceChildren();
  // With a single PLC the "tab" is just its name - styled as a plain label, nothing to switch.
  for (const c of list) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = c === m.active ? 'plcMonitorTab plcMonitorTabActive' : 'plcMonitorTab';
    tab.textContent = labels.get(c) ?? 'PLC';
    tab.addEventListener('click', () => {
      m.active = c;
      m.lastKey = '';
      update();
    });
    m.tabs.appendChild(tab);
  }
  m.tabs.classList.toggle('plcMonitorTabsSingle', list.length <= 1);
}

const graphIds = new WeakMap<PlcGraph, number>();
let nextGraphId = 1;
function graphId(g: PlcGraph | null): number {
  if (!g) return 0;
  let id = graphIds.get(g);
  if (id === undefined) {
    id = nextGraphId++;
    graphIds.set(g, id);
  }
  return id;
}

function stateKey(state: PlcLiveState, values: Map<string, boolean>): string {
  const bits = (m: Map<string, boolean>): string =>
    [...m].map(([k, v]) => `${k}${v ? 1 : 0}`).join('');
  const fb = [...state.fb]
    .map(([k, s]) => `${k}${s.q ? 1 : 0}:${s.et.toFixed(1)}:${s.cv}`)
    .join(',');
  const nodes = [...values].map(([k, v]) => `${k}${v ? 1 : 0}`).join('');
  return [
    graphId(state.graph),
    state.programText,
    state.powered,
    bits(state.inputs),
    bits(state.outputs),
    fb,
    nodes,
  ].join('/');
}

function renderLeds(m: MonitorWindow, state: PlcLiveState): void {
  m.leds.replaceChildren();
  const group = (names: string[], values: Map<string, boolean>): HTMLElement => {
    const g = document.createElement('div');
    g.className = 'plcMonitorLedGroup';
    for (const name of names) {
      const led = document.createElement('span');
      led.className = values.get(name) ? 'plcLed plcLedOn' : 'plcLed';
      led.textContent = name;
      g.appendChild(led);
    }
    return g;
  };
  m.leds.append(
    group([...state.inputs.keys()], state.inputs),
    group([...state.outputs.keys()], state.outputs),
  );
}

/** Fits the svg's viewBox to the diagram, so it fills the window however it's resized. */
function fitView(svg: SVGSVGElement, graph: PlcGraph): void {
  if (graph.nodes.length === 0) {
    svg.setAttribute('viewBox', '0 0 400 200');
    return;
  }
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const n of graph.nodes) {
    const e = nodeExtent(n);
    x1 = Math.min(x1, e.x1);
    y1 = Math.min(y1, e.y1);
    x2 = Math.max(x2, e.x2);
    y2 = Math.max(y2, e.y2);
  }
  const pad = 15;
  svg.setAttribute('viewBox', `${x1 - pad} ${y1 - pad} ${x2 - x1 + 2 * pad} ${y2 - y1 + 2 * pad}`);
}

function update(): void {
  const m = monitor;
  if (!m) return;
  cancelAnimationFrame(m.frame);

  const list = plcs();
  if (!m.active || !list.includes(m.active)) {
    m.active = list[0] ?? null;
    m.lastKey = '';
  }
  renderTabs(m, list);

  const state = m.active ? getPlcLiveState(m.active) : null;
  if (!state) {
    if (m.lastKey !== 'none') {
      m.lastKey = 'none';
      m.status.textContent = 'No PLC in the circuit';
      m.status.className = 'plcMonitorStatus';
      m.leds.replaceChildren();
      m.svg.replaceChildren();
      m.svg.style.display = 'none';
      m.legacy.style.display = 'none';
    }
  } else {
    const values = state.graph
      ? evaluateGraphNodes(state.graph, new Map([...state.inputs, ...state.outputs]), state.fb)
      : new Map<string, boolean>();
    const key = stateKey(state, values);
    if (key !== m.lastKey) {
      m.lastKey = key;
      const running = appState.mode === Modes.PLAY;
      m.status.textContent = !state.powered
        ? 'No power - connect L+ and M'
        : running
          ? 'RUN'
          : 'PAUSED';
      m.status.className = `plcMonitorStatus ${
        !state.powered ? 'plcMonitorStatusOff' : running ? 'plcMonitorStatusRun' : ''
      }`;
      renderLeds(m, state);
      if (state.graph) {
        m.svg.style.display = '';
        m.legacy.style.display = 'none';
        fitView(m.svg, state.graph);
        drawDiagram(m.svg, state.graph, { live: { nodes: values, fb: state.fb } });
      } else {
        m.svg.style.display = 'none';
        m.legacy.style.display = '';
        m.legacy.textContent = state.programText;
      }
    }
  }

  m.frame = requestAnimationFrame(update);
}
