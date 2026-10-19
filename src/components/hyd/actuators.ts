import type { Component, SimStepContext } from '../../core/types';
import { circleAreaCm2, type HydElement } from '../../sim/hydraulics';
import { appState } from '../../app/AppState';
import { Modes } from '../../app/modes';
import { createPort, createPortLabel, createSvgEl } from '../shared/svgHelpers';
import { nextCylinderLetter, isCylinderLetterInUse } from '../shared/letters';
import {
  defaultSensors,
  isInSensorRange,
  isValidSensorArray,
  relabelSensors,
  renameSensorKeyBindings,
  type CylinderSensor,
} from '../shared/sensorPositions';
import {
  INK,
  STROKE,
  createHydShell,
  hydComponentBase,
  line,
  nameSnapshot,
  adjustArrow,
  fmtBar,
  path,
  readNum,
  restoreName,
  type HydShell,
} from './base';

export const HYD_CYLINDER_DOUBLE_TYPE = 'hydCylinderDouble';
export const HYD_CYLINDER_SINGLE_TYPE = 'hydCylinderSingle';
export const HYD_MOTOR_TYPE = 'hydMotor';
export const HYD_MOTOR_VAR_TYPE = 'hydMotorVar';

const BODY_X = 10;
const BODY_W = 180;
const BODY_Y = 10;
const BODY_H = 40;
const PISTON_W = 6;
const TRAVEL = 170;

interface CylinderDrawing {
  piston: SVGRectElement;
  rod: SVGRectElement;
  tip: SVGRectElement;
  spring: SVGPathElement | null;
  update(pos: number): void;
}

function drawCylinder(shell: HydShell, withSpring: boolean, withPortB: boolean): CylinderDrawing {
  const g = shell.g;
  g.appendChild(
    createSvgEl('rect', {
      x: BODY_X,
      y: BODY_Y,
      width: BODY_W,
      height: BODY_H,
      fill: '#fff',
      stroke: INK,
      'stroke-width': STROKE,
    }),
  );
  const piston = createSvgEl('rect', { y: BODY_Y, width: PISTON_W, height: BODY_H, fill: '#777' });
  const rod = createSvgEl('rect', { y: BODY_Y + BODY_H / 2 - 4, height: 8, fill: '#999' });
  const tip = createSvgEl('rect', {
    y: BODY_Y + BODY_H / 2 - 9,
    width: 6,
    height: 18,
    fill: '#666',
  });
  const spring = withSpring ? path(g, '', { 'stroke-width': 1.5 }) : null;
  g.append(piston, rod, tip);
  line(g, 30, BODY_Y + BODY_H, 30, 70);
  if (withPortB) line(g, 170, BODY_Y + BODY_H, 170, 70);
  else {
    // Breather on the spring side.
    line(g, 170, BODY_Y + BODY_H, 170, BODY_Y + BODY_H + 8, { 'stroke-width': 1.5 });
    line(g, 165, BODY_Y + BODY_H + 8, 175, BODY_Y + BODY_H + 8, { 'stroke-width': 1.5 });
  }
  createPortLabel(g, 38, 72, 'A', { anchor: 'start', fontSize: 10 });
  if (withPortB) createPortLabel(g, 162, 72, 'B', { anchor: 'end', fontSize: 10 });

  function update(pos: number): void {
    const px = BODY_X + 2 + pos * TRAVEL;
    piston.setAttribute('x', String(px));
    const rodStart = px + PISTON_W;
    const rodEnd = rodStart + 184;
    rod.setAttribute('x', String(rodStart));
    rod.setAttribute('width', String(rodEnd - rodStart));
    tip.setAttribute('x', String(rodEnd));
    if (spring) {
      const x1 = rodStart;
      const x2 = BODY_X + BODY_W;
      const n = 8;
      const step = (x2 - x1) / (n + 1);
      let d = `M ${x1} ${BODY_Y + 12}`;
      for (let i = 0; i < n; i++) {
        d += ` L ${x1 + step * (i + 0.5)} ${BODY_Y + (i % 2 === 0 ? 4 : 18)}`;
      }
      d += ` L ${x2} ${BODY_Y + 12}`;
      spring.setAttribute('d', d);
    }
  }
  update(0);
  return { piston, rod, tip, spring, update };
}

