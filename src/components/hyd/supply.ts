import type { Component, SimStepContext } from '../../core/types';
import { accumulatorOil, type HydElement } from '../../sim/hydraulics';
import { uid } from '../../core/ids';
import { createPort, createPortLabel, createSvgEl } from '../shared/svgHelpers';
import { clearFlow, paintFlow } from './flowPaint';
import { getSignal } from '../../sim/signals';
import { appState } from '../../app/AppState';
import { Modes } from '../../app/modes';
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
export const HYD_PUMP_LS_TYPE = 'hydPumpLS';
export const HYD_TANK_TYPE = 'hydTank';
export const HYD_RELIEF_TYPE = 'hydRelief';
export const HYD_GAUGE_TYPE = 'hydGauge';
export const HYD_PRESSURE_SWITCH_TYPE = 'hydPressureSwitch';
export const HYD_ACCUMULATOR_TYPE = 'hydAccumulator';
export const HYD_PUMP_LOOP_TYPE = 'hydPumpLoop';

/** Pressure (bar) at which an unprotected pump outlet is capped - standing in for whatever
 * would burst first. A circuit reaching it has no working pressure relief. */
export const PUMP_BURST_PRESSURE = 1000;

/** Pressure band (bar) below its setting over which a compensated pump swivels back to zero. */
export const PC_BAND = 5;

/** Pressure band (bar) over which a load-sensing pump's flow controller regulates. */
export const LS_BAND = 3;
/** Bleed orifice (L/min per √bar) from an LS pump's LS port to tank, which lets the LS line
 * fall back once no valve is signalling - a few tenths of a L/min at working pressure. */
export const LS_BLEED_K = 0.02;

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
 *
 * The 'ls' variant is a load-sensing pump: variable displacement with an LS port. Its flow
 * controller holds the outlet at the highest load pressure signalled on LS plus a margin
 * (standby pressure, typically 15-30 bar), so the pump delivers exactly the flow the valves
 * meter out, at only the pressure the heaviest load needs; a pressure cut-off limits the
 * maximum. With no valve open the LS line is vented and the pump idles at standby pressure.
 */
