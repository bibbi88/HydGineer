import type { Component, SimStepContext, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createSvgEl, createPort } from './shared/svgHelpers';
import { nextCylinderLetter, isCylinderLetterInUse } from './shared/letters';
import { BASE_CYL_SPEED } from '../sim/constants';
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

export const CYLINDER_DOUBLE_TYPE = 'cylinderDouble';

export interface CylinderDoubleGeometry {
  svgW: number;
  svgH: number;
  gx: number;
  gy: number;
  w: number;
  h: number;
  portMargin: number;
  portInsetA: number;
  portInsetB: number;
  pistonWidth: number;
  pistonTravelInset: number;
  pistonToRodGap: number;
  rodHeight: number;
  rodTipInset: number;
  rodTipWidth: number;
  rodTipHeight: number;
}

export const CYLINDER_DOUBLE_DEFAULT_GEOMETRY: CylinderDoubleGeometry = {
  svgW: 202,
  svgH: 84,
  gx: 8,
  gy: 8,
  w: 176,
  h: 56,
  // portMargin (8, not the "natural" 6) and portInsetA/B (13, not 10) are chosen together so
  // ports A/B land exactly on the 10px grid relative to this canvas's own center - see
  // src/core/grid.ts.
  portMargin: 8,
  portInsetA: 13,
  portInsetB: 13,
  pistonWidth: 6,
  pistonTravelInset: 10,
  pistonToRodGap: 6,
  rodHeight: 6,
  rodTipInset: 10,
  rodTipWidth: 10,
  rodTipHeight: 12,
};

/** Piston/rod/tip x-layout for a given stroke position (0..1) - kept separate from the static
 * body draw so the live simulation can recompute it every frame without redrawing anything else. */
export function computeCylinderDoublePistonLayout(
  geo: CylinderDoubleGeometry,
  pos: number,
): { px: number; rodX: number; rodWidth: number; tipX: number } {
  const px = geo.pistonTravelInset + pos * (geo.w - geo.pistonTravelInset * 2);
  const rodX = px + geo.pistonToRodGap;
  const tipX = px + (geo.w - geo.rodTipInset);
  return { px, rodX, rodWidth: Math.max(0, tipX - rodX), tipX };
}

export function drawCylinderDoubleBody(
  g: SVGElement,
  geo: CylinderDoubleGeometry,
): {
  piston: SVGRectElement;
  rod: SVGRectElement;
  rodTip: SVGRectElement;
  a: { cx: number; cy: number };
  b: { cx: number; cy: number };
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
  const layout = computeCylinderDoublePistonLayout(geo, 0);
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

  const A = { cx: geo.portInsetA, cy: geo.h + geo.portMargin };
  const B = { cx: geo.w - geo.portInsetB, cy: geo.h + geo.portMargin };
  // Lead-in lines reaching the exact port centers (not just close to them), since a connected
  // port's own circle is hidden - any gap between the body and the port would otherwise show
  // up as a visible blank break in the wire.
  const leadA = createSvgEl('line', {
    x1: A.cx,
    y1: geo.h,
    x2: A.cx,
    y2: A.cy,
    stroke: '#111',
    'stroke-width': 2,
  });
  const leadB = createSvgEl('line', {
    x1: B.cx,
    y1: geo.h,
    x2: B.cx,
    y2: B.cy,
    stroke: '#111',
    'stroke-width': 2,
  });
  g.append(body, piston, rod, rodTip, leadA, leadB);

  return { piston, rod, rodTip, a: A, b: B };
}

