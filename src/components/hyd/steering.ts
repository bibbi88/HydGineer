import type { Component, SimStepContext } from '../../core/types';
import { orificeKFromRating, type HydElement } from '../../sim/hydraulics';
import { createPort, createPortLabel, createSvgEl } from '../shared/svgHelpers';
import { drawBallCheckSymbol } from '../shared/checkValveSymbol';
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
/** Flow (L/min) per bar above its setting through the built-in relief valve. */
const RELIEF_GAIN = 10;
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
 * Built in, as in a real unit (inside the dashed outline): an inlet check valve in P, so oil in
 * the unit can't be pushed back into the pump line; a relief valve from the unit's P side to T,
 * which limits the steering pressure; and a suction check valve from T to the P side, through
 * which the gerotor draws oil when the pump has stopped - manual steering.
 *
 * While simulating, the slider under the wheel turns it: hold it to one side to turn at that
 * speed; let go and the wheel stops, as a steering wheel does when let go of.
 */
export function createHydSteeringUnit(compLayer: HTMLElement, x: number, y: number): Component {
  // Wider than the symbol, so the readout beside it stays clear of the gerotor as the valve slides.
  const svgW = 240;
  const svgH = 180;
  const shell = createHydShell(
    compLayer,
    HYD_STEERING_UNIT_TYPE,
    x,
    y,
    svgW,
    svgH,
    'Steering unit',
    { x: 4, y: 28, w: 200, h: 136 },
  );
  const g = shell.g;

  // Everything built into the unit, inside a dashed outline (the wheel sits outside it).
  g.appendChild(
    createSvgEl('rect', {
      x: 36,
      y: 28,
      width: 168,
      height: 136,
      fill: 'none',
      stroke: INK,
      'stroke-width': 1,
      'stroke-dasharray': '6 4',
    }),
  );

  // Port leads, drawn from the port into the valve: L and R down to it; P up through the inlet
  // check into the unit's P gallery, and T up to it.
  const pGallery = 'M 70 146 V 100 H 90 V ' + BOT;
  const leads: Record<string, SVGElement[]> = {
    L: [line(g, 90, 10, 90, TOP)],
    R: [line(g, 110, 10, 110, TOP)],
    P: [line(g, 70, 170, 70, 162)],
    Pi: [path(g, pGallery)],
    T: [path(g, `M 130 170 V 100 H 110 V ${BOT}`)],
  };
  const inlet = drawBallCheckSymbol(g, 70, 155, 'vertical', 1, 0.5);
  leads.P!.push(line(g, 70, 162, 70, inlet.inPoint.y));
  leads.Pi!.push(line(g, 70, inlet.outPoint.y, 70, 146));

  // Built-in relief valve, P gallery → T: a small box with its arrow off the line until it opens.
  const reliefIn = [line(g, 70, 114, 86, 114)];
  const reliefOut = [line(g, 114, 114, 130, 114)];
  g.appendChild(
    createSvgEl('rect', {
      x: 86,
      y: 106,
      width: 28,
      height: 16,
      fill: '#fff',
      stroke: INK,
      'stroke-width': 1.5,
    }),
  );
  const reliefArrow = arrowLine(g, 89, 118, 111, 118);
  line(g, 94, 124, 106, 104, { 'stroke-width': 1 }); // adjustable
  // Built-in suction check, T → P gallery (oil for the gerotor when the pump has stopped).
  const suction = drawBallCheckSymbol(g, 100, 134, 'horizontal', -1, 0.5);
  const suctionPaths = [
    line(g, 130, 134, suction.inPoint.x, 134),
    line(g, suction.outPoint.x, 134, 70, 134),
  ];

  createPortLabel(g, 84, 16, 'L', { anchor: 'end', fontSize: 10 });
  createPortLabel(g, 116, 16, 'R', { anchor: 'start', fontSize: 10 });
  createPortLabel(g, 64, 170, 'P', { anchor: 'end', fontSize: 10 });
  createPortLabel(g, 136, 170, 'T', { anchor: 'start', fontSize: 10 });
  const reliefText = createSvgEl('text', { x: 140, y: 118, 'font-size': 9 });
  g.appendChild(reliefText);

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
    P: createPort(g, 'P', 70, 170, 'V'),
    T: createPort(g, 'T', 130, 170, 'V'),
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
  let reliefSetting = 100; // bar, the built-in relief valve
  function refresh(): void {
    reliefText.textContent = `${reliefSetting} bar`;
  }
  refresh();
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
              a: '_Pi',
              b: 'T',
              x: work,
              set: STEER_MARGIN,
              k,
              band: 2,
              check: false,
            }
          : { kind: 'orifice', a: '_Pi', b: 'T', k },
        // The gerotor: D · n from the P gallery into the line being steered towards.
        { kind: 'loopPump', a: work, b: '_Pi', q: (displacement * Math.abs(n) * 60) / 1000 },
        // The other line back to tank.
        { kind: 'orifice', a: other, b: 'T', k: k * open },
        // Built in: inlet check P → gallery, relief gallery → T, suction check T → gallery.
        { kind: 'check', a: 'P', b: '_Pi', crack: 0.5, k: 2 * k },
        { kind: 'relief', a: '_Pi', b: 'T', set: reliefSetting, gain: RELIEF_GAIN },
        { kind: 'check', a: 'T', b: '_Pi', crack: 0.2, k: 2 * k },
      ];
    },
    step(dt: number, ctx: SimStepContext): void {
      const n = revPerSec();
      angle = (angle + n * 360 * dt) % 360;
      applyState();
      const qCentre = ctx.elementValue(0);
      const qMeter = ctx.elementValue(1);
      const qReturn = ctx.elementValue(2);
      const qInlet = ctx.elementValue(3);
      const qRelief = ctx.elementValue(4);
      const qSuction = ctx.elementValue(5);
      const pP = ctx.pressureAt('P');
      const pPi = ctx.pressureAt('_Pi');
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
        // Load pressure above the gallery's: the driver drives the gerotor as a pump.
        const torque = ((pWork - pPi) * displacement) / (20 * Math.PI);
        if (torque > 0.5) lines.push(`wheel torque ${torque.toFixed(1)} Nm`);
      } else if (pP > 1 || Math.abs(qCentre) >= 0.05) {
        lines.push(`neutral P→T ${fmtFlow(qCentre)}`);
      }
      if (qRelief >= 0.05) lines.push(`relief open ${fmtFlow(qRelief)}`);
      if (qSuction >= 0.05) lines.push(`suction ${fmtFlow(qSuction)}`);
      if (pPi > 1) lines.push(`P ${fmtBar(pPi)}`);
      shell.setInfo(lines);

      paintFlow(centrePath, pPi, qCentre);
      paintFlow(leftPaths.PL, pPi, left ? qMeter : 0);
      paintFlow(leftPaths.RT, pR, left ? qReturn : 0);
      paintFlow(rightPaths.PR, pPi, right ? qMeter : 0);
      paintFlow(rightPaths.LT, pL, right ? qReturn : 0);
      paintFlow(leads.P!, pP, qInlet);
      paintFlow(leads.Pi!, pPi, qCentre + qMeter);
      paintFlow(leads.T!, pT, qCentre + qReturn + qRelief - qSuction);
      paintFlow(leads.L!, pL, left ? qMeter : right ? qReturn : 0);
      paintFlow(leads.R!, pR, right ? qMeter : left ? qReturn : 0);
      paintFlow(reliefIn, pPi, qRelief);
      // The arrow only lights up while the valve is actually relieving.
      paintFlow(reliefArrow, qRelief >= 0.05 ? pPi : 0, qRelief);
      paintFlow(reliefOut, pT, qRelief);
      paintFlow(suctionPaths, pT, qSuction);
      reliefArrow.forEach((el) =>
        el.setAttribute('transform', qRelief >= 0.05 ? 'translate(0,-4)' : ''),
      );
    },
    snapshot: () => ({ ...nameSnapshot(shell), displacement, maxRpm, qNom, reliefSetting }),
    restore(data: Record<string, unknown>): void {
      restoreName(shell, data);
      displacement = readNum(data, 'displacement', displacement, 1, 2000);
      maxRpm = readNum(data, 'maxRpm', maxRpm, 1, 600);
      qNom = readNum(data, 'qNom', qNom, 0.5, 2000);
      reliefSetting = readNum(data, 'reliefSetting', reliefSetting, 1, 700);
      refresh();
    },
    reset(): void {
      turn = 0;
      angle = 0;
      wheel.value = '0';
      applyState();
      shell.setInfo([]);
      for (const el of reliefArrow) el.setAttribute('transform', '');
      clearFlow([
        ...reliefIn,
        ...reliefArrow,
        ...reliefOut,
        ...suctionPaths,
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