function fmtVel(v: number): string {
  return `v ${(Math.abs(v) < 5e-5 ? 0 : v).toFixed(3)} m/s`;
}

function fmtForce(f: number): string {
  return Math.abs(f) >= 1000 ? `${(f / 1000).toFixed(2)} kN` : `${f.toFixed(0)} N`;
}

interface CylinderCommon {
  letter: string;
  sensors: CylinderSensor[];
}

function cylinderLabelMethods(
  shell: HydShell,
  state: CylinderCommon,
  compId: () => number,
): Pick<Component, 'relabel' | 'renameLabel'> {
  return {
    relabel(): void {
      const old = state.letter;
      state.letter = nextCylinderLetter();
      state.sensors = relabelSensors(state.sensors, old, state.letter).sensors;
      shell.setDefaultName(`Cylinder ${state.letter}`);
    },
    renameLabel(newValue: string): boolean {
      const t = newValue.trim().toUpperCase();
      if (!/^[A-Z]$/.test(t)) return false;
      if (t !== state.letter && isCylinderLetterInUse(t, compId())) return false;
      const old = state.letter;
      state.letter = t;
      shell.setDefaultName(`Cylinder ${t}`);
      const { sensors, renames } = relabelSensors(state.sensors, old, t);
      state.sensors = sensors;
      for (const r of renames) renameSensorKeyBindings(r.oldLabel, r.newLabel);
      appState.markDirty();
      return true;
    },
  };
}

/**
 * Double-acting differential cylinder. Port A feeds the full bore, port B the annulus around
 * the rod. With the inertia of the load neglected the piston moves at v = Q_A / A_bore when
 * extending (Q_B / A_annulus retracting), and the pressures are whatever balances
 *
 *   p_A·A_bore − p_B·A_annulus = F_load ± F_friction
 *
 * F_load (N) is an external force opposing extension (negative: pulling the rod out); seal
 * friction opposes motion either way and must be overcome before the piston moves at all.
 */
export function createHydCylinderDouble(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 220;
  const svgH = 80;
  const state: CylinderCommon = { letter: nextCylinderLetter(), sensors: [] };
  state.sensors = defaultSensors(state.letter);
  const shell = createHydShell(
    compLayer,
    HYD_CYLINDER_DOUBLE_TYPE,
    x,
    y,
    svgW,
    svgH,
    `Cylinder ${state.letter}`,
    { x: BODY_X, y: BODY_Y, w: BODY_W, h: BODY_H },
  );
  shell.setNameVisible(true);
  shell.setInfoSide('above');
  const drawing = drawCylinder(shell, false, true);
  const ports = {
    A: createPort(shell.g, 'A', 30, 70, 'V'),
    B: createPort(shell.g, 'B', 170, 70, 'V'),
  };

  let pos = 0;
  let bore = 50;
  let rodD = 30;
  let stroke = 200;
  let load = 0;
  let friction = 100;
  /** Moving mass (kg): 0 = inertia ignored (the piston follows the flow instantly). */
  let mass = 0;
  let vLast = 0;
  let peakA = 0;
  let peakB = 0;

  const comp = hydComponentBase(shell, HYD_CYLINDER_DOUBLE_TYPE, x, y, svgW, svgH, ports);
  const areaA = (): number => circleAreaCm2(bore);
  const areaB = (): number =>
    Math.max(0.01, circleAreaCm2(bore) - circleAreaCm2(Math.min(rodD, bore - 1)));
  return Object.assign(comp, {
    ...cylinderLabelMethods(shell, state, () => comp.id),
    hydElements: (): HydElement[] => [
      {
        kind: 'piston',
        a: 'A',
        b: 'B',
        areaA: areaA(),
        areaB: areaB(),
        load,
        friction,
        atMin: pos <= 0,
        atMax: pos >= 1,
        volA: 0.01 + areaA() * pos * stroke * 1e-4,
        volB: 0.01 + areaB() * (1 - pos) * stroke * 1e-4,
        mass,
        vPrev: vLast,
      },
    ],
    step(dt: number, ctx: SimStepContext): void {
      const v = ctx.elementValue(0);
      pos = Math.max(0, Math.min(1, pos + (v * dt * 1000) / Math.max(1, stroke)));
      drawing.update(pos);
      vLast = ctx.elementLocked(0) ? 0 : v;
      const pA = ctx.pressureAt('A');
      const pB = ctx.pressureAt('B');
      peakA = Math.max(peakA, pA);
      peakB = Math.max(peakB, pB);
      const force = (pA * areaA() - pB * areaB()) * 10;
      const lines = [`${fmtVel(v)} · x ${(pos * stroke).toFixed(0)} mm`, `F ${fmtForce(force)}`];
      // With a mass, stopping it suddenly compresses the trapped oil: show the peaks reached.
      if (mass > 0) lines.push(`peak A ${peakA.toFixed(0)} · B ${peakB.toFixed(0)} bar`);
      shell.setInfo(lines);
      for (const s of state.sensors) ctx.emitSignal(s.label, isInSensorRange(pos, s));
    },
    snapshot: () => ({
      ...nameSnapshot(shell),
      pos,
      letter: state.letter,
      sensors: state.sensors,
      bore,
      rodD,
      stroke,
      load,
      friction,
      mass,
    }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      if (typeof data.letter === 'string') state.letter = data.letter;
      shell.setDefaultName(`Cylinder ${state.letter}`);
      if (isValidSensorArray(data.sensors)) state.sensors = data.sensors;
      pos = readNum(data, 'pos', pos, 0, 1);
      bore = readNum(data, 'bore', bore, 5, 1000);
      rodD = readNum(data, 'rodD', rodD, 1, bore - 1);
      stroke = readNum(data, 'stroke', stroke, 1, 10000);
      load = readNum(data, 'load', load, -1e7, 1e7);
      friction = readNum(data, 'friction', friction, 0, 1e6);
      mass = readNum(data, 'mass', mass, 0, 1e6);
      drawing.update(pos);
    },
    reset(): void {
      pos = 0;
      vLast = 0;
      peakA = 0;
      peakB = 0;
      drawing.update(pos);
      shell.setInfo([]);
    },
  });
}

