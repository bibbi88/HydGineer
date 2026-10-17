import type { Component, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createSvgEl } from './shared/svgHelpers';
import {
  buildSlidingValve32Body,
  SLIDING_VALVE_W,
  SLIDING_VALVE_H,
  SLIDING_VALVE_OFFSET_X,
  SLIDING_VALVE_OFFSET_Y,
} from './shared/slidingValve32';
import { getSignal } from '../sim/signals';
import { appState } from '../app/AppState';
import { isSensorKeyBoundElsewhere } from './shared/sensorPositions';
import { addSpringZigzag, SPRING_DEFAULT_GEOMETRY } from './shared/spring';

export const LIMIT_VALVE_32_TYPE = 'limitValve32';

// Extra right-side room for the spring symbol, beyond the offset already reserved on the left.
// (+50/+34 rather than the "natural" +48/+30: chosen so ports 1/2/3 land exactly on the 10px
// grid relative to this canvas's own center - see src/core/grid.ts.)
const SVG_W = SLIDING_VALVE_OFFSET_X + SLIDING_VALVE_W + 50;
const SVG_H = SLIDING_VALVE_OFFSET_Y + SLIDING_VALVE_H + 34;

export interface LimitValve32Geometry {
  /** x of the roller-lever group, relative to the mover's own origin. */
  rollerX: number;
  rollerArmStartX: number;
  rollerArmReach: number;
  rollerArmHalfY: number;
  rollerOuterR: number;
  rollerInnerR: number;
  rollerCenterX: number;
  labelYOffset: number;
  /** Return spring - see SPRING_DEFAULT_GEOMETRY in shared/spring.ts, which every
   * valve's spring is drawn from so the symbol set shares one design. */
  springSpan: number;
  springSegLen: number;
  springZigW: number;
  springZigH: number;
}

export const LIMIT_VALVE_32_DEFAULT_GEOMETRY: LimitValve32Geometry = {
  rollerX: -34,
  rollerArmStartX: -6,
  rollerArmReach: 35,
  rollerArmHalfY: 7,
  rollerOuterR: 13,
  rollerInnerR: 6,
  rollerCenterX: 4,
  labelYOffset: -18,
  springSpan: SPRING_DEFAULT_GEOMETRY.springSpan,
  springSegLen: SPRING_DEFAULT_GEOMETRY.springSegLen,
  springZigW: SPRING_DEFAULT_GEOMETRY.springZigW,
  springZigH: SPRING_DEFAULT_GEOMETRY.springZigH,
};

/** Draws the roller lever + arms + spring into the mover, matching the original app's
 * roller-lever limit-switch artwork. Coordinates are local to the mover, not the canvas. */
export function drawLimitValve32Actuator(
  mover: SVGGElement,
  geo: LimitValve32Geometry,
): { sensorLabel: SVGTextElement } {
  const rollerGroup = createSvgEl('g', {
    transform: `translate(${geo.rollerX}, ${SLIDING_VALVE_H / 2})`,
  });
  rollerGroup.appendChild(
    createSvgEl('path', {
      d: `M ${geo.rollerArmStartX} ${-geo.rollerArmHalfY} L ${geo.rollerArmReach} ${-geo.rollerArmHalfY}`,
      fill: 'none',
      stroke: '#111',
      'stroke-width': 2,
    }),
  );
  rollerGroup.appendChild(
    createSvgEl('path', {
      d: `M ${geo.rollerArmStartX} ${geo.rollerArmHalfY} L ${geo.rollerArmReach} ${geo.rollerArmHalfY}`,
      fill: 'none',
      stroke: '#111',
      'stroke-width': 2,
    }),
  );
  rollerGroup.appendChild(
    createSvgEl('circle', {
      cx: geo.rollerCenterX,
      cy: 0,
      r: geo.rollerOuterR,
      fill: '#fff',
      stroke: '#111',
      'stroke-width': 2,
    }),
  );
  rollerGroup.appendChild(
    createSvgEl('circle', {
      cx: geo.rollerCenterX,
      cy: 0,
      r: geo.rollerInnerR,
      fill: '#fff',
      stroke: '#111',
      'stroke-width': 2,
    }),
  );
  const sensorLabel = createSvgEl('text', {
    x: geo.rollerCenterX,
    y: geo.labelYOffset,
    'text-anchor': 'middle',
    'font-size': 11,
  });
  rollerGroup.appendChild(sensorLabel);

  const spring = createSvgEl('g', {
    transform: `translate(${SLIDING_VALVE_W}, ${SLIDING_VALVE_H / 2})`,
  });
  addSpringZigzag(spring, 0, geo.springSpan, 0, 2, geo);

  mover.append(rollerGroup, spring);
  return { sensorLabel };
}

