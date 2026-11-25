/**
 * Diagrams of the recorded run (sim/recorder.ts): a floating panel, opened from the toolbar,
 * that stays open while simulating and follows the run live. Each diagram plots one or more
 * recorded quantities - positions, speeds, forces, flows, powers - over a window from one event
 * to another (the run's start or end, a time, the nth time a signal such as a push button or a
 * sensor switches), lists each one's start, end, minimum, maximum, average and integral (energy,
 * volume...) over it, and works out ratios between them, e.g. an efficiency: the energy that
 * reached the load over the energy the pump took. The signals that switched are shown under the
 * plot, so button presses and sensor trips line up with the curves. Everything can be exported
 * as CSV. The diagrams are saved with the circuit (app/diagrams.ts).
 */
import { appState } from '../app/AppState';
import {
  diagramsChanged,
  listDiagrams,
  newDiagram,
  onDiagramsChange,
  removeDiagram,
  type DiagramConfig,
  type DiagramEvent,
  type RatioMeasure,
  type SeriesRef,
} from '../app/diagrams';
import { currentRun, onRecording, seriesId, type RecordedSeries, type Run } from '../sim/recorder';
import { eventWindow, integralUnit, ratio, seriesStats, valueAtTime } from '../sim/diagramAnalysis';
import { downloadBlob } from '../persistence/exportImage';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#4b5563',
];

let panel: HTMLElement | null = null;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
const updaters: Array<() => void> = [];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A component's name as on the canvas (or its type, or "removed"). */
function componentName(compId: number): string {
  const c = appState.components.find((x) => x.id === compId);
  if (!c) return 'removed';
  return c.el.querySelector('.compNameText')?.textContent?.trim() || c.type;
}

function seriesName(run: Run | null, ref: SeriesRef): string {
  const s = run?.series.get(seriesId(ref.compId, ref.key));
  return `${componentName(ref.compId)}: ${s ? s.label : ref.key}`;
}

/** A number for a table: 3 significant figures, plain for everyday sizes. */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.001 || a >= 1e6)) return v.toExponential(2);
  return Number(v.toPrecision(3)).toString();
}

