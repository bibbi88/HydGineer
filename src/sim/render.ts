import { appState } from '../app/AppState';
import { portKey } from './ports';
import { isElectricallyLive } from './electrical';
import type { HydFrame } from './engine';
import { FLOW_THRESHOLD, PRESSURE_THRESHOLD, flowDuration, pressureColor } from './pressureScale';

function fmtP(p: number): string {
  return `${(Math.abs(p) < 0.05 ? 0 : p).toFixed(1)} bar`;
}

function fmtQ(q: number): string {
  const a = Math.abs(q);
  return `${a.toFixed(a < 10 ? 2 : 1)} L/min`;
}

/**
 * One wire per hydraulic net (set of ports joined by wires, which all share one pressure) carries
 * the net's label - the longest one, where the text has the most room - instead of every wire
 * repeating the same pressure. Recomputed only when the wiring changes.
 */
let labelWires = new Set<number>();
let labelTopology = -1;
function refreshLabelWires(): void {
  if (labelTopology === appState.topologyVersion) return;
  labelTopology = appState.topologyVersion;
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  for (const c of appState.connections) {
    const a = find(portKey(c.from.id, c.from.port));
    const b = find(portKey(c.to.id, c.to.port));
    if (a !== b) parent.set(a, b);
  }
  const best = new Map<string, { id: number; len: number }>();
  for (const c of appState.connections) {
    const root = find(portKey(c.from.id, c.from.port));
    let len: number;
    try {
      len = c.pathEl.getTotalLength?.() ?? 0;
    } catch {
      len = 0;
    }
    const cur = best.get(root);
    if (!cur || len > cur.len) best.set(root, { id: c.id, len });
  }
  labelWires = new Set([...best.values()].map((b) => b.id));
}

function setWireTitle(hitEl: SVGPathElement, text: string | null): void {
  let t = hitEl.querySelector<SVGTitleElement>('title');
  if (text === null) {
    t?.remove();
    return;
  }
  if (!t) {
    t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    hitEl.appendChild(t);
  }
  if (t.textContent !== text) t.textContent = text;
}

let statusEl: HTMLElement | null = null;
function status(): HTMLElement | null {
  if (statusEl) return statusEl;
  const ws = document.querySelector('.workspace');
  if (!ws) return null;
  statusEl = document.createElement('div');
  statusEl.className = 'hydStatus';
  ws.appendChild(statusEl);
  return statusEl;
}

/** Draws one solved frame onto the diagram, or clears it all (`frame` null, e.g. on Stop). */
export function applyToDom(frame: HydFrame | null): void {
  const sol = frame?.solution;
  let pMax = 0;
  if (sol) for (const p of sol.pressure.values()) pMax = Math.max(pMax, p);

  for (const c of appState.components) {
    for (const port of Object.values(c.ports)) {
      if (port.electrical) continue;
      const key = portKey(c.id, port.key);
      const p = sol?.pressure.get(key) ?? 0;
      port.el.classList.toggle('pressurized', p > PRESSURE_THRESHOLD);
      if (sol) {
        const q = sol.portFlow.get(key) ?? 0;
        port.el.setAttribute('title', `${port.key}: ${fmtP(p)}, ${fmtQ(q)}`);
      } else {
        port.el.removeAttribute('title');
      }
    }
  }

  refreshLabelWires();
  for (const conn of appState.connections) {
    const fromKey = portKey(conn.from.id, conn.from.port);
    const toKey = portKey(conn.to.id, conn.to.port);
    const pathEl = conn.pathEl;
    pathEl.classList.toggle('live', isElectricallyLive(fromKey) && isElectricallyLive(toKey));

    const p = sol?.pressure.get(fromKey);
    if (!sol || p === undefined) {
      pathEl.classList.remove('hydP', 'hydReturn', 'hydFlow', 'hydFlowReverse');
      pathEl.style.removeProperty('--wp');
      conn.labelEl.textContent = '';
      setWireTitle(conn.hitEl, null);
      continue;
    }
    const q = frame?.wireFlow.get(conn.id) ?? NaN;
    const flowing = Number.isFinite(q) && Math.abs(q) >= FLOW_THRESHOLD;
    const pressurized = p > PRESSURE_THRESHOLD;
    pathEl.classList.toggle('hydP', pressurized);
    pathEl.classList.toggle('hydReturn', !pressurized && flowing);
    if (pressurized) pathEl.style.setProperty('--wp', pressureColor(p));
    pathEl.classList.toggle('hydFlow', flowing);
    pathEl.classList.toggle('hydFlowReverse', flowing && q < 0);
    if (flowing) pathEl.style.setProperty('--flowDur', flowDuration(q));
    const text = flowing ? `${fmtP(p)} · ${fmtQ(q)}` : fmtP(p);
    conn.labelEl.textContent = labelWires.has(conn.id) ? text : '';
    setWireTitle(conn.hitEl, text);
  }

  const el = status();
  if (!el) return;
  if (!sol) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  const warnings: string[] = [];
  if (!sol.converged) warnings.push('⚠ Solver did not fully converge - values approximate');
  let pMin = 0;
  for (const p of sol.pressure.values()) pMin = Math.min(pMin, p);
  if (pMin < -0.9) {
    warnings.push('⚠ Cavitation: a line is sucked down to vapour pressure (runaway load?)');
  }
  el.textContent = [`p max ${fmtP(pMax)}`, ...warnings].join('\n');
  el.style.display = '';
  el.classList.toggle('hydStatusWarn', warnings.length > 0);
}