/**
 * Single-acting cylinder (plunger with return spring): oil on port A extends it; the spring
 * (preload at full retraction plus rate × stroke travelled) and any external load push it back
 * once A is opened to tank.
 */
export function createHydCylinderSingle(compLayer: HTMLElement, x: number, y: number): Component {
  const svgW = 220;
  const svgH = 80;
  const state: CylinderCommon = { letter: nextCylinderLetter(), sensors: [] };
  state.sensors = defaultSensors(state.letter);
  const shell = createHydShell(
    compLayer,
    HYD_CYLINDER_SINGLE_TYPE,
    x,
    y,
    svgW,
    svgH,
    `Cylinder ${state.letter}`,
    { x: BODY_X, y: BODY_Y, w: BODY_W, h: BODY_H },
  );
  shell.setNameVisible(true);
  shell.setInfoSide('above');
  const drawing = drawCylinder(shell, true, false);
  const ports = { A: createPort(shell.g, 'A', 30, 70, 'V') };

  let pos = 0;
  let bore = 40;
  let stroke = 150;
  let load = 0;
  let friction = 50;
  let springPreload = 300;
  let springRate = 2;
  let mass = 0;
  let vLast = 0;
  let peakA = 0;

  const springForce = (): number => springPreload + springRate * pos * stroke;
  const areaA = (): number => circleAreaCm2(bore);
  const comp = hydComponentBase(shell, HYD_CYLINDER_SINGLE_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    ...cylinderLabelMethods(shell, state, () => comp.id),
    hydElements: (): HydElement[] => [
      {
        kind: 'piston',
        a: 'A',
        areaA: areaA(),
        areaB: 0,
        load: load + springForce(),
        friction,
        atMin: pos <= 0,
        atMax: pos >= 1,
        volA: 0.01 + areaA() * pos * stroke * 1e-4,
        mass,
        vPrev: vLast,
      },
    ],
    step(dt: number, ctx: SimStepContext): void {
      const v = ctx.elementValue(0);
      pos = Math.max(0, Math.min(1, pos + (v * dt * 1000) / Math.max(1, stroke)));
      drawing.update(pos);
      vLast = ctx.elementLocked(0) ? 0 : v;
      const pA = ctx.pressureAt('A');
      peakA = Math.max(peakA, pA);
      const force = pA * areaA() * 10;
      const lines = [
        `${fmtVel(v)} · x ${(pos * stroke).toFixed(0)} mm`,
        `F ${fmtForce(force)} (spring ${fmtForce(springForce())})`,
      ];
      if (mass > 0) lines.push(`peak A ${peakA.toFixed(0)} bar`);
      shell.setInfo(lines);
      for (const s of state.sensors) ctx.emitSignal(s.label, isInSensorRange(pos, s));
    },
    snapshot: () => ({
      ...nameSnapshot(shell),
      pos,
      letter: state.letter,
      sensors: state.sensors,
      bore,
      stroke,
      load,
      friction,
      springPreload,
      springRate,
      mass,
    }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      if (typeof data.letter === 'string') state.letter = data.letter;
      shell.setDefaultName(`Cylinder ${state.letter}`);
      if (isValidSensorArray(data.sensors)) state.sensors = data.sensors;
      pos = readNum(data, 'pos', pos, 0, 1);
      bore = readNum(data, 'bore', bore, 5, 1000);
      stroke = readNum(data, 'stroke', stroke, 1, 10000);
      load = readNum(data, 'load', load, -1e7, 1e7);
      friction = readNum(data, 'friction', friction, 0, 1e6);
      springPreload = readNum(data, 'springPreload', springPreload, 0, 1e7);
      springRate = readNum(data, 'springRate', springRate, 0, 1e6);
      mass = readNum(data, 'mass', mass, 0, 1e6);
      drawing.update(pos);
    },
    reset(): void {
      pos = 0;
      vLast = 0;
      peakA = 0;
      drawing.update(pos);
      shell.setInfo([]);
    },
  });
}

