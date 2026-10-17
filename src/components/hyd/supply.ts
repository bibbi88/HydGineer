import type { Component, SimStepContext } from '../../core/types';
import type { HydElement } from '../../sim/hydraulics';
import { createPort, createPortLabel, createSvgEl } from '../shared/svgHelpers';
import { getSignal } from '../../sim/signals';
import {
  INK,
  STROKE,
  adjustArrow,
  arrowLine,
  createHydShell,
  fmtBar,
  fmtFlow,
  hydComponentBase,
  line,
  nameSnapshot,
  path,
  readNum,
  restoreName,
  springH,
  tankGlyph,
} from './base';

export const HYD_PUMP_TYPE = 'hydPump';
export const HYD_TANK_TYPE = 'hydTank';
export const HYD_RELIEF_TYPE = 'hydRelief';
export const HYD_GAUGE_TYPE = 'hydGauge';
export const HYD_PRESSURE_SWITCH_TYPE = 'hydPressureSwitch';

/** Pressure (bar) at which an unprotected pump outlet is capped - standing in for whatever
 * would burst first. A circuit reaching it has no working pressure relief. */
export const PUMP_BURST_PRESSURE = 1000;

/** Relief valve characteristic: flow per bar above the cracking pressure (pressure override). */
export const RELIEF_GAIN = 10;

/**
 * Fixed-displacement pump driven by an electric motor, drawing from its own tank.
 *
 * Theoretical flow Q = V·n (displacement × speed); internal leakage grows linearly with outlet
 * pressure so the delivered flow at rated pressure is Q·ηv. A positive-displacement pump always
 * delivers its flow - with nowhere for it to go (no relief valve) the pressure rises until
 * something gives, which is shown as an overpressure warning.
 *
 * The motor can be left always on, or switched by a named signal (e.g. a relay coil "M1").
 */
export function createHydPump(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 100;
  const svgH = 120;
  const shell = createHydShell(compLayer, HYD_PUMP_TYPE, x, y, svgW, svgH, 'Pump', {
    x: 18,
    y: 26,
    w: 76,
    h: 86,
  });
  const g = shell.g;
  const cx = 40;
  const cy = 50;
  const r = 18;
  g.appendChild(
    createSvgEl('circle', { cx, cy, r, fill: '#fff', stroke: INK, 'stroke-width': STROKE }),
  );
  // Filled triangle pointing outwards = hydraulic pump (outlet at the top).
  g.appendChild(
    createSvgEl('polygon', {
      points: `${cx},${cy - r + 1} ${cx - 8},${cy - r + 14} ${cx + 8},${cy - r + 14}`,
      fill: INK,
    }),
  );
  line(g, cx, 10, cx, cy - r);
  // Drive shaft and electric motor.
  line(g, cx + r, cy - 2, 71, cy - 2, { 'stroke-width': 1.5 });
  line(g, cx + r, cy + 2, 71, cy + 2, { 'stroke-width': 1.5 });
  const motor = createSvgEl('circle', {
    cx: 82,
    cy,
    r: 11,
    fill: '#fff',
    stroke: INK,
    'stroke-width': STROKE,
  });
  g.appendChild(motor);
  const m = createSvgEl('text', {
    x: 82,
    y: cy + 4,
    'text-anchor': 'middle',
    'font-size': 11,
    'font-weight': 600,
  });
  m.textContent = 'M';
  g.appendChild(m);
  // Suction line to the reservoir.
  line(g, cx, cy + r, cx, 92);
  tankGlyph(g, cx, 88, 32, 16);
  const signalText = createSvgEl('text', {
    x: 82,
    y: cy - 16,
    'text-anchor': 'middle',
    'font-size': 10,
  });
  g.appendChild(signalText);

  const ports = { P: createPort(g, 'P', cx, 10, 'V') };
  shell.setInfoSide('right');

  let displacement = 10; // cm³/rev
  let speed = 1450; // rpm
  let etaV = 95; // %
  let ratedPressure = 250; // bar
  let signal = '';
  let running = true;

  function theoreticalFlow(): number {
    return (displacement * speed) / 1000;
  }
  function refresh(): void {
    signalText.textContent = signal.trim();
    motor.setAttribute('fill', running ? '#d8f5dc' : '#fff');
  }
  refresh();

  const comp = hydComponentBase(shell, HYD_PUMP_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    recompute(): void {
      const next = signal.trim() === '' || getSignal(signal);
      if (next !== running) {
        running = next;
        refresh();
      }
    },
    hydElements(): HydElement[] {
      if (!running) return [];
      const q = theoreticalFlow();
      const leak = (q * (1 - etaV / 100)) / Math.max(1, ratedPressure);
      return [
        { kind: 'pump', out: 'P', q, leak },
        { kind: 'tank', a: '_S' },
        { kind: 'relief', a: 'P', b: '_S', set: PUMP_BURST_PRESSURE, gain: 100 },
      ];
    },
    step(_dt: number, ctx: SimStepContext): void {
      const p = ctx.pressureAt('P');
      const q = running ? ctx.elementValue(0) : 0;
      const lines = running
        ? [`Q ${fmtFlow(q)}`, `p ${fmtBar(p)}`, `P ${((p * q) / 600).toFixed(2)} kW`]
        : ['motor off'];
      if (running && p > ratedPressure) lines.push('⚠ above rated pressure');
      if (running && p > PUMP_BURST_PRESSURE * 0.95) lines.push('⚠ no pressure relief!');
      shell.setInfo(lines);
    },
    snapshot(): Record<string, unknown> {
      return { ...nameSnapshot(shell), displacement, speed, etaV, ratedPressure, signal };
    },
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      displacement = readNum(data, 'displacement', displacement, 0, 1000);
      speed = readNum(data, 'speed', speed, 0, 10000);
      etaV = readNum(data, 'etaV', etaV, 50, 100);
      ratedPressure = readNum(data, 'ratedPressure', ratedPressure, 1, 1000);
      if (typeof data.signal === 'string') signal = data.signal;
      running = signal.trim() === '';
      refresh();
    },
    reset(): void {
      running = signal.trim() === '';
      refresh();
      shell.setInfo([]);
    },
  });
}

