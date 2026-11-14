import type { Component, SimStepContext } from '../../core/types';
import { orificeKFromRating, type HydElement } from '../../sim/hydraulics';
import { createPort, createPortLabel, createSvgEl } from '../shared/svgHelpers';
import { clearFlow, paintFlow } from './flowPaint';
import {
  INK,
  STROKE,
  arrowLine,
  blocked,
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

export const HYD_STEERING_UNIT_TYPE = 'hydSteeringUnit';

/** Δp (bar) at which the open-centre and return paths pass their nominal flow, fully open. */
const PATH_RATING_DP = 5;
/** While steering, how far (bar) the pump is held above the line being steered: the spool's
 * small deflection against its sleeve throttles the open centre just enough for that. */
const STEER_MARGIN = 5;
/** The valve's boxes: 40 px wide, the middle one over the ports in neutral. */
const BOX = 40;
const TOP = 50;
const BOT = 90;

/**
 * Hydrostatic steering unit ("Orbitrol"): a rotary valve and a metering gerotor, turned by the
 * steering wheel. In neutral it is open-centre - the pump's oil goes straight P → T - and the
 * cylinder lines L and R are shut, so the wheels hold. Turning the wheel opens the valve: the
 * oil goes from P through the gerotor to L (turning left) or R (turning right), and the other
 * line back to T. The gerotor turns with the wheel, so it lets through just its displacement per
 * revolution: Q = D · n - the cylinder follows the wheel, however hard the load pushes back. While
 * the wheel turns, the spool's small deflection against its sleeve throttles the open centre, so
 * the pump pressure rises to just above what the steering needs and only the surplus oil goes to
 * tank. Should the pump not keep up, the driver's hands drive the gerotor as a pump - the
 * readout shows the torque that takes, as in emergency steering.
 *
 * While simulating, the slider under the wheel turns it: hold it to one side to turn at that
 * speed; let go and the wheel stops, as a steering wheel does when let go of.
 */
export function createHydSteeringUnit(compLayer: HTMLElement, x: number, y: number): Component {
  // Wider than the symbol, so the readout beside it stays clear of the gerotor as the valve slides.
  const svgW = 240;
  const svgH = 140;
  const shell = createHydShell(
    compLayer,
    HYD_STEERING_UNIT_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Steering unit',
    { x: 4, y: 40, w: 192, h: 60 },
  );
  const g = shell.g;

  // Port leads, drawn from the port into the valve (P and T up from the bottom, L and R down).
  const leads: Record<string, SVGElement[]> = {
    L: [line(g, 90, 10, 90, TOP)],
    R: [line(g, 110, 10, 110, TOP)],
    P: [line(g, 90, 130, 90, BOT)],
    T: [line(g, 110, 130, 110, BOT)],
  };
  createPortLabel(g, 84, 16, 'L', { anchor: 'end', fontSize: 10 });
  createPortLabel(g, 116, 16, 'R', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, 84, 128, 'P', { anchor: 'end', fontSize: 10 });
  createPortLabel(g, 116, 128, 'T', { anchor: 'start', fontSize: 10 });

  // The valve slides with the wheel's turning; the wheel and the gerotor ride on its ends.
  const slide = createSvgEl('g', { class: 'hydSpool' });
  g.appendChild(slide);
  const box = (x0: number): void => {
    slide.appendChild(
      createSvgEl('rect', {
        x: x0,
        y: TOP,
        width: BOX,
        height: BOT - TOP,
        fill: '#fff',
        stroke: INK,
        'stroke-width': STROKE,
      }),
    );
  };
  // Turning left (left box): P → L, R → T.
  box(40);
  const leftPaths = {
    PL: arrowLine(slide, 50, BOT, 50, TOP + 1),
    RT: arrowLine(slide, 70, TOP, 70, BOT - 1),
  };
  // Neutral (middle box): open centre P → T, L and R shut.
  box(80);
  const centrePath = [path(slide, `M 90 ${BOT} V 72 H 110 V ${BOT}`)];
  blocked(slide, 90, TOP, 1);
  blocked(slide, 110, TOP, 1);
  // Turning right (right box): P → R, L → T.
  box(120);
  const rightPaths = {
    PR: arrowLine(slide, 130, BOT, 150, TOP + 1),
    LT: arrowLine(slide, 130, TOP, 150, BOT - 1),
  };
  // Lines along the boxes: the valve opens gradually, anywhere in between.
  line(slide, 40, TOP - 5, 160, TOP - 5, { 'stroke-width': 1.2 });
  line(slide, 40, BOT + 5, 160, BOT + 5, { 'stroke-width': 1.2 });

  // The steering wheel on the left end...
  line(slide, 33, 70, 40, 70, { 'stroke-width': 1.5 });
  slide.appendChild(
    createSvgEl('circle', { cx: 20, cy: 70, r: 13, fill: '#fff', stroke: INK, 'stroke-width': 2 }),
  );
  const spokes = createSvgEl('g');
  slide.appendChild(spokes);
  for (const deg of [90, 210, 330]) {
    const r = (deg * Math.PI) / 180;
    line(spokes, 20, 70, 20 + 13 * Math.cos(r), 70 + 13 * Math.sin(r), { 'stroke-width': 1.5 });
  }
  slide.appendChild(createSvgEl('circle', { cx: 20, cy: 70, r: 3, fill: INK }));
  // ...and the metering gerotor on the right, coupled back to the valve (dashed).
  path(slide, 'M 160 70 H 167', { 'stroke-dasharray': '3 2', 'stroke-width': 1.5 });
  slide.appendChild(
    createSvgEl('circle', { cx: 180, cy: 70, r: 12, fill: '#fff', stroke: INK, 'stroke-width': 2 }),
  );
  slide.appendChild(createSvgEl('path', { d: 'M 180 59 L 175 66 L 185 66 Z', fill: INK }));
  slide.appendChild(createSvgEl('path', { d: 'M 180 81 L 175 74 L 185 74 Z', fill: INK }));

  const ports = {
    L: createPort(g, 'L', 90, 10, 'V'),
    R: createPort(g, 'R', 110, 10, 'V'),
    P: createPort(g, 'P', 90, 130, 'V'),
    T: createPort(g, 'T', 110, 130, 'V'),
  };
  shell.setInfoSide('right');

  // The wheel: a slider under it, shown while simulating (see app.css). Held to one side it
  // turns the wheel that way at that speed; let go, it springs back to the middle.
  const wheel = document.createElement('input');
  wheel.type = 'range';
  wheel.min = '-100';
  wheel.max = '100';
  wheel.step = '5';
  wheel.value = '0';
  wheel.className = 'steerWheel';
  wheel.title = 'Steering wheel: hold right to turn right, left to turn left; let go to stop';
  for (const ev of ['mousedown', 'pointerdown', 'click', 'dblclick']) {
    wheel.addEventListener(ev, (e) => e.stopPropagation());
  }
  shell.el.appendChild(wheel);

  let displacement = 100; // cm³/rev
  let maxRpm = 90; // the wheel's speed with the slider at either end
  let qNom = 40; // L/min through the open centre (and the return path) fully open, at 5 bar
  /** The wheel's turning, −1 (fastest left) … +1 (fastest right). */
  let turn = 0;
  let angle = 0;

  const letGo = (): void => {
    turn = 0;
    wheel.value = '0';
    applyState();
  };
  wheel.addEventListener('input', () => {
    turn = Number(wheel.value) / 100;
    applyState();
  });
  wheel.addEventListener('change', letGo);
  wheel.addEventListener('pointerup', letGo);

  function applyState(): void {
    // Turning right brings the right box over the ports - the valve moves left - and left the
    // left box (ISO 1219: the box next to the actuator that works it).
    slide.setAttribute('transform', `translate(${(-turn * BOX).toFixed(1)},0)`);
    spokes.setAttribute('transform', `rotate(${angle.toFixed(1)} 20 70)`);
  }
  applyState();

  /** Wheel speed now, rev/s (+ = right). */
  const revPerSec = (): number => (turn * maxRpm) / 60;

  const comp = hydComponentBase(shell, HYD_STEERING_UNIT_TYPE, x, y, svgW, svgH, ports);
  return Object.assign(comp, {
    hydElements(): HydElement[] {
      const k = orificeKFromRating(qNom, PATH_RATING_DP);
      const open = Math.min(1, Math.abs(turn));
      const n = revPerSec();
      const work = n >= 0 ? 'R' : 'L';
      const other = n >= 0 ? 'L' : 'R';
      return [
        // Open centre: wide open in neutral; turning, throttled to hold the pump just above the
        // line being steered, the surplus to tank.
        open > 0
          ? {
              kind: 'sequence',
              a: 'P',
              b: 'T',
              x: work,
              set: STEER_MARGIN,
              k,
              band: 2,
              check: false,
            }
          : { kind: 'orifice', a: 'P', b: 'T', k },
        // The gerotor: D · n from P into the line being steered towards.
        { kind: 'loopPump', a: work, b: 'P', q: (displacement * Math.abs(n) * 60) / 1000 },
        // The other line back to tank.
        { kind: 'orifice', a: other, b: 'T', k: k * open },
      ];
    },
    step(dt: number, ctx: SimStepContext): void {
      const n = revPerSec();
      angle = (angle + n * 360 * dt) % 360;
      applyState();
      const qCentre = ctx.elementValue(0);
      const qMeter = ctx.elementValue(1);
      const qReturn = ctx.elementValue(2);
      const pP = ctx.pressureAt('P');
      const pT = ctx.pressureAt('T');
      const pL = ctx.pressureAt('L');
      const pR = ctx.pressureAt('R');
      const right = n > 0;
      const left = n < 0;
      const lines: string[] = [];
      if (right || left) {
        const pWork = right ? pR : pL;
        lines.push(`wheel ${Math.round(Math.abs(n) * 60)} rpm ${right ? '→ right' : '← left'}`);
        lines.push(`P→${right ? 'R' : 'L'} ${fmtFlow(qMeter)}`);
        // Load pressure above the pump's: the driver drives the gerotor as a pump.
        const torque = ((pWork - pP) * displacement) / (20 * Math.PI);
        if (torque > 0.5) lines.push(`wheel torque ${torque.toFixed(1)} Nm`);
      } else if (pP > 1 || Math.abs(qCentre) >= 0.05) {
        lines.push(`neutral P→T ${fmtFlow(qCentre)}`);
      }
      if (pP > 1) lines.push(`P ${fmtBar(pP)}`);
      shell.setInfo(lines);

      paintFlow(centrePath, pP, qCentre);
      paintFlow(leftPaths.PL, pP, left ? qMeter : 0);
      paintFlow(leftPaths.RT, pR, left ? qReturn : 0);
      paintFlow(rightPaths.PR, pP, right ? qMeter : 0);
      paintFlow(rightPaths.LT, pL, right ? qReturn : 0);
      paintFlow(leads.P!, pP, qCentre + qMeter);
      paintFlow(leads.T!, pT, qCentre + qReturn);
      paintFlow(leads.L!, pL, left ? qMeter : right ? qReturn : 0);
      paintFlow(leads.R!, pR, right ? qMeter : left ? qReturn : 0);
    },
    snapshot: () => ({ ...nameSnapshot(shell), displacement, maxRpm, qNom }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      displacement = readNum(data, 'displacement', displacement, 1, 2000);
      maxRpm = readNum(data, 'maxRpm', maxRpm, 1, 600);
      qNom = readNum(data, 'qNom', qNom, 0.5, 2000);
    },
    reset(): void {
      turn = 0;
      angle = 0;
      wheel.value = '0';
      applyState();
      shell.setInfo([]);
      clearFlow([
        ...centrePath,
        ...leftPaths.PL,
        ...leftPaths.RT,
        ...rightPaths.PR,
        ...rightPaths.LT,
        ...Object.values(leads).flat(),
      ]);
    },
  });
}