function eventLabel(e: DiagramEvent): string {
  switch (e.kind) {
    case 'start':
      return 'start of the run';
    case 'end':
      return 'end of the run';
    case 'time':
      return `t = ${e.t} s`;
    case 'signal':
      return `${e.name} ${e.edge}${e.n > 1 ? ` (#${e.n})` : ''}`;
  }
}

/** A select for a window's start or end event, with the signals of the run; a number field for
 * the time or the occurrence beside it. */
function eventControl(
  ev: DiagramEvent,
  run: Run | null,
  onChange: (e: DiagramEvent) => void,
): HTMLElement {
  const wrap = el('span', 'diagEvent');
  const select = el('select');
  select.append(new Option('Start of the run', 'start'), new Option('End of the run', 'end'));
  select.append(new Option('At a time…', 'time'));
  const names = new Set<string>(run ? [...run.signals.keys()] : []);
  if (ev.kind === 'signal') names.add(ev.name.toUpperCase());
  for (const name of [...names].sort()) {
    select.append(new Option(`${name} turns on`, `sig:${name}:on`));
    select.append(new Option(`${name} turns off`, `sig:${name}:off`));
  }
  select.value = ev.kind === 'signal' ? `sig:${ev.name.toUpperCase()}:${ev.edge}` : ev.kind;
  wrap.appendChild(select);
  if (ev.kind === 'time' || ev.kind === 'signal') {
    const num = el('input');
    num.type = 'number';
    num.className = 'diagEventNum';
    if (ev.kind === 'time') {
      num.min = '0';
      num.step = '0.1';
      num.value = String(ev.t);
      num.title = 'Time, s';
      num.addEventListener('change', () =>
        onChange({ kind: 'time', t: Math.max(0, Number(num.value) || 0) }),
      );
      wrap.append(num, el('span', 'diagUnit', 's'));
    } else {
      num.min = '1';
      num.step = '1';
      num.value = String(ev.n);
      num.title = 'Which time it happens: 1 = the first';
      num.addEventListener('change', () =>
        onChange({ ...ev, n: Math.max(1, Math.round(Number(num.value) || 1)) }),
      );
      wrap.append(el('span', 'diagUnit', '#'), num);
    }
  }
  select.addEventListener('change', () => {
    const v = select.value;
    if (v === 'start' || v === 'end') onChange({ kind: v });
    else if (v === 'time') onChange({ kind: 'time', t: 0 });
    else {
      const [, name, edge] = v.split(':');
      onChange({ kind: 'signal', name: name!, edge: edge === 'off' ? 'off' : 'on', n: 1 });
    }
  });
  return wrap;
}

/** The quantities a diagram can add: every one recorded, grouped by component. */
function quantityPicker(
  run: Run | null,
  d: DiagramConfig,
  onPick: (r: SeriesRef) => void,
): HTMLElement {
  const select = el('select', 'diagAdd');
  select.append(
    new Option(run ? '+ Add a quantity…' : 'Run the simulation to list quantities', ''),
  );
  if (run) {
    const byComp = new Map<number, RecordedSeries[]>();
    for (const s of run.series.values()) {
      if (!byComp.has(s.compId)) byComp.set(s.compId, []);
      byComp.get(s.compId)!.push(s);
    }
    for (const [compId, list] of byComp) {
      const group = document.createElement('optgroup');
      group.label = componentName(compId);
      for (const s of list) {
        const used = d.series.some((r) => r.compId === compId && r.key === s.key);
        const o = new Option(`${s.label} [${s.unit}]`, `${compId}|${s.key}`);
        o.disabled = used;
        group.appendChild(o);
      }
      select.appendChild(group);
    }
  }
  select.addEventListener('change', () => {
    const [id, key] = select.value.split('|');
    if (id && key) onPick({ compId: Number(id), key });
  });
  return select;
}

interface Axis {
  unit: string;
  min: number;
  max: number;
}

function niceRange(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  // A quantity that (all but) doesn't change gets a band round its value.
  if (max - min <= Math.max(Math.abs(min), Math.abs(max)) * 1e-6) {
    const c = (min + max) / 2;
    const half = Math.abs(c) * 0.1 || 1;
    return [c - half, c + half];
  }
  const pad = (max - min) * 0.06;
  // Positive quantities (powers, flows, pressures...) from zero, so the curves compare true to
  // size.
  if (min >= 0) return [0, max + pad];
  return [min - pad, max + pad];
}

/** About `n` round values between min and max, for an axis - never more than 50. */
export function axisTicks(min: number, max: number, n = 5): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return Number.isFinite(min) ? [min] : [];
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? step0;
  const first = Math.ceil(min / step);
  const count = Math.min(50, Math.floor(max / step + 1e-9) - first + 1);
  const out: number[] = [];
  for (let k = 0; k < count; k++) out.push(Number(((first + k) * step).toPrecision(10)));
  return out;
}

/** The plot: the window's time along the bottom, one or two value axes (the first two units;
 * further ones scaled onto the right-hand one, dashed), and the signals that switched in a strip
 * underneath. */