/**
 * Hydraulic motor, bidirectional. Speed n = Q / V; the pressure difference across it is what the
 * load torque needs: Δp = 20π·T / V (bar, Nm, cm³/rev). The resisting torque acts against
 * rotation in either direction; below it the motor stalls.
 *
 * The variable variant has an adjustable displacement (a slider beside it while simulating),
 * between a minimum stop and its maximum: a smaller displacement turns faster on the same flow
 * but needs more pressure for the same torque - the hydraulic power, Δp·Q, stays the same.
 */
export function createHydMotor(
  compLayer: HTMLElement,
  x: number,
  y: number,
  variant: 'fixed' | 'variable' = 'fixed',
): Component {
  const variable = variant === 'variable';
  const type = variable ? HYD_MOTOR_VAR_TYPE : HYD_MOTOR_TYPE;
  const svgW = 80;
  const svgH = 100;
  const title = variable ? 'Hydraulic motor, variable' : 'Hydraulic motor';
  const shell = createHydShell(compLayer, type, x, y, svgW, svgH, title, {
    x: 20,
    y: 30,
    w: 58,
    h: 40,
  });
  const g = shell.g;
  const cx = 40;
  const cy = 50;
  const r = 18;
  g.appendChild(
    createSvgEl('circle', { cx, cy, r, fill: '#fff', stroke: INK, 'stroke-width': STROKE }),
  );
  // Filled triangles pointing inwards = motor; one at each port = either direction.
  g.appendChild(
    createSvgEl('polygon', {
      points: `${cx},${cy - r + 13} ${cx - 7},${cy - r + 1.5} ${cx + 7},${cy - r + 1.5}`,
      fill: INK,
    }),
  );
  g.appendChild(
    createSvgEl('polygon', {
      points: `${cx},${cy + r - 13} ${cx - 7},${cy + r - 1.5} ${cx + 7},${cy + r - 1.5}`,
      fill: INK,
    }),
  );
  line(g, cx, 10, cx, cy - r);
  line(g, cx, 90, cx, cy + r);
  // Variable displacement: the ISO adjustment arrow through the motor.
  if (variable) adjustArrow(g, cx, cy, 22);
  line(g, cx + r, cy - 2, 62, cy - 2, { 'stroke-width': 1.5 });
  line(g, cx + r, cy + 2, 62, cy + 2, { 'stroke-width': 1.5 });
  g.appendChild(
    createSvgEl('circle', { cx: 70, cy, r: 8, fill: '#fff', stroke: INK, 'stroke-width': 1.5 }),
  );
  const spoke = line(g, 70, cy, 70, cy - 8, { 'stroke-width': 1.5 });
  createPortLabel(g, 47, 94, 'A', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, 47, 14, 'B', { anchor: 'start', fontSize: 10 });
  const ports = {
    A: createPort(g, 'A', cx, 90, 'V'),
    B: createPort(g, 'B', cx, 10, 'V'),
  };
  shell.setInfoSide('right');
  let displacement = 20; // cm³/rev (the maximum, for the variable motor)
  let torque = 20;
  /** Hydromechanical efficiency, %: friction and flow losses inside the motor - the shaft gets
   * T = Δp·V·ηhm / 20π. */
  let etaHm = 90;
  let angle = 0;
  /** Variable motor: minimum-displacement stop and starting setting, % of the maximum. */
  let minPct = 30;
  let setting = 100;
  /** Displacement now, % of the maximum. */
  let pct = 100;

  // The displacement lever: a slider beside the motor while simulating (see app.css).
  const lever = variable ? document.createElement('input') : null;
  if (lever) {
    lever.type = 'range';
    lever.max = '100';
    lever.step = '5';
    lever.className = 'swashLever motorLever';
    lever.title = 'Motor displacement: right = maximum, left = minimum (double-click to reset)';
    for (const ev of ['mousedown', 'pointerdown', 'click', 'dblclick'] as const) {
      lever.addEventListener(ev, (e) => e.stopPropagation());
    }
    lever.addEventListener('input', () => {
      if (appState.mode === Modes.STOP) return;
      pct = clampPct(Number(lever.value));
    });
    lever.addEventListener('dblclick', () => {
      pct = clampPct(setting);
      syncLever();
    });
    shell.el.appendChild(lever);
  }
  function clampPct(v: number): number {
    return Math.min(100, Math.max(minPct, v));
  }
  function syncLever(): void {
    if (!lever) return;
    lever.min = String(minPct);
    lever.value = String(pct);
  }
  syncLever();
  /** Displacement in use, cm³/rev. */
  function disp(): number {
    return variable ? (displacement * pct) / 100 : displacement;
  }

  const comp = hydComponentBase(shell, type, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements: (): HydElement[] => [
      { kind: 'motor', a: 'A', b: 'B', disp: disp(), torque, etaHm: etaHm / 100 },
    ],
    step(dt: number, ctx: SimStepContext): void {
      const n = ctx.elementValue(0);
      // Shown at a slowed-down rate so it stays readable at real speeds.
      angle = (angle + n * 360 * dt * 0.1) % 360;
      spoke.setAttribute('transform', `rotate(${angle} 70 ${cy})`);
      const dp = ctx.pressureAt('A') - ctx.pressureAt('B');
      // Shaft torque after the hydromechanical losses; hydraulic power in = Δp·Q.
      const t = (dp * disp() * etaHm) / 100 / (20 * Math.PI);
      const rpm = Math.abs(n) < 1e-4 ? 0 : n * 60;
      const pOut = Math.abs(t * 2 * Math.PI * n) / 1000;
      const pIn = Math.abs((dp * disp() * n * 0.06) / 600);
      const lines = [`n ${rpm.toFixed(0)} rpm`, `T ${t.toFixed(1)} Nm (ηhm ${etaHm} %)`];
      if (pIn > 0.005) lines.push(`P in ${pIn.toFixed(2)} → out ${pOut.toFixed(2)} kW`);
      if (variable) {
        lines.unshift(`V ${disp().toFixed(1)} cm³/rev (${Math.round(pct)} %)`);
        lines.splice(2, 0, `Δp ${fmtBar(Math.abs(dp))}`);
      }
      shell.setInfo(lines);
    },
    snapshot: () => ({
      ...nameSnapshot(shell),
      displacement,
      torque,
      etaHm,
      ...(variable ? { minPct, setting } : {}),
    }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      displacement = readNum(data, 'displacement', displacement, 0.1, 10000);
      torque = readNum(data, 'torque', torque, 0, 1e6);
      etaHm = readNum(data, 'etaHm', etaHm, 50, 100);
      if (variable) {
        minPct = readNum(data, 'minPct', minPct, 5, 100);
        setting = readNum(data, 'setting', setting, 5, 100);
        pct = clampPct(setting);
        syncLever();
      }
    },
    reset(): void {
      pct = clampPct(setting);
      syncLever();
      angle = 0;
      spoke.setAttribute('transform', '');
      shell.setInfo([]);
    },
  });
}