export function createHydPump(
  compLayer: HTMLElement,
  x: number,
  y: number,
  variant: 'standard' | 'ls' = 'standard',
): Component {
  const isLS = variant === 'ls';
  const type = isLS ? HYD_PUMP_LS_TYPE : HYD_PUMP_TYPE;
  const svgW = 100;
  const svgH = 120;
  const shell = createHydShell(compLayer, type, x, y, svgW, svgH, 'Pump', {
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
  // Variable displacement with pressure compensator: the swash-plate arrow through the pump,
  // and the compensator's pilot line from the outlet against its spring.
  const pcG = createSvgEl('g');
  g.appendChild(pcG);
  adjustArrow(pcG, cx, cy, 22);
  if (!isLS) {
    path(pcG, `M ${cx} 20 H 8 V ${cy + 22} H ${cx - 12}`, {
      'stroke-dasharray': '4 3',
      'stroke-width': 1.5,
    });
  }
  springH(pcG, cx - 30, cx - 12, cy + 30, 4);
  const compText = createSvgEl('text', { x: 4, y: 16, 'font-size': 9 });
  pcG.appendChild(compText);
  // LS variant: the load-sensing line from the LS port to the flow controller.
  const lsLine: SVGElement[] = [];
  if (isLS) {
    const l = path(g, `M 10 60 H 16 V ${cy + 22} H ${cx - 12}`, {
      'stroke-dasharray': '4 3',
      'stroke-width': 1.5,
    });
    l.dataset.nodash = '1';
    lsLine.push(l);
    createPortLabel(g, 10, 50, 'LS', { anchor: 'middle', fontSize: 9 });
  }

  const ports: Record<string, ReturnType<typeof createPort>> = {
    P: createPort(g, 'P', cx, 10, 'V'),
  };
  if (isLS) ports.LS = createPort(g, 'LS', 10, 60, 'H', { isPilot: true, pilotDir: -1 });
  shell.setInfoSide('right');

  let displacement = 10; // cm³/rev
  let speed = 1450; // rpm
  let etaV = 95; // %
  let ratedPressure = 250; // bar
  let signal = '';
  let running = true;
  /** 'fixed' displacement, or 'pc': variable displacement with a pressure compensator. */
  let control: 'fixed' | 'pc' = 'fixed';
  let compSetting = isLS ? 250 : 150; // bar - for the LS pump, its maximum pressure cut-off
  let margin = 20; // bar - LS pump: pressure kept above the highest load

  function theoreticalFlow(): number {
    return (displacement * speed) / 1000;
  }
  /** The motor runs with no signal set, while the named signal is on, or - written "!S1" -
   * while it is off (e.g. charging an accumulator until a pressure switch cuts the pump out). */
  function signalSaysRun(): boolean {
    const sig = signal.trim();
    if (sig === '') return true;
    if (sig.startsWith('!')) return !getSignal(sig.slice(1));
    return getSignal(sig);
  }
  function refresh(): void {
    signalText.textContent = signal.trim();
    motor.setAttribute('fill', running ? '#d8f5dc' : '#fff');
    const variable = isLS || control === 'pc';
    pcG.style.display = variable ? '' : 'none';
    compText.textContent = isLS
      ? `Δp ${margin} · max ${compSetting} bar`
      : control === 'pc'
        ? `${compSetting} bar`
        : '';
    shell.setDefaultName(
      isLS ? 'Load-sensing pump' : control === 'pc' ? 'Pump (pressure compensated)' : 'Pump',
    );
  }
  refresh();

  const comp = hydComponentBase(shell, type, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    recompute(): void {
      const next = signalSaysRun();
      if (next !== running) {
        running = next;
        refresh();
      }
    },
    hydElements(): HydElement[] {
      if (!running) return [];
      const q = theoreticalFlow();
      const leak = (q * (1 - etaV / 100)) / Math.max(1, ratedPressure);
      if (isLS) {
        return [
          { kind: 'pump', out: 'P', q, leak, comp: compSetting, band: LS_BAND, x: 'LS', margin },
          { kind: 'tank', a: '_S' },
          { kind: 'relief', a: 'P', b: '_S', set: PUMP_BURST_PRESSURE, gain: 100 },
          { kind: 'orifice', a: 'LS', b: '_S', k: LS_BLEED_K },
        ];
      }
      return [
        control === 'pc'
          ? { kind: 'pump', out: 'P', q, leak, comp: compSetting, band: PC_BAND }
          : { kind: 'pump', out: 'P', q, leak },
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
      if (isLS) {
        const pls = ctx.pressureAt('LS');
        paintFlow(lsLine, pls, 0);
        if (running) lines.splice(2, 0, `LS ${fmtBar(pls)} (Δp ${fmtBar(p - pls)})`);
      }
      if (running && (isLS || control === 'pc')) {
        // Swivel angle as a share of full displacement: what's delivered plus what leaks.
        const qTheo = theoreticalFlow();
        const leak = (qTheo * (1 - etaV / 100)) / Math.max(1, ratedPressure);
        const share = qTheo > 0 ? (q + leak * Math.max(0, p)) / qTheo : 0;
        lines.splice(1, 0, `displacement ${(Math.min(1, share) * 100).toFixed(0)} %`);
      }
      if (running && p > ratedPressure) lines.push('⚠ above rated pressure');
      if (running && p > PUMP_BURST_PRESSURE * 0.95) lines.push('⚠ no pressure relief!');
      shell.setInfo(lines);
    },
    snapshot(): Record<string, unknown> {
      return {
        ...nameSnapshot(shell),
        displacement,
        speed,
        etaV,
        ratedPressure,
        signal,
        ...(isLS ? { margin } : { control }),
        compSetting,
      };
    },
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      displacement = readNum(data, 'displacement', displacement, 0, 1000);
      speed = readNum(data, 'speed', speed, 0, 10000);
      etaV = readNum(data, 'etaV', etaV, 50, 100);
      ratedPressure = readNum(data, 'ratedPressure', ratedPressure, 1, 1000);
      if (typeof data.signal === 'string') signal = data.signal;
      if (data.control === 'fixed' || data.control === 'pc') control = data.control;
      compSetting = readNum(data, 'compSetting', compSetting, 1, 1000);
      margin = readNum(data, 'margin', margin, 1, 100);
      running = signal.trim() === '' || signal.trim().startsWith('!');
      refresh();
    },
    reset(): void {
      running = signal.trim() === '' || signal.trim().startsWith('!');
      refresh();
      shell.setInfo([]);
      clearFlow(lsLine);
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
  // Flow path drawn P (top) → T (bottom).
  const pLead = [line(g, 40, 10, 40, 30)];
  const tLead = [line(g, 40, 70, 40, 90)];
  const arrowG = createSvgEl('g', { class: 'hydSpool' });
  g.appendChild(arrowG);
  // Normally closed: the flow arrow sits off the P-T line until the valve opens.
  const throughArrow = arrowLine(arrowG, 47, 36, 47, 64);
  springH(g, 55, 75, 50);
  adjustArrow(g, 65, 50, 10);
  // Pilot line from the inlet.
  const pilotLine = [
    path(g, 'M 40 20 H 14 V 60 H 25', { 'stroke-dasharray': '4 3', 'stroke-width': 1.5 }),
  ];
  pilotLine[0]!.dataset.nodash = '1';
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
      const pP = ctx.pressureAt('P');
      paintFlow(pLead, pP, q);
      paintFlow(throughArrow, pP, q);
      paintFlow(tLead, ctx.pressureAt('T'), q);
      paintFlow(pilotLine, pP, 0);
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
      clearFlow([...pLead, ...tLead, ...throughArrow, ...pilotLine]);
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

/**
 * Gas-loaded (bladder) accumulator. Pre-charged with nitrogen to p0, it takes in oil only once the
 * line pressure exceeds p0, compressing the gas: (p + 1)·V_gas^n = (p0 + 1)·V0^n in absolute bar
 * (n = 1 isothermal for slow charging, 1.4 adiabatic for fast cycles). When the line pressure
 * falls it gives the oil back - an energy store that can briefly deliver far more flow than the
 * pump. Starts empty.
 */
export function createHydAccumulator(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 60;
  const svgH = 100;
  const shell = createHydShell(compLayer, HYD_ACCUMULATOR_TYPE, x, y, svgW, svgH, 'Accumulator', {
    x: 10,
    y: 12,
    w: 40,
    h: 70,
  });
  const g = shell.g;
  const top = 14;
  const bot = 80;
  const clipId = `acc-clip-${uid()}`;
  const defs = createSvgEl('defs');
  const clip = createSvgEl('clipPath', { id: clipId });
  clip.appendChild(createSvgEl('rect', { x: 12, y: top, width: 36, height: bot - top, rx: 18 }));
  defs.appendChild(clip);
  g.appendChild(defs);
  g.appendChild(
    createSvgEl('rect', { x: 12, y: top, width: 36, height: bot - top, rx: 18, fill: '#fff' }),
  );
  // Oil (below the separator) and the separating bladder/piston line, moved with the oil level.
  const oilRect = createSvgEl('rect', {
    x: 12,
    y: bot,
    width: 36,
    height: 0,
    fill: '#cfe1f7',
    'clip-path': `url(#${clipId})`,
  });
  g.appendChild(oilRect);
  const separator = line(g, 12, 50, 48, 50);
  const gasLabel = createSvgEl('text', {
    x: 30,
    y: 32,
    'text-anchor': 'middle',
    'font-size': 9,
    fill: '#555',
  });
  gasLabel.textContent = 'N₂';
  g.appendChild(gasLabel);
  g.appendChild(
    createSvgEl('rect', {
      x: 12,
      y: top,
      width: 36,
      height: bot - top,
      rx: 18,
      fill: 'none',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  const lead = [line(g, 30, 90, 30, bot)];
  const ports = { P: createPort(g, 'P', 30, 90, 'V') };
  shell.setInfoSide('left');

  let volume = 2; // L, nominal (gas) volume
  let precharge = 60; // bar
  let n = 1.4;
  let oil = 0; // L currently held

  function params(): { volume: number; precharge: number; n: number } {
    return { volume, precharge, n };
  }
  function drawLevel(): void {
    // The separator sits at the oil level; with no oil it rests on the bottom (fully expanded
    // bladder at pre-charge pressure).
    const frac = Math.max(0, Math.min(1, oil / volume));
    const yLevel = bot - 6 - frac * (bot - top - 12);
    separator.setAttribute('y1', String(yLevel));
    separator.setAttribute('y2', String(yLevel));
    oilRect.setAttribute('y', String(yLevel));
    oilRect.setAttribute('height', String(Math.max(0, bot - yLevel)));
  }
  drawLevel();

  const comp = hydComponentBase(shell, HYD_ACCUMULATOR_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      { kind: 'accumulator', a: 'P', volume, precharge, n, oilPrev: oil },
    ],
    step(_dt: number, ctx: SimStepContext): void {
      const p = ctx.pressureAt('P');
      oil = accumulatorOil(params(), p);
      drawLevel();
      const q = ctx.elementValue(0);
      const lines = [`p ${fmtBar(p)}`, `oil ${oil.toFixed(2)} L of ${volume} L`];
      if (Math.abs(q) >= 0.005)
        lines.push(`${q > 0 ? 'charging' : 'discharging'} ${fmtFlow(Math.abs(q))}`);
      else if (p < precharge) lines.push(`below pre-charge (${precharge} bar)`);
      shell.setInfo(lines);
      paintFlow(lead, p, q);
    },
    snapshot: () => ({ ...nameSnapshot(shell), volume, precharge, n }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      volume = readNum(data, 'volume', volume, 0.01, 1000);
      precharge = readNum(data, 'precharge', precharge, 0, 700);
      n = readNum(data, 'n', n, 1, 1.4);
      drawLevel();
    },
    reset(): void {
      oil = 0;
      drawLevel();
      shell.setInfo([]);
      clearFlow(lead);
    },
  });
}

/**
 * Over-centre variable-displacement pump for closed circuits (hydrostatic transmissions). Both
 * ports are working ports: with the swash plate on one side of centre (lever right) it draws
 * from A and delivers into B, past centre the other way round, at zero it delivers nothing - so the one
 * lever sets the speed and direction of the motor it drives, steplessly.
 *
 * Its internal leakage goes to the case drain (tank) from whichever side is pressurised, so the
 * closed loop slowly loses oil - which is why a closed circuit needs a charge pump feeding the
 * low-pressure side through make-up check valves.
 */
export function createHydPumpLoop(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 100;
  const svgH = 120;
  const shell = createHydShell(
    compLayer,
    HYD_PUMP_LOOP_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Over-centre pump',
    { x: 18, y: 36, w: 76, h: 48 },
  );
  const g = shell.g;
  const cx = 40;
  const cy = 60;
  const r = 18;
  g.appendChild(
    createSvgEl('circle', { cx, cy, r, fill: '#fff', stroke: INK, 'stroke-width': STROKE }),
  );
  // Two outward triangles: a pump that can deliver from either port.
  g.appendChild(
    createSvgEl('polygon', {
      points: `${cx},${cy - r + 1} ${cx - 7},${cy - r + 12} ${cx + 7},${cy - r + 12}`,
      fill: INK,
    }),
  );
  g.appendChild(
    createSvgEl('polygon', {
      points: `${cx},${cy + r - 1} ${cx - 7},${cy + r - 12} ${cx + 7},${cy + r - 12}`,
      fill: INK,
    }),
  );
  adjustArrow(g, cx, cy, 22);
  // Leads drawn from each port into the pump.
  const leadA = [line(g, cx, 10, cx, cy - r)];
  const leadB = [line(g, cx, 110, cx, cy + r)];
  // Case drain, dashed, to its own tank.
  path(g, `M ${cx - r + 4} ${cy + 10} H 8 V 92`, {
    'stroke-dasharray': '4 3',
    'stroke-width': 1.5,
  });
  tankGlyph(g, 8, 92, 14, 8);
  // Drive shaft and electric motor.
  line(g, cx + r, cy - 2, 71, cy - 2, { 'stroke-width': 1.5 });
  line(g, cx + r, cy + 2, 71, cy + 2, { 'stroke-width': 1.5 });
  g.appendChild(
    createSvgEl('circle', {
      cx: 82,
      cy,
      r: 11,
      fill: '#d8f5dc',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  const m = createSvgEl('text', {
    x: 82,
    y: cy + 4,
    'text-anchor': 'middle',
    'font-size': 11,
    'font-weight': 600,
  });
  m.textContent = 'M';
  g.appendChild(m);
  createPortLabel(g, cx + 8, 14, 'A', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, cx + 8, 112, 'B', { anchor: 'start', fontSize: 10 });
  const ports = {
    A: createPort(g, 'A', cx, 10, 'V'),
    B: createPort(g, 'B', cx, 110, 'V'),
  };
  shell.setInfoSide('right');

  // The swash-plate lever: a slider beside the pump while simulating (see app.css).
  const lever = document.createElement('input');
  lever.type = 'range';
  lever.min = '-100';
  lever.max = '100';
  lever.step = '5';
  lever.value = '0';
  lever.className = 'swashLever';
  lever.title =
    'Swash plate: right = deliver from A, left = deliver from B, middle = zero (double-click to centre)';
  for (const ev of ['mousedown', 'pointerdown', 'click', 'dblclick'] as const) {
    lever.addEventListener(ev, (e) => e.stopPropagation());
  }
  shell.el.appendChild(lever);

  let displacement = 28; // cm³/rev at full swash
  let speed = 1500; // rpm
  let etaV = 95; // % at rated pressure
  let ratedPressure = 300; // bar
  /** Swash plate, −1 … +1. */
  let swash = 0;

  lever.addEventListener('input', () => {
    if (appState.mode === Modes.STOP) return;
    swash = Number(lever.value) / 100;
  });
  lever.addEventListener('dblclick', () => {
    swash = 0;
    lever.value = '0';
  });

  function maxFlow(): number {
    return (displacement * speed) / 1000;
  }
  /** Leakage per side, L/min per bar: (1 − ηv) of full flow lost at rated pressure. */
  function leakCoef(): number {
    return (maxFlow() * (1 - etaV / 100)) / Math.max(1, ratedPressure);
  }

  const comp = hydComponentBase(shell, HYD_PUMP_LOOP_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      // Lever right (+): deliver out of B, drawing from A; left: the other way round.
      { kind: 'loopPump', a: 'B', b: 'A', q: swash * maxFlow() },
      { kind: 'tank', a: '_D' },
      // Leakage to the case drain from each side (linear in pressure).
      { kind: 'relief', a: 'A', b: '_D', set: 0, gain: leakCoef() },
      { kind: 'relief', a: 'B', b: '_D', set: 0, gain: leakCoef() },
      // Burst protection, should the circuit have no relief valves.
      { kind: 'relief', a: 'A', b: '_D', set: PUMP_BURST_PRESSURE, gain: 100 },
      { kind: 'relief', a: 'B', b: '_D', set: PUMP_BURST_PRESSURE, gain: 100 },
    ],
    step(_dt: number, ctx: SimStepContext): void {
      const pA = ctx.pressureAt('A');
      const pB = ctx.pressureAt('B');
      const qA = ctx.flowAt('A'); // out of the pump at A
      // Delivered flow: what leaves the outlet side (B with the lever right, A with it left).
      const q = Math.max(0, swash >= 0 ? ctx.flowAt('B') : qA);
      const dp = Math.abs(pA - pB);
      const lines = [`swash ${swash > 0 ? '+' : ''}${Math.round(swash * 100)} %`];
      if (Math.abs(swash) > 0.004) {
        lines.push(`Q ${fmtFlow(q)} out of ${swash >= 0 ? 'B' : 'A'}`);
        lines.push(`Δp ${fmtBar(dp)} · P ${((dp * q) / 600).toFixed(2)} kW`);
      }
      if (Math.max(pA, pB) > PUMP_BURST_PRESSURE * 0.95) lines.push('⚠ no pressure relief!');
      shell.setInfo(lines);
      paintFlow(leadA, pA, -qA);
      paintFlow(leadB, pB, -ctx.flowAt('B'));
    },
    snapshot: () => ({ ...nameSnapshot(shell), displacement, speed, etaV, ratedPressure }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      displacement = readNum(data, 'displacement', displacement, 0, 1000);
      speed = readNum(data, 'speed', speed, 0, 10000);
      etaV = readNum(data, 'etaV', etaV, 50, 100);
      ratedPressure = readNum(data, 'ratedPressure', ratedPressure, 1, 1000);
    },
    reset(): void {
      swash = 0;
      lever.value = '0';
      shell.setInfo([]);
      clearFlow([...leadA, ...leadB]);
    },
  });
}