function drawChart(
  host: HTMLElement,
  run: Run,
  d: DiagramConfig,
  win: { t0: number; t1: number },
): void {
  const W = Math.max(320, host.clientWidth || 560);
  const series = d.series
    .map((r, i) => ({
      ref: r,
      s: run.series.get(seriesId(r.compId, r.key)),
      color: COLORS[i % COLORS.length]!,
    }))
    .filter((x): x is { ref: SeriesRef; s: RecordedSeries; color: string } => !!x.s);
  // Signals that switched inside the window.
  const sigs = [...run.signals.entries()]
    .filter(
      ([, ch]) =>
        ch.some((c, i) => i > 0 && c.t >= win.t0 && c.t <= win.t1) ||
        (ch[0]!.on && ch.length === 1),
    )
    .slice(0, 6);
  const plotH = 190;
  const sigH = sigs.length ? sigs.length * 14 + 8 : 0;
  const H = plotH + 26 + sigH;
  const L = 54;
  const R = 54;
  const T = 8;
  const x = (t: number): number => L + ((t - win.t0) / (win.t1 - win.t0 || 1)) * (W - L - R);

  // Axes by unit.
  const units = [...new Set(series.map((x) => x.s.unit))];
  const axes: Axis[] = units.map((unit) => {
    let min = Infinity;
    let max = -Infinity;
    for (const { s } of series.filter((x) => x.s.unit === unit)) {
      for (let i = 0; i < run.t.length; i++) {
        const t = run.t[i]!;
        if (t < win.t0 || t > win.t1) continue;
        const v = s.values[i];
        if (v === undefined || !Number.isFinite(v)) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    const [a, b] = niceRange(min, max);
    return { unit, min: a, max: b };
  });
  const y = (ax: Axis, v: number): number =>
    T + (1 - (v - ax.min) / (ax.max - ax.min || 1)) * plotH;

  const svg = svgEl('svg', { width: W, height: H, class: 'diagChart', viewBox: `0 0 ${W} ${H}` });
  svg.appendChild(
    svgEl('rect', { x: L, y: T, width: W - L - R, height: plotH, class: 'diagPlotBg' }),
  );
  // Time grid.
  for (const t of axisTicks(win.t0, win.t1, 6)) {
    svg.appendChild(svgEl('line', { x1: x(t), x2: x(t), y1: T, y2: T + plotH, class: 'diagGrid' }));
    const lab = svgEl('text', {
      x: x(t),
      y: T + plotH + 14,
      class: 'diagTick',
      'text-anchor': 'middle',
    });
    lab.textContent = `${t}`;
    svg.appendChild(lab);
  }
  const tl = svgEl('text', {
    x: W - R,
    y: T + plotH + 24,
    class: 'diagTick',
    'text-anchor': 'end',
  });
  tl.textContent = 't [s]';
  svg.appendChild(tl);
  // Value axes: the first left, the second right.
  axes.slice(0, 2).forEach((ax, k) => {
    for (const v of axisTicks(ax.min, ax.max, 5)) {
      if (k === 0)
        svg.appendChild(
          svgEl('line', { x1: L, x2: W - R, y1: y(ax, v), y2: y(ax, v), class: 'diagGrid' }),
        );
      const lab = svgEl('text', {
        x: k === 0 ? L - 4 : W - R + 4,
        y: y(ax, v) + 3,
        class: 'diagTick',
        'text-anchor': k === 0 ? 'end' : 'start',
      });
      lab.textContent = fmt(v);
      svg.appendChild(lab);
    }
    const u = svgEl('text', {
      x: k === 0 ? 4 : W - 4,
      y: T + 10,
      class: 'diagUnitLabel',
      'text-anchor': k === 0 ? 'start' : 'end',
    });
    u.textContent = ax.unit;
    svg.appendChild(u);
  });
  // The curves (at most ~1500 points each).
  for (const { s, color } of series) {
    const ax = axes[units.indexOf(s.unit)]!;
    const extra = units.indexOf(s.unit) >= 2;
    const idx: number[] = [];
    for (let i = 0; i < run.t.length; i++)
      if (run.t[i]! >= win.t0 && run.t[i]! <= win.t1) idx.push(i);
    const stride = Math.max(1, Math.ceil(idx.length / 1500));
    let d0 = '';
    let pen = false;
    const pts: Array<[number, number]> = [[win.t0, valueAtTime(run, s, win.t0)]];
    for (let k = 0; k < idx.length; k += stride)
      pts.push([run.t[idx[k]!]!, s.values[idx[k]!] ?? Number.NaN]);
    pts.push([win.t1, valueAtTime(run, s, win.t1)]);
    for (const [t, v] of pts) {
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      d0 += `${pen ? 'L' : 'M'}${x(t).toFixed(1)} ${y(ax, v).toFixed(1)} `;
      pen = true;
    }
    svg.appendChild(
      svgEl('path', {
        d: d0 || 'M0 0',
        stroke: color,
        class: 'diagLine',
        ...(extra ? { 'stroke-dasharray': '5 3' } : {}),
      }),
    );
  }
  // Signals under the plot: a bar while on.
  sigs.forEach(([name, changes], k) => {
    const yy = T + plotH + 30 + k * 14;
    const lab = svgEl('text', { x: L - 4, y: yy + 4, class: 'diagTick', 'text-anchor': 'end' });
    lab.textContent = name;
    svg.appendChild(lab);
    svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'diagSigBase' }));
    for (let i = 0; i < changes.length; i++) {
      if (!changes[i]!.on) continue;
      const a = Math.max(win.t0, changes[i]!.t);
      const b = Math.min(win.t1, changes[i + 1]?.t ?? run.t[run.t.length - 1]!);
      if (b <= a) continue;
      svg.appendChild(
        svgEl('rect', {
          x: x(a),
          y: yy - 4,
          width: Math.max(1, x(b) - x(a)),
          height: 8,
          class: 'diagSigOn',
        }),
      );
      // The moment it switched on, through the plot.
      if (changes[i]!.t >= win.t0 && i > 0)
        svg.appendChild(
          svgEl('line', { x1: x(a), x2: x(a), y1: T, y2: T + plotH, class: 'diagSigMark' }),
        );
    }
  });
  host.replaceChildren(svg);
}

