import type { Component, SimStepContext, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createSvgEl, createPort } from './shared/svgHelpers';
import { nextCylinderLetter, isCylinderLetterInUse } from './shared/letters';
import { BASE_CYL_SPEED } from '../sim/constants';
import { redrawAllConnections } from '../wires/connection';
import { appState } from '../app/AppState';
import {
  isInSensorRange,
  defaultSensors,
  isValidSensorArray,
  relabelSensors,
  renameSensorKeyBindings,
  type CylinderSensor,
} from './shared/sensorPositions';
import {
  DEFAULT_BORE_DIAMETER_MM,
  DEFAULT_ROD_DIAMETER_MM,
  annularAreaMm2,
  boreAreaMm2,
  forceFromArea,
} from './shared/cylinderForce';

export const CYLINDER_SINGLE_TYPE = 'cylinderSingle';

export interface CylinderSingleGeometry {
  svgW: number;
  svgH: number;
  gx: number;
  gy: number;
  w: number;
  h: number;
  portMargin: number;
  capPortInset: number;
  rodPortInset: number;
  pistonWidth: number;
  pistonTravelStartInset: number;
  pistonTravelEndInset: number;
  pistonToRodGap: number;
  rodHeight: number;
  rodTipInset: number;
  rodTipWidth: number;
  rodTipHeight: number;
  springInset: number;
  springSegment: number;
}

export const CYLINDER_SINGLE_DEFAULT_GEOMETRY: CylinderSingleGeometry = {
  svgW: 186,
  svgH: 84,
  gx: 8,
  gy: 8,
  w: 160,
  h: 56,
  // portMargin (8, not the "natural" 6) and capPortInset/rodPortInset (15, not 12) are chosen
  // together so port A lands exactly on the 10px grid relative to this canvas's own center, in
  // both push and pull mode - see src/core/grid.ts.
  portMargin: 8,
  capPortInset: 15,
  rodPortInset: 15,
  pistonWidth: 6,
  pistonTravelStartInset: 10,
  pistonTravelEndInset: 20,
  pistonToRodGap: 6,
  rodHeight: 6,
  rodTipInset: 10,
  rodTipWidth: 10,
  rodTipHeight: 12,
  springInset: 28,
  springSegment: 10,
};

/** Piston/rod/tip x-layout for a given stroke position (0..1) - kept separate from the static
 * body draw so the live simulation can recompute it every frame without redrawing anything else. */
export function computeCylinderSinglePistonLayout(
  geo: CylinderSingleGeometry,
  pos: number,
): { px: number; rodX: number; rodWidth: number; tipX: number } {
  const travelStart = geo.pistonTravelStartInset;
  const travelEnd = geo.w - geo.pistonTravelEndInset;
  const px = travelStart + pos * (travelEnd - travelStart);
  const rodX = px + geo.pistonToRodGap;
  const tipX = px + (geo.w - geo.rodTipInset);
  return { px, rodX, rodWidth: Math.max(0, tipX - rodX), tipX };
}

export function drawCylinderSingleBody(
  g: SVGElement,
  geo: CylinderSingleGeometry,
): {
  piston: SVGRectElement;
  rod: SVGRectElement;
  rodTip: SVGRectElement;
  leadA: SVGLineElement;
  capPortX: number;
  rodPortX: number;
} {
  const body = createSvgEl('rect', {
    x: 0,
    y: 0,
    width: geo.w,
    height: geo.h,
    fill: '#fff',
    stroke: '#111',
    'stroke-width': 2,
  });
  const layout = computeCylinderSinglePistonLayout(geo, 0);
  const piston = createSvgEl('rect', {
    x: layout.px,
    y: 0,
    width: geo.pistonWidth,
    height: geo.h,
    fill: '#888',
  });
  const rod = createSvgEl('rect', {
    x: layout.rodX,
    y: geo.h / 2 - geo.rodHeight / 2,
    width: layout.rodWidth,
    height: geo.rodHeight,
    fill: '#888',
  });
  const rodTip = createSvgEl('rect', {
    x: layout.tipX,
    y: geo.h / 2 - geo.rodTipHeight / 2,
    width: geo.rodTipWidth,
    height: geo.rodTipHeight,
    fill: '#666',
  });

  // Spring symbol (right side, pushing the piston back when unpressurized).
  const springY = geo.h / 2;
  const springX0 = geo.w - geo.springInset;
  const seg = geo.springSegment;
  const spring = createSvgEl('path', {
    d: [
      `M ${springX0} ${springY}`,
      `l ${-seg} ${-8}`,
      `l ${-seg} ${16}`,
      `l ${-seg} ${-16}`,
      `l ${-seg} ${16}`,
    ].join(' '),
    fill: 'none',
    stroke: '#111',
    'stroke-width': 2,
  });

  const capPortX = geo.capPortInset;
  const rodPortX = geo.w - geo.rodPortInset;
  // Lead-in line reaching the exact port center (not just close to it), since a connected
  // port's own circle is hidden - any gap between the body and the port would otherwise show
  // up as a visible blank break in the wire. Repositioned in updatePortSide() when the port
  // moves between the cap and rod ends.
  const leadA = createSvgEl('line', {
    x1: capPortX,
    y1: geo.h,
    x2: capPortX,
    y2: geo.h + geo.portMargin,
    stroke: '#111',
    'stroke-width': 2,
  });
  g.append(body, piston, rod, rodTip, spring, leadA);

  return { piston, rod, rodTip, leadA, capPortX, rodPortX };
}

