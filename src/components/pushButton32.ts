import type { Component, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { buildComponentShell, createSvgEl } from './shared/svgHelpers';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import {
  buildSlidingValve32Body,
  SLIDING_VALVE_W,
  SLIDING_VALVE_H,
  SLIDING_VALVE_OFFSET_X,
  SLIDING_VALVE_OFFSET_Y,
} from './shared/slidingValve32';
import { addSpringZigzag, SPRING_DEFAULT_GEOMETRY } from './shared/spring';

export const PUSH_BUTTON_32_TYPE = 'pushButton32';

// Extra right-side room for the spring symbol, beyond the offset already reserved on the left.
// (+50/+34 rather than the "natural" +48/+30: chosen so ports 1/2/3 land exactly on the 10px
// grid relative to this canvas's own center - see src/core/grid.ts.)
const SVG_W = SLIDING_VALVE_OFFSET_X + SLIDING_VALVE_W + 50;
const SVG_H = SLIDING_VALVE_OFFSET_Y + SLIDING_VALVE_H + 34;
const MID_X = SLIDING_VALVE_OFFSET_X + SLIDING_VALVE_W / 2;

export interface PushButton32Geometry {
  /** x of the actuator rod/fork, relative to the mover's own origin (negative = left of it). */
  actuatorX: number;
  actuatorTopInset: number;
  actuatorBottomInset: number;
  /** y of each fork bar, from the frame's top/bottom edge. */
  forkYInset: number;
  /** Return spring - see SPRING_DEFAULT_GEOMETRY in shared/spring.ts, which every
   * valve's spring is drawn from so the symbol set shares one design. */
  springSpan: number;
  springSegLen: number;
  springZigW: number;
  springZigH: number;
}

export const PUSH_BUTTON_32_DEFAULT_GEOMETRY: PushButton32Geometry = {
  actuatorX: -20,
  actuatorTopInset: 10,
  actuatorBottomInset: 10,
  forkYInset: 20,
  springSpan: SPRING_DEFAULT_GEOMETRY.springSpan,
  springSegLen: SPRING_DEFAULT_GEOMETRY.springSegLen,
  springZigW: SPRING_DEFAULT_GEOMETRY.springZigW,
  springZigH: SPRING_DEFAULT_GEOMETRY.springZigH,
};

/** Draws the button's own actuator (rod + fork + spring) into the mover, matching the original
 * app's pushButton32 artwork. Coordinates are local to the mover, not the canvas. */
export function drawPushButton32Actuator(mover: SVGGElement, geo: PushButton32Geometry): void {
  const actuator = createSvgEl('line', {
    x1: geo.actuatorX,
    y1: geo.actuatorTopInset,
    x2: geo.actuatorX,
    y2: SLIDING_VALVE_H - geo.actuatorBottomInset,
    stroke: '#111',
    'stroke-width': 2,
  });
  const forkTop = createSvgEl('path', {
    d: `M ${geo.actuatorX} ${geo.forkYInset} L 0 ${geo.forkYInset}`,
    fill: 'none',
    stroke: '#111',
    'stroke-width': 2,
  });
  const forkBot = createSvgEl('path', {
    d: `M ${geo.actuatorX} ${SLIDING_VALVE_H - geo.forkYInset} L 0 ${SLIDING_VALVE_H - geo.forkYInset}`,
    fill: 'none',
    stroke: '#111',
    'stroke-width': 2,
  });
  const spring = createSvgEl('g', {
    transform: `translate(${SLIDING_VALVE_W}, ${SLIDING_VALVE_H / 2})`,
  });
  addSpringZigzag(spring, 0, geo.springSpan, 0, 2, geo);
  mover.append(forkTop, forkBot, actuator, spring);
}

export function createPushButton32(compLayer: HTMLElement, x: number, y: number): Component {
  const geo = PUSH_BUTTON_32_DEFAULT_GEOMETRY;
  const shell = buildComponentShell(
    compLayer,
    PUSH_BUTTON_32_TYPE,
    x,
    y,
    SVG_W,
    SVG_H,
    '3/2 push button',
    {
      x: SLIDING_VALVE_OFFSET_X,
      y: SLIDING_VALVE_OFFSET_Y,
      w: SLIDING_VALVE_W,
      h: SLIDING_VALVE_H,
    },
  );
  const valve = buildSlidingValve32Body(shell.svg, `arrow-push-${uid()}`);
  drawPushButton32Actuator(valve.mover, geo);

  let active = false;
  // Swaps the two cells so the valve passes 1 -> 2 at rest and vents 2 -> 3 when pressed, the
  // reverse of the default. Only the artwork and the conductivity rule change - pressing still
  // slides the mover the same way, so the button and its spring animate identically either way.
  let normallyOpen = false;

  /** True while 1 is connected through to 2, whichever combination of pressed and
   * normally-open produced it - both the symbol and the rule follow this one value. */
  function flowing(): boolean {
    return active !== normallyOpen;
  }
  // True while the button is held active by a CTRL-click latch rather than the mouse being
  // physically down - lets one button stay pressed while the user operates another with plain
  // clicks, matching a real "detent" pushbutton.
  let latched = false;

  const comp: Component = {
    id: uid(),
    type: PUSH_BUTTON_32_TYPE,
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
      valve.setActive(active);
    },

    snapshot(): Record<string, unknown> {
      return {
        active,
        normallyOpen,
        showName: shell.getNameVisible(),
        customName: shell.getCustomName(),
        silencer3: valve.getSilencer(),
      };
    },
    restore(data: Record<string, unknown>): void {
      active = data.active as boolean;
      normallyOpen = Boolean(data.normallyOpen);
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      valve.setSilencer((data.silencer3 as 'none' | 'silencer') ?? 'silencer');
      valve.setSwapped(normallyOpen);
      valve.setActive(active);
    },
    reset(): void {
      active = false;
      latched = false;
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

  function setActive(a: boolean): void {
    if (active === a) return;
    active = a;
    valve.setActive(a);
  }

  function isInLeftHalf(clientX: number): boolean {
    const rect = shell.svg.getBoundingClientRect();
    return clientX - rect.left < (MID_X / SVG_W) * rect.width;
  }

  shell.svg.addEventListener('mousedown', (e) => {
    if (appState.mode === Modes.STOP) return;
    if (!isInLeftHalf(e.clientX)) return;
    if (latched) {
      // A second mouse-press on an already-latched button releases it.
      latched = false;
      setActive(false);
      return;
    }
    if (e.ctrlKey) {
      latched = true;
      setActive(true);
      return;
    }
    setActive(true);
  });
  window.addEventListener('mouseup', () => {
    if (!latched) setActive(false);
  });
  shell.svg.addEventListener('mouseleave', () => {
    if (!latched) setActive(false);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control' && latched) {
      latched = false;
      setActive(false);
    }
  });

  valve.setActive(false);

  return comp;
}