function statsTable(run: Run, d: DiagramConfig, win: { t0: number; t1: number }): HTMLElement {
  const table = el('table', 'diagStats');
  const head = el('tr');
  for (const h of ['', 'Quantity', 'Start', 'End', 'Min', 'Max', 'Average', 'Integral', ''])
    head.appendChild(el('th', undefined, h));
  table.appendChild(head);
  d.series.forEach((ref, i) => {
    const s = run.series.get(seriesId(ref.compId, ref.key));
    const tr = el('tr');
    const dot = el('td');
    dot.appendChild(el('span', 'diagDot')).style.background = COLORS[i % COLORS.length]!;
    tr.appendChild(dot);
    tr.appendChild(el('td', 'diagName', `${seriesName(run, ref)}${s ? ` [${s.unit}]` : ''}`));
    if (s) {
      const st = seriesStats(run, s, win.t0, win.t1);
      const iu = integralUnit(s.unit);
      for (const v of [st.start, st.end, st.min, st.max, st.mean])
        tr.appendChild(el('td', 'diagNum', fmt(v)));
      tr.appendChild(el('td', 'diagNum', iu ? `${fmt(st.integral)} ${iu.unit}` : '–'));
    } else {
      for (let k = 0; k < 6; k++) tr.appendChild(el('td', 'diagNum', '–'));
    }
    const x = el('td');
    const rm = el('button', 'diagRemove', '×');
    rm.title = 'Remove from the diagram';
    rm.addEventListener('click', () => {
      d.series.splice(i, 1);
      diagramsChanged();
    });
    x.appendChild(rm);
    tr.appendChild(x);
    table.appendChild(tr);
  });
  return table;
}

const MEASURES: Array<{ value: RatioMeasure; label: string }> = [
  { value: 'integral', label: 'integral (energy, volume…)' },
  { value: 'mean', label: 'average' },
  { value: 'max', label: 'maximum' },
];