export function createLimitValve32(compLayer: HTMLElement, x: number, y: number): Component {
  const geo = LIMIT_VALVE_32_DEFAULT_GEOMETRY;
  const shell = buildComponentShell(
    compLayer,
    LIMIT_VALVE_32_TYPE,
    x,
    y,
    SVG_W,
    SVG_H,
    '3/2 limit valve',
    {
      x: SLIDING_VALVE_OFFSET_X,
      y: SLIDING_VALVE_OFFSET_Y,
      w: SLIDING_VALVE_W,
      h: SLIDING_VALVE_H,
    },
  );
  const valve = buildSlidingValve32Body(shell.svg, `arrow-limit-${uid()}`);
  const { sensorLabel } = drawLimitValve32Actuator(valve.mover, geo);

  const id = uid();

  let active = false;
  // Swaps the two cells so the valve passes 1 -> 2 at rest instead of blocking it, turning it
  // normally open - see pushButton32.ts, which this mirrors. Only the artwork and the rule
  // change: actuating still slides the mover the same way, so the actuator animates identically
  // either way round.
  let normallyOpen = false;

  /** True while 1 is connected through to 2, whichever combination of actuated and
   * normally-open produced it - both the symbol and the rule follow this one value. */
  function flowing(): boolean {
    return active !== normallyOpen;
  }
  // A freshly placed limit switch starts unbound rather than defaulting to some sensor - every
  // new one used to default to the same fixed key (or, later, "whichever is free"), either of
  // which still means guessing at a binding you'd probably change anyway. Starting blank also
  // makes swapping two switches' labels possible without relocating either: clear one, give its
  // label to the other, then give the first one what's now free.
  let sensorKey = '';
  let manualActive = false;

  // Two limit switches sharing a sensor is allowed (a real circuit might legitimately fan one
  // signal out to several valves) rather than blocked, but it's easy to do by accident (e.g.
  // two switches both left at a stale default) - flagging it in red is a middle ground between
  // silently allowing it and refusing to let the assignment happen at all. Rechecked on every
  // appState change (not just this switch's own), since the conflict can appear or disappear
  // because of what some *other* switch just did.
  function updateLabel(): void {
    sensorLabel.textContent = sensorKey || '';
    const duplicate = sensorKey !== '' && isSensorKeyBoundElsewhere(sensorKey, id);
    sensorLabel.classList.toggle('sensorLabelDuplicate', duplicate);
  }
  updateLabel();
  appState.onChange(updateLabel);

  const comp: Component = {
    id,
    type: LIMIT_VALVE_32_TYPE,
    el: shell.el,
    x,
    y,
    svgW: SVG_W,
    svgH: SVG_H,
    gx: 0,
    gy: 0,
    ports: valve.ports,

    conductivityRule(): PortConnection[] {
      return flowing() ? [{ a: '2', b: '1' }] : [{ a: '2', b: '3' }];
    },

    recompute(): void {
      active = sensorKey ? getSignal(sensorKey) : manualActive;
      valve.setActive(active);
    },

    snapshot(): Record<string, unknown> {
      return {
        active,
        normallyOpen,
        sensorKey,
        showName: shell.getNameVisible(),
        customName: shell.getCustomName(),
        silencer3: valve.getSilencer(),
      };
    },
    restore(data: Record<string, unknown>): void {
      active = data.active as boolean;
      normallyOpen = Boolean(data.normallyOpen);
      sensorKey = data.sensorKey as string;
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      valve.setSilencer((data.silencer3 as 'none' | 'silencer') ?? 'silencer');
      updateLabel();
      valve.setSwapped(normallyOpen);
      valve.setActive(active);
    },
    reset(): void {
      active = false;
      manualActive = false;
      valve.setActive(false);
    },

    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
  };

  valve.setActive(false);

  return comp;
}
