import type { Component, SimStepContext } from '../../core/types';
import { orificeKFromRating, type HydElement } from '../../sim/hydraulics';
import { createPort, createPortLabel, createSvgEl } from '../shared/svgHelpers';
import {
  INK,
  STROKE,
  arrowHead,
  createHydShell,
  fmtBar,
  fmtFlow,
  hydComponentBase,
  line,
  nameSnapshot,
  path,
  readNum,
  restoreName,
} from './base';

export const HYD_SPOOL_DIVIDER_TYPE = 'hydSpoolDivider';
export const HYD_ROTARY_DIVIDER_TYPE = 'hydRotaryDivider';

/** Pressure drop (bar) across a spool divider's metering orifices at its nominal flow. */
const METERING_DP = 7;
/** Pressure drop (bar) across each compensator throttle, half open, at nominal flow. */
const COMPENSATOR_DP = 3;
/** Centring spring of the compensating sleeve (bar per unit travel) - its softness sets how
 * closely the two chamber pressures, and so the two flows, are held equal. */
const SLEEVE_SPRING = 0.3;

function drawThrottleV(g: SVGElement, cx: number, cy: number): void {
  path(g, `M ${cx - 7} ${cy - 10} Q ${cx - 1} ${cy} ${cx - 7} ${cy + 10}`);
  path(g, `M ${cx + 7} ${cy - 10} Q ${cx + 1} ${cy} ${cx + 7} ${cy + 10}`);
}

function splitInfo(qA: number, qB: number): string {
  const total = qA + qB;
  if (Math.abs(total) < 0.01) return '';
  return `split ${((qA / total) * 100).toFixed(1)} / ${((qB / total) * 100).toFixed(1)} %`;
}

/**
 * Spool-type flow divider with a pressure-compensating (counterbalanced) sleeve. The inlet flow
 * passes two fixed metering orifices sized in the set ratio; the sleeve between them is pushed by
 * the two pressures downstream of those orifices and throttles whichever outlet has the lower
 * load until the two pressures are equal. Equal Δp across both metering orifices means the flow
 * divides in their size ratio regardless of the outlet pressures - within a few percent, set by
 * the sleeve's centring spring.
 *
 * The throttling is paid for in heat: the lightly loaded side is throttled down to the pressure
 * of the heavy side. Blocking one outlet shuts the other as well (apart from a trickle), and
 * reverse flow is combined in the same ratio (divider-combiner).
 */