/** The ratios worked out from the diagram's quantities, each editable. */
function ratiosBlock(
  run: Run | null,
  d: DiagramConfig,
  win: { t0: number; t1: number } | null,
): HTMLElement {
  const box = el('div', 'diagRatios');
  const refOptions = (sel: HTMLSelectElement, cur: SeriesRef): void => {
    d.series.forEach((r) => sel.append(new Option(seriesName(run, r), `${r.compId}|${r.key}`)));
    sel.value = `${cur.compId}|${cur.key}`;
  };
  d.ratios.forEach((rc, i) => {
    const row = el('div', 'diagRatio');
    const name = el('input', 'diagRatioName');
    name.value = rc.label;
    name.addEventListener('change', () => {
      rc.label = name.value || 'Ratio';
      diagramsChanged();
    });
    const num = el('select');
    refOptions(num, rc.num);
    const den = el('select');
    refOptions(den, rc.den);
    const measure = el('select');
    for (const m of MEASURES) measure.append(new Option(m.label, m.value));
    measure.value = rc.measure;
    const read = (sel: HTMLSelectElement): SeriesRef => {
      const [id, key] = sel.value.split('|');
      return { compId: Number(id), key: key! };
    };
    num.addEventListener('change', () => {
      rc.num = read(num);
      diagramsChanged();
    });
    den.addEventListener('change', () => {
      rc.den = read(den);
      diagramsChanged();
    });
    measure.addEventListener('change', () => {
      rc.measure = measure.value as RatioMeasure;
      diagramsChanged();
    });
    let result = '–';
    if (run && win) {
      const a = run.series.get(seriesId(rc.num.compId, rc.num.key));
      const b = run.series.get(seriesId(rc.den.compId, rc.den.key));
      if (a && b) {
        const r = ratio(run, a, b, rc.measure, win.t0, win.t1);
        result = Number.isFinite(r) ? `${fmt(r * 100)} %` : '–';
      }
    }
    const rm = el('button', 'diagRemove', '×');
    rm.title = 'Remove this ratio';
    rm.addEventListener('click', () => {
      d.ratios.splice(i, 1);
      diagramsChanged();
    });
    row.append(
      name,
      el('span', 'diagEq', '='),
      num,
      el('span', 'diagEq', '÷'),
      den,
      el('span', 'diagEq', 'by'),
      measure,
      el('b', 'diagRatioValue', result),
      rm,
    );
    box.appendChild(row);
  });
  const add = el('button', 'linkBtn', '+ Ratio (e.g. efficiency)');
  add.disabled = d.series.length < 2;
  add.title = d.series.length < 2 ? 'Add two quantities to the diagram first' : '';
  add.addEventListener('click', () => {
    const [a, b] = [d.series[d.series.length - 1]!, d.series[0]!];
    d.ratios.push({ label: 'Efficiency', num: { ...a }, den: { ...b }, measure: 'integral' });
    diagramsChanged();
  });
  box.appendChild(add);
  return box;
}

function diagramCard(d: DiagramConfig): HTMLElement {
  const run = currentRun();
  const card = el('section', 'diagCard');
  const head = el('div', 'diagHead');
  const title = el('input', 'diagTitle');
  title.value = d.title;
  title.addEventListener('change', () => {
    d.title = title.value || 'Diagram';
    diagramsChanged();
  });
  const rm = el('button', 'diagRemove', '×');
  rm.title = 'Remove this diagram';
  rm.addEventListener('click', () => removeDiagram(d.id));
  head.append(title, rm);

  const window = el('div', 'diagWindow');
  window.append(
    el('span', undefined, 'From'),
    eventControl(d.from, run, (e) => {
      d.from = e;
      diagramsChanged();
    }),
    el('span', undefined, 'to'),
    eventControl(d.to, run, (e) => {
      d.to = e;
      diagramsChanged();
    }),
  );

  const chart = el('div', 'diagChartBox');
  const info = el('p', 'diagInfo');
  const stats = el('div');
  const ratios = el('div');
  const picker = quantityPicker(run, d, (r) => {
    d.series.push(r);
    diagramsChanged();
  });
  card.append(head, window, chart, info, stats, picker, ratios);

  const update = (): void => {
    const r = currentRun();
    const win = r ? eventWindow(r, d.from, d.to) : null;
    if (!r || r.t.length === 0) {
      chart.replaceChildren(el('p', 'diagEmpty', 'Nothing recorded yet - run the simulation.'));
      info.textContent = '';
      stats.replaceChildren();
    } else if (!win) {
      chart.replaceChildren(
        el(
          'p',
          'diagEmpty',
          `The window's events didn't both happen in this run (${eventLabel(d.from)} → ${eventLabel(d.to)}).`,
        ),
      );
      info.textContent = '';
      stats.replaceChildren();
    } else {
      drawChart(chart, r, d, win);
      info.textContent = `${eventLabel(d.from)} → ${eventLabel(d.to)}: ${fmt(win.t0)} – ${fmt(win.t1)} s (${fmt(win.t1 - win.t0)} s)`;
      stats.replaceChildren(
        d.series.length
          ? statsTable(r, d, win)
          : el('p', 'diagEmpty', 'Add quantities to plot below.'),
      );
    }
    ratios.replaceChildren(ratiosBlock(r, d, win));
  };
  updaters.push(update);
  update();
  return card;
}