/** Reservoir connection - a return line ends here at 0 bar (gauge). */
export function createHydTank(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 40;
  const svgH = 40;
  const shell = createHydShell(compLayer, HYD_TANK_TYPE, x, y, svgW, svgH, 'Tank', {
    x: 3,
    y: 10,
    w: 34,
    h: 24,
  });
  tankGlyph(shell.g, 20, 10, 30, 14);
  const ports = { T: createPort(shell.g, 'T', 20, 10, 'V') };
  const comp = hydComponentBase(shell, HYD_TANK_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [{ kind: 'tank', a: 'T' }],
    snapshot: () => nameSnapshot(shell),
    restore: (data: Record<string, unknown>) => restoreName(shell, data),
    step(_dt: number, ctx: SimStepContext): void {
      const q = -ctx.flowAt('T');
      shell.setInfo(Math.abs(q) >= 0.005 ? [fmtFlow(q)] : []);
    },
    reset: () => shell.setInfo([]),
  });
}

/**
 * Direct-operated pressure relief valve, P → T. Closed until the inlet pressure reaches the
 * setting; beyond that it opens just far enough to pass whatever flow is needed to keep it
 * there (plus a small override: RELIEF_GAIN L/min per bar).
 */
export function createHydRelief(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 80;
  const svgH = 100;
  const shell = createHydShell(compLayer, HYD_RELIEF_TYPE, x, y, svgW, svgH, 'Relief valve', {
    x: 10,
    y: 26,
    w: 66,
    h: 48,
  });
  const g = shell.g;
  g.appendChild(
    createSvgEl('rect', {
      x: 25,
      y: 30,
      width: 30,
      height: 40,
      fill: '#fff',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  line(g, 40, 10, 40, 30);
  line(g, 40, 70, 40, 90);
  const arrowG = createSvgEl('g', { class: 'hydSpool' });
  g.appendChild(arrowG);
  // Normally closed: the flow arrow sits off the P-T line until the valve opens.
  arrowLine(arrowG, 47, 36, 47, 64);
  springH(g, 55, 75, 50);
  adjustArrow(g, 65, 50, 10);
  // Pilot line from the inlet.
  path(g, 'M 40 20 H 14 V 60 H 25', { 'stroke-dasharray': '4 3', 'stroke-width': 1.5 });
  createPortLabel(g, 47, 14, 'P', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, 47, 96, 'T', { anchor: 'start', fontSize: 10 });
  const setText = createSvgEl('text', { x: 58, y: 34, 'font-size': 10 });
  g.appendChild(setText);

  const ports = {
    P: createPort(g, 'P', 40, 10, 'V'),
    T: createPort(g, 'T', 40, 90, 'V'),
  };
  let setting = 100;
  function refresh(): void {
    setText.textContent = `${setting} bar`;
  }
  refresh();

  const comp = hydComponentBase(shell, HYD_RELIEF_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      { kind: 'relief', a: 'P', b: 'T', set: setting, gain: RELIEF_GAIN },
    ],
    step(_dt: number, ctx: SimStepContext): void {
      const q = ctx.elementValue(0);
      const open = q > 0.01;
      arrowG.setAttribute('transform', open ? 'translate(-7,0)' : '');
      shell.setInfo(
        open ? [`Q ${fmtFlow(q)}`, `Δp ${fmtBar(ctx.pressureAt('P') - ctx.pressureAt('T'))}`] : [],
      );
    },
    snapshot: () => ({ ...nameSnapshot(shell), setting }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      setting = readNum(data, 'setting', setting, 0, 700);
      refresh();
    },
    reset(): void {
      arrowG.setAttribute('transform', '');
      shell.setInfo([]);
    },
  });
}

/** Pressure gauge: reads the pressure of the line it is connected to. */
export function createHydGauge(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 40;
  const svgH = 60;
  const shell = createHydShell(compLayer, HYD_GAUGE_TYPE, x, y, svgW, svgH, 'Pressure gauge', {
    x: 4,
    y: 8,
    w: 32,
    h: 32,
  });
  const g = shell.g;
  g.appendChild(
    createSvgEl('circle', {
      cx: 20,
      cy: 24,
      r: 14,
      fill: '#fff',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  const needle = createSvgEl('g');
  g.appendChild(needle);
  arrowLine(needle, 20, 24, 29, 15);
  line(g, 20, 38, 20, 50);
  const ports = { P: createPort(g, 'P', 20, 50, 'V') };
  shell.setInfoSide('right');
  let range = 250;
  const comp = hydComponentBase(shell, HYD_GAUGE_TYPE, x, y, svgW, svgH, ports);
  function setNeedle(p: number): void {
    // Needle sweeps 270° from -225° (0) to +45° (full scale).
    const frac = Math.max(0, Math.min(1, p / range));
    const deg = -225 + 270 * frac + 45;
    needle.setAttribute('transform', `rotate(${deg} 20 24)`);
  }
  setNeedle(0);
  return Object.assign(comp, {
    step(_dt: number, ctx: SimStepContext): void {
      const p = ctx.pressureAt('P');
      setNeedle(p);
      shell.setInfo([fmtBar(p)]);
    },
    snapshot: () => ({ ...nameSnapshot(shell), range }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      range = readNum(data, 'range', range, 1, 1000);
    },
    reset(): void {
      setNeedle(0);
      shell.setInfo([]);
    },
  });
}

/**
 * Pressure switch: publishes its signal (e.g. "S1") while the pressure is at or above the
 * setting, with a small hysteresis so it doesn't chatter. Electrical contacts and PLC inputs
 * bound to the same name follow it.
 */
export function createHydPressureSwitch(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 60;
  const svgH = 60;
  const shell = createHydShell(
    compLayer,
    HYD_PRESSURE_SWITCH_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Pressure switch',
    { x: 8, y: 8, w: 44, h: 34 },
  );
  const g = shell.g;
  g.appendChild(
    createSvgEl('rect', {
      x: 12,
      y: 12,
      width: 36,
      height: 24,
      fill: '#fff',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  // Electrical changeover glyph inside.
  line(g, 18, 28, 26, 28, { 'stroke-width': 1.5 });
  const blade = line(g, 26, 28, 38, 20, { 'stroke-width': 1.5 });
  line(g, 38, 28, 42, 28, { 'stroke-width': 1.5 });
  path(g, 'M 30 50 V 36', { 'stroke-dasharray': '4 3', 'stroke-width': 1.5 });
  const keyText = createSvgEl('text', { x: 30, y: 9, 'text-anchor': 'middle', 'font-size': 10 });
  g.appendChild(keyText);
  const ports = { P: createPort(g, 'P', 30, 50, 'V') };
  shell.setInfoSide('right');
  let setting = 50;
  let key = 'S1';
  let on = false;
  function refresh(): void {
    keyText.textContent = `${key} ≥ ${setting} bar`;
    blade.setAttribute('y2', on ? '28' : '20');
  }
  refresh();
  const comp = hydComponentBase(shell, HYD_PRESSURE_SWITCH_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    step(_dt: number, ctx: SimStepContext): void {
      const p = ctx.pressureAt('P');
      const hyst = Math.max(0.5, setting * 0.05);
      const next = on ? p >= setting - hyst : p >= setting;
      if (next !== on) {
        on = next;
        refresh();
      }
      if (key.trim()) ctx.emitSignal(key, on);
      shell.setInfo([`${fmtBar(p)} · ${on ? 'ON' : 'off'}`]);
    },
    snapshot: () => ({ ...nameSnapshot(shell), setting, key }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      setting = readNum(data, 'setting', setting, 0, 700);
      if (typeof data.key === 'string') key = data.key;
      refresh();
    },
    reset(): void {
      on = false;
      refresh();
      shell.setInfo([]);
    },
  });
}