export function createHydSpoolDivider(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 100;
  const svgH = 100;
  const shell = createHydShell(
    compLayer,
    HYD_SPOOL_DIVIDER_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Flow divider (spool)',
    { x: 12, y: 22, w: 76, h: 56 },
  );
  const g = shell.g;
  g.appendChild(
    createSvgEl('rect', {
      x: 14,
      y: 24,
      width: 72,
      height: 52,
      fill: '#fff',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  // Inlet up the middle, splitting to the two outlets.
  line(g, 50, 90, 50, 64);
  path(g, 'M 30 10 V 64 H 70 V 10');
  drawThrottleV(g, 30, 52);
  drawThrottleV(g, 70, 52);
  // The compensating sleeve: a double arrow across the two branches, between the chambers.
  line(g, 38, 36, 62, 36);
  arrowHead(g, 37, 36, 180, 6);
  arrowHead(g, 63, 36, 0, 6);
  createPortLabel(g, 22, 14, 'A', { anchor: 'end', fontSize: 10 });
  createPortLabel(g, 78, 14, 'B', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, 57, 96, 'P', { anchor: 'start', fontSize: 10 });
  const ratioText = createSvgEl('text', {
    x: 50,
    y: 56,
    'text-anchor': 'middle',
    'font-size': 9,
  });
  g.appendChild(ratioText);

  const ports = {
    P: createPort(g, 'P', 50, 90, 'V'),
    A: createPort(g, 'A', 30, 10, 'V'),
    B: createPort(g, 'B', 70, 10, 'V'),
  };
  shell.setInfoSide('right');

  let ratioA = 50; // % of the inlet flow to A
  let qNom = 20; // L/min total

  function refresh(): void {
    ratioText.textContent = `${ratioA}:${100 - ratioA}`;
  }
  refresh();

  const comp = hydComponentBase(shell, HYD_SPOOL_DIVIDER_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements(): HydElement[] {
      const shareA = ratioA / 100;
      return [
        { kind: 'orifice', a: 'P', b: '_C1', k: orificeKFromRating(qNom * shareA, METERING_DP) },
        {
          kind: 'orifice',
          a: 'P',
          b: '_C2',
          k: orificeKFromRating(qNom * (1 - shareA), METERING_DP),
        },
        {
          kind: 'compensator',
          a: '_C1',
          b: '_C2',
          x: 'A',
          y: 'B',
          k: orificeKFromRating(qNom, COMPENSATOR_DP),
          spring: SLEEVE_SPRING,
        },
      ];
    },
    step(_dt: number, ctx: SimStepContext): void {
      const qA = ctx.flowAt('A');
      const qB = ctx.flowAt('B');
      const sleeve = ctx.elementValue(2);
      if (Math.abs(qA) + Math.abs(qB) < 0.01) {
        shell.setInfo([]);
        return;
      }
      const lines = [`A ${fmtFlow(qA)}`, `B ${fmtFlow(qB)}`, splitInfo(qA, qB)];
      // How much pressure the sleeve is throttling away on the lighter side.
      const pIn = ctx.pressureAt('P');
      const throttled = Math.abs(ctx.pressureAt('A') - ctx.pressureAt('B'));
      if (throttled >= 0.5) lines.push(`throttles ${fmtBar(throttled)}`);
      if (Math.abs(sleeve) > 0.48) lines.push('⚠ sleeve at its stop - split not held');
      else if (pIn > 0 && Math.min(Math.abs(qA), Math.abs(qB)) < 0.02 * Math.abs(qA + qB)) {
        lines.push('⚠ one outlet stalled');
      }
      shell.setInfo(lines.filter(Boolean));
    },
    snapshot: () => ({ ...nameSnapshot(shell), ratioA, qNom }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      ratioA = readNum(data, 'ratioA', ratioA, 5, 95);
      qNom = readNum(data, 'qNom', qNom, 0.5, 2000);
      refresh();
    },
    reset: () => shell.setInfo([]),
  });
}

function drawGearSection(g: SVGElement, cx: number, cy: number, r: number): void {
  g.appendChild(
    createSvgEl('circle', { cx, cy, r, fill: '#fff', stroke: INK, 'stroke-width': STROKE }),
  );
  // Motor triangle at the inlet (bottom) pointing inwards, pump triangle at the outlet (top)
  // pointing outwards: a section that can work either way, as the divider's sections do.
  g.appendChild(
    createSvgEl('polygon', {
      points: `${cx},${cy + r - 11} ${cx - 6},${cy + r - 1.5} ${cx + 6},${cy + r - 1.5}`,
      fill: INK,
    }),
  );
  g.appendChild(
    createSvgEl('polygon', {
      points: `${cx},${cy - r + 1.5} ${cx - 6},${cy - r + 11} ${cx + 6},${cy - r + 11}`,
      fill: INK,
    }),
  );
}

/**
 * Rotary (gear) flow divider: two gear motor sections on one shaft. Turning together, they pass
 * flows in the ratio of their displacements - the division is positive-displacement, so it is
 * barely affected by load, apart from internal leakage of the more heavily loaded section.
 *
 * The shaft balances torque, not pressure: the inlet sits at the displacement-weighted mean of
 * the outlet pressures, and a section with a light load drives the other as a pump - so one
 * outlet can rise well above the inlet pressure (intensification). Real installations protect
 * each outlet with its own relief valve for that reason. Blocking one outlet stops the shaft and
 * so the other outlet too. Works in reverse as a flow combiner.
 */
export function createHydRotaryDivider(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 120;
  const svgH = 100;
  const shell = createHydShell(
    compLayer,
    HYD_ROTARY_DIVIDER_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Flow divider (rotary)',
    { x: 10, y: 28, w: 100, h: 44 },
  );
  const g = shell.g;
  const r = 16;
  drawGearSection(g, 30, 50, r);
  drawGearSection(g, 90, 50, r);
  // Common shaft.
  line(g, 30 + r, 48, 90 - r, 48, { 'stroke-width': 1.5 });
  line(g, 30 + r, 52, 90 - r, 52, { 'stroke-width': 1.5 });
  const shaftMark = line(g, 60, 42, 60, 58, { 'stroke-width': 1.5 });
  // Inlet branching to both sections; outlets straight up.
  path(g, `M 60 90 V 78 M 30 ${50 + r} V 78 H 90 V ${50 + r}`);
  line(g, 30, 10, 30, 50 - r);
  line(g, 90, 10, 90, 50 - r);
  createPortLabel(g, 22, 14, 'A', { anchor: 'end', fontSize: 10 });
  createPortLabel(g, 98, 14, 'B', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, 67, 96, 'P', { anchor: 'start', fontSize: 10 });

  const ports = {
    P: createPort(g, 'P', 60, 90, 'V'),
    A: createPort(g, 'A', 30, 10, 'V'),
    B: createPort(g, 'B', 90, 10, 'V'),
  };
  shell.setInfoSide('right');

  let dispA = 8; // cm³/rev
  let dispB = 8;
  let leakAt100 = 0.3; // L/min per section at 100 bar across it
  let friction = 0.5; // Nm
  let angle = 0;

  const comp = hydComponentBase(shell, HYD_ROTARY_DIVIDER_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      {
        kind: 'rotaryDivider',
        a: 'P',
        b: 'A',
        x: 'B',
        d1: dispA,
        d2: dispB,
        leak: leakAt100 / 100,
        torque: friction,
      },
    ],
    step(dt: number, ctx: SimStepContext): void {
      const n = ctx.elementValue(0);
      angle = (angle + n * 360 * dt * 0.1) % 360;
      shaftMark.setAttribute('transform', `rotate(${angle} 60 50)`);
      const qA = ctx.flowAt('A');
      const qB = ctx.flowAt('B');
      if (Math.abs(n) < 1e-4 && Math.abs(qA) + Math.abs(qB) < 0.01) {
        shell.setInfo([]);
        return;
      }
      const pIn = ctx.pressureAt('P');
      const pA = ctx.pressureAt('A');
      const pB = ctx.pressureAt('B');
      const lines = [
        `n ${(n * 60).toFixed(0)} rpm`,
        `A ${fmtFlow(qA)}`,
        `B ${fmtFlow(qB)}`,
        splitInfo(qA, qB),
      ];
      const intensified = Math.max(pA, pB) - pIn;
      if (n > 1e-3 && intensified >= 1) {
        lines.push(`⚠ ${pA > pB ? 'A' : 'B'} intensified +${fmtBar(intensified)}`);
      }
      shell.setInfo(lines.filter(Boolean));
    },
    snapshot: () => ({ ...nameSnapshot(shell), dispA, dispB, leakAt100, friction }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      dispA = readNum(data, 'dispA', dispA, 0.1, 1000);
      dispB = readNum(data, 'dispB', dispB, 0.1, 1000);
      leakAt100 = readNum(data, 'leakAt100', leakAt100, 0, 100);
      friction = readNum(data, 'friction', friction, 0, 1000);
    },
    reset(): void {
      angle = 0;
      shaftMark.setAttribute('transform', '');
      shell.setInfo([]);
    },
  });
}