type CylinderMode = 'push' | 'pull';

export function createCylinderSingle(compLayer: HTMLElement, x: number, y: number): Component {
  const geo = CYLINDER_SINGLE_DEFAULT_GEOMETRY;
  let letter = nextCylinderLetter();
  const shell = buildComponentShell(compLayer, CYLINDER_SINGLE_TYPE, x, y, geo.svgW, geo.svgH, '', {
    x: geo.gx,
    y: geo.gy,
    w: geo.w,
    h: geo.h,
  });
  // Cylinders are what the sensor/contact names (A1, A0...) refer to, so show the name by
  // default; restore() still applies a saved project's own setting.
  shell.setNameVisible(true);

  const g = createSvgEl('g', { transform: `translate(${geo.gx},${geo.gy})` });
  const { piston, rod, rodTip, leadA, capPortX, rodPortX } = drawCylinderSingleBody(g, geo);
  shell.svg.appendChild(g);

  let mode: CylinderMode = 'push';
  const portACircle = createPort(g, 'A', capPortX, geo.h + geo.portMargin, 'V');

  const ports = { A: portACircle };

  let pos = 0;
  let normallyExtended = false;
  let sensors: CylinderSensor[] = defaultSensors(letter);
  let ventingNow = false;
  let fillingNow = false;
  let boreDiameter = DEFAULT_BORE_DIAMETER_MM;
  let rodDiameter = DEFAULT_ROD_DIAMETER_MM;
  let showForce = false;

  const forceLabelEl = document.createElement('div');
  forceLabelEl.className = 'forceLabel';
  forceLabelEl.style.display = 'none';
  shell.el.appendChild(forceLabelEl);

  function updateVisual(): void {
    const layout = computeCylinderSinglePistonLayout(geo, pos);
    piston.setAttribute('x', String(layout.px));
    rod.setAttribute('x', String(layout.rodX));
    rod.setAttribute('width', String(layout.rodWidth));
    rodTip.setAttribute('x', String(layout.tipX));
  }
  updateVisual();

  function updateLabel(): void {
    shell.setDefaultName(`Cylinder ${letter}`);
  }
  updateLabel();

  function updatePortSide(): void {
    const cx = mode === 'push' ? capPortX : rodPortX;
    portACircle.el.setAttribute('cx', String(cx));
    leadA.setAttribute('x1', String(cx));
    leadA.setAttribute('x2', String(cx));
    ports.A.cx = cx;
  }
  updatePortSide();

  function targetFor(pressurizedA: boolean): number {
    const restTarget = normallyExtended ? 1 : 0;
    return mode === 'push' ? (pressurizedA ? 1 : restTarget) : pressurizedA ? 0 : restTarget;
  }

  const comp: Component = {
    id: uid(),
    type: CYLINDER_SINGLE_TYPE,
    el: shell.el,
    x,
    y,
    svgW: geo.svgW,
    svgH: geo.svgH,
    gx: geo.gx,
    gy: geo.gy,
    ports,

    conductivityRule(): PortConnection[] {
      return [];
    },

    step(dt: number, ctx: SimStepContext): void {
      const pressurizedA = ctx.isPressurized('A');
      const target = targetFor(pressurizedA);
      // While air is coming in through A, only the supply side can restrict it (the spring side
      // vents to atmosphere directly, with no port or valve of its own). On the spring return
      // stroke, A is what the piston is now exhausting through - a flow control valve out that
      // way (a "meter-out" setup, the standard way to control cylinder speed) throttles the
      // return just as it would a driven stroke, and a shut-off exhaust (0) holds it.
      const multiplier =
        target === pos
          ? 0
          : pressurizedA
            ? ctx.flowMultiplierToNearestSource('A')
            : ctx.flowMultiplierToOpenExhaust('A');
      const moving = multiplier > 0;
      ventingNow = moving && !pressurizedA;
      fillingNow = moving && pressurizedA;

      if (target !== pos) {
        const dir = target > pos ? 1 : -1;
        const step = BASE_CYL_SPEED * multiplier * dt;
        pos += dir * Math.min(step, Math.abs(target - pos));
        pos = Math.max(0, Math.min(1, pos));
        updateVisual();
      }

      // Force keeps acting even once the piston has already reached the end of its stroke
      // (that's how clamping/pressing applications actually work), so this isn't gated on the
      // movement check above. Push mode ports air onto the full bore (cap end); pull mode's
      // port has moved to the rod end, so it only ever pushes against the smaller annular area.
      // The spring return stroke has no air force to report - it's not modeled with a rate.
      if (showForce) {
        // What port A is actually seeing, not the supply pressure - a regulator upstream lowers
        // the force this cylinder can develop.
        const drivePressure = ctx.pressureAt('A');
        const force = pressurizedA
          ? mode === 'push'
            ? forceFromArea(boreAreaMm2(boreDiameter), drivePressure)
            : forceFromArea(annularAreaMm2(boreDiameter, rodDiameter), drivePressure)
          : 0;
        forceLabelEl.textContent = `${force.toFixed(0)} N`;
        forceLabelEl.style.display = '';
      } else {
        forceLabelEl.style.display = 'none';
      }

      for (const sensor of sensors) {
        ctx.emitSignal(sensor.label, isInSensorRange(pos, sensor));
      }
    },

    snapshot(): Record<string, unknown> {
      return {
        pos,
        letter,
        mode,
        normallyExtended,
        sensors,
        showName: shell.getNameVisible(),
        customName: shell.getCustomName(),
        boreDiameter,
        rodDiameter,
        showForce,
      };
    },
    restore(data: Record<string, unknown>): void {
      pos = data.pos as number;
      letter = data.letter as string;
      mode = data.mode as CylinderMode;
      normallyExtended = data.normallyExtended as boolean;
      sensors = isValidSensorArray(data.sensors) ? data.sensors : defaultSensors(letter);
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      boreDiameter = (data.boreDiameter as number) || DEFAULT_BORE_DIAMETER_MM;
      rodDiameter = (data.rodDiameter as number) || DEFAULT_ROD_DIAMETER_MM;
      showForce = Boolean(data.showForce);
      // The actual force value depends on live pressurization, only known during step() - this
      // just gets the checkbox's own on/off state to take effect immediately (showing 0 N until
      // the sim's next tick recomputes it) instead of waiting on that next tick to even appear.
      forceLabelEl.style.display = showForce ? '' : 'none';
      if (showForce) forceLabelEl.textContent = '0 N';
      updatePortSide();
      updateLabel();
      updateVisual();
    },
    reset(): void {
      pos = normallyExtended ? 1 : 0;
      ventingNow = false;
      fillingNow = false;
      if (showForce) forceLabelEl.textContent = '0 N';
      updateVisual();
    },

    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
    currentlyVenting: () => (ventingNow ? ['A'] : []),
    currentlyFilling: () => (fillingNow ? ['A'] : []),

    relabel(): void {
      const oldLetter = letter;
      letter = nextCylinderLetter();
      sensors = relabelSensors(sensors, oldLetter, letter).sensors;
      updateLabel();
    },

    renameLabel(newValue: string): boolean {
      const trimmed = newValue.trim().toUpperCase();
      if (!/^[A-Z]$/.test(trimmed)) return false;
      if (trimmed !== letter && isCylinderLetterInUse(trimmed, comp.id)) return false;
      const oldLetter = letter;
      letter = trimmed;
      updateLabel();

      // Carry each auto-named sensor's label forward (A0 -> B0, etc.) and, since that's the
      // exact key a limit switch's "Sensor key" points at, update every switch bound to the old
      // label so it keeps working instead of silently going dead once nothing emits that name.
      const { sensors: renamedSensors, renames } = relabelSensors(sensors, oldLetter, trimmed);
      sensors = renamedSensors;
      for (const r of renames) renameSensorKeyBindings(r.oldLabel, r.newLabel);
      appState.markDirty();
      return true;
    },

    setCylinderMode(newMode: 'push' | 'pull'): void {
      if (mode === newMode) return;
      mode = newMode;
      // A configuration change, not a live simulation event - the piston snaps straight to the
      // new mode's own default rest position instead of animating there on the next step.
      normallyExtended = newMode === 'pull';
      pos = normallyExtended ? 1 : 0;
      updatePortSide();
      updateLabel();
      updateVisual();
      redrawAllConnections();
      appState.markDirty();
    },
  };

  return comp;
}