export function createCylinderDouble(compLayer: HTMLElement, x: number, y: number): Component {
  const geo = CYLINDER_DOUBLE_DEFAULT_GEOMETRY;
  let letter = nextCylinderLetter();
  const shell = buildComponentShell(
    compLayer,
    CYLINDER_DOUBLE_TYPE,
    x,
    y,
    geo.svgW,
    geo.svgH,
    `Cylinder ${letter}`,
    { x: geo.gx, y: geo.gy, w: geo.w, h: geo.h },
  );
  // Cylinders are what the sensor/contact names (A1, A0...) refer to, so show the name by
  // default; restore() still applies a saved project's own setting.
  shell.setNameVisible(true);
  const g = createSvgEl('g', { transform: `translate(${geo.gx},${geo.gy})` });
  const { piston, rod, rodTip, a: A, b: B } = drawCylinderDoubleBody(g, geo);
  shell.svg.appendChild(g);

  const ports = {
    A: createPort(g, 'A', A.cx, A.cy, 'V'),
    B: createPort(g, 'B', B.cx, B.cy, 'V'),
  };

  let pos = 0;
  let sensors: CylinderSensor[] = defaultSensors(letter);
  let ventingNow: 'A' | 'B' | null = null;
  let fillingNow: 'A' | 'B' | null = null;
  let boreDiameter = DEFAULT_BORE_DIAMETER_MM;
  let rodDiameter = DEFAULT_ROD_DIAMETER_MM;
  let showForce = false;

  const forceLabelEl = document.createElement('div');
  forceLabelEl.className = 'forceLabel';
  forceLabelEl.style.display = 'none';
  shell.el.appendChild(forceLabelEl);

  function updateVisual(): void {
    const layout = computeCylinderDoublePistonLayout(geo, pos);
    piston.setAttribute('x', String(layout.px));
    rod.setAttribute('x', String(layout.rodX));
    rod.setAttribute('width', String(layout.rodWidth));
    rodTip.setAttribute('x', String(layout.tipX));
  }
  updateVisual();

  const comp: Component = {
    id: uid(),
    type: CYLINDER_DOUBLE_TYPE,
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
      const aPressurized = ctx.isPressurized('A');
      const bPressurized = ctx.isPressurized('B');

      let target = pos;
      let drivingPort: 'A' | 'B' | null = null;
      let ventingPort: 'A' | 'B' | null = null;
      if (aPressurized && !bPressurized) {
        target = 1;
        drivingPort = 'A';
        ventingPort = 'B';
      } else if (bPressurized && !aPressurized) {
        target = 0;
        drivingPort = 'B';
        ventingPort = 'A';
      }

      // Whichever side is more restricted sets the pace - a flow control valve throttling the
      // exhausting chamber slows the piston down just as much as one throttling the supply
      // would, matching how these are actually used (a "meter-out" flow control on the exhaust
      // is the standard way to control cylinder speed in real pneumatics). A shut-off exhaust
      // (0) holds the piston where it is.
      const multiplier =
        drivingPort && ventingPort
          ? Math.min(
              ctx.flowMultiplierToNearestSource(drivingPort),
              ctx.flowMultiplierToOpenExhaust(ventingPort),
            )
          : 0;

      // Air only streams in and out while the piston is actually moving - not once it bottoms
      // out (no more volume to displace), nor while it's held by a shut-off exhaust.
      const moving = multiplier > 0 && target !== pos;
      ventingNow = moving ? ventingPort : null;
      fillingNow = moving ? drivingPort : null;

      if (drivingPort && ventingPort) {
        const dir = target > pos ? 1 : -1;
        const step = BASE_CYL_SPEED * multiplier * dt;
        pos += dir * Math.min(step, Math.abs(target - pos));
        pos = Math.max(0, Math.min(1, pos));
        updateVisual();
      }

      // Force keeps acting even once the piston has already reached the end of its stroke
      // (that's how clamping/pressing applications actually work) - so this reads `drivingPort`
      // directly rather than being gated on the movement check above. B's chamber is the
      // rod-side one (the rod passes out through the same end its port sits on), so it only
      // ever pushes against the smaller annular area, not the full bore.
      if (showForce) {
        // The pressure actually reaching the driven port, not the supply pressure - a regulator
        // upstream reduces the force this cylinder can develop, which is most of the reason to
        // fit one.
        const drivePressure = drivingPort ? ctx.pressureAt(drivingPort) : 0;
        const force =
          drivingPort === 'A'
            ? forceFromArea(boreAreaMm2(boreDiameter), drivePressure)
            : drivingPort === 'B'
              ? forceFromArea(annularAreaMm2(boreDiameter, rodDiameter), drivePressure)
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
      sensors = isValidSensorArray(data.sensors) ? data.sensors : defaultSensors(letter);
      shell.setDefaultName(`Cylinder ${letter}`);
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
      updateVisual();
    },
    reset(): void {
      pos = 0;
      ventingNow = null;
      fillingNow = null;
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
    currentlyVenting: () => (ventingNow ? [ventingNow] : []),
    currentlyFilling: () => (fillingNow ? [fillingNow] : []),

    relabel(): void {
      const oldLetter = letter;
      letter = nextCylinderLetter();
      sensors = relabelSensors(sensors, oldLetter, letter).sensors;
      shell.setDefaultName(`Cylinder ${letter}`);
    },

    renameLabel(newValue: string): boolean {
      const trimmed = newValue.trim().toUpperCase();
      if (!/^[A-Z]$/.test(trimmed)) return false;
      if (trimmed !== letter && isCylinderLetterInUse(trimmed, comp.id)) return false;
      const oldLetter = letter;
      letter = trimmed;
      shell.setDefaultName(`Cylinder ${letter}`);

      // Carry each auto-named sensor's label forward (A0 -> B0, etc.) and, since that's the
      // exact key a limit switch's "Sensor key" points at, update every switch bound to the old
      // label so it keeps working instead of silently going dead once nothing emits that name.
      const { sensors: renamedSensors, renames } = relabelSensors(sensors, oldLetter, trimmed);
      sensors = renamedSensors;
      for (const r of renames) renameSensorKeyBindings(r.oldLabel, r.newLabel);
      appState.markDirty();
      return true;
    },
  };

  return comp;
}