function exportCsv(): void {
  const run = currentRun();
  if (!run || run.t.length === 0) return;
  const series = [...run.series.values()];
  const sigNames = [...run.signals.keys()];
  const head = [
    't [s]',
    ...series.map((s) => `${componentName(s.compId)}: ${s.label} [${s.unit}]`),
    ...sigNames.map((n) => `${n} [on]`),
  ];
  const q = (v: string): string => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [head.map(q).join(',')];
  const sigIdx = sigNames.map(() => 0);
  for (let i = 0; i < run.t.length; i++) {
    const t = run.t[i]!;
    const row = [t.toFixed(4)];
    for (const s of series) {
      const v = s.values[i];
      row.push(v === undefined || !Number.isFinite(v) ? '' : String(Number(v.toPrecision(6))));
    }
    sigNames.forEach((n, k) => {
      const ch = run.signals.get(n)!;
      while (sigIdx[k]! + 1 < ch.length && ch[sigIdx[k]! + 1]!.t <= t) sigIdx[k]!++;
      row.push(ch[sigIdx[k]!]!.on ? '1' : '0');
    });
    lines.push(row.join(','));
  }
  const stamp = run.startedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv' }), `recording ${stamp}.csv`);
}

function render(): void {
  if (!panel) return;
  updaters.length = 0;
  const body = panel.querySelector<HTMLElement>('.diagBody')!;
  const scroll = body.scrollTop;
  body.replaceChildren();
  const run = currentRun();
  const status = panel.querySelector<HTMLElement>('.diagStatus')!;
  status.textContent =
    run && run.t.length
      ? `Recorded: ${fmt(run.t[run.t.length - 1]!)} s, ${run.series.size} quantities, ${run.signals.size} signals`
      : 'Nothing recorded yet';
  const list = listDiagrams();
  if (list.length === 0) {
    body.appendChild(
      el(
        'p',
        'diagEmpty',
        'Every run of the simulation is recorded: cylinder and motor positions, speeds and forces, ' +
          'pump flows and powers, and every button and sensor. Add a diagram to plot them, between ' +
          'any two events, and work out efficiencies.',
      ),
    );
  }
  for (const d of list) body.appendChild(diagramCard(d));
  body.scrollTop = scroll;
}

/** Live while running: the plots and figures follow the recording a few times a second. */
function scheduleLive(): void {
  if (!panel || liveTimer) return;
  liveTimer = setTimeout(() => {
    liveTimer = null;
    if (!panel) return;
    const run = currentRun();
    const status = panel.querySelector<HTMLElement>('.diagStatus');
    if (status && run) {
      status.textContent = `Recorded: ${fmt(run.t[run.t.length - 1] ?? 0)} s, ${run.series.size} quantities, ${run.signals.size} signals`;
    }
    for (const u of updaters) u();
  }, 250);
}

let wired = false;

export function isDiagramPanelOpen(): boolean {
  return panel !== null;
}

export function closeDiagramPanel(): void {
  panel?.remove();
  panel = null;
}

export function openDiagramPanel(): void {
  if (panel) {
    closeDiagramPanel();
    return;
  }
  if (!wired) {
    wired = true;
    onDiagramsChange(render);
    onRecording(scheduleLive);
    // A new run, or a component renamed or removed: rebuilt (the quantity lists change).
    appState.onModeChange(render);
  }
  panel = el('div', 'diagPanel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Diagrams');
  const header = el('div', 'diagPanelHeader');
  header.appendChild(el('b', undefined, 'Diagrams'));
  header.appendChild(el('span', 'diagStatus'));
  const add = el('button', 'btn', '+ Diagram');
  add.addEventListener('click', () => newDiagram());
  const csv = el('button', 'btn', 'Export CSV');
  csv.title = 'Everything recorded in this run, a column per quantity and signal';
  csv.addEventListener('click', exportCsv);
  const close = el('button', 'exportDialogClose', '✕');
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', closeDiagramPanel);
  header.append(add, csv, close);
  const body = el('div', 'diagBody');
  panel.append(header, body);
  document.body.appendChild(panel);

  // Moved by its header.
  header.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = panel!.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const move = (ev: PointerEvent): void => {
      panel!.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dx))}px`;
      panel!.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy))}px`;
      panel!.style.right = 'auto';
      panel!.style.bottom = 'auto';
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  render();
}
