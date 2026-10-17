import type { Component, PortConnection } from '../core/types';
import { uid } from '../core/ids';
import { appState } from '../app/AppState';
import { Modes } from '../app/modes';
import { getSignal } from '../sim/signals';
import { buildComponentShell, createPort, createSvgEl } from './shared/svgHelpers';

export const ELEC_RAIL_PLUS_TYPE = 'elecRailPlus';
export const ELEC_RAIL_ZERO_TYPE = 'elecRailZero';
export const ELEC_CONTACT_TYPE = 'elecContact';
export const ELEC_PUSH_BUTTON_TYPE = 'elecPushButton';
export const ELEC_CHANGEOVER_TYPE = 'elecChangeover';
export const ELEC_COIL_TYPE = 'elecCoil';
export const ELEC_SOLENOID_TYPE = 'elecSolenoid';
export const ELEC_LAMP_TYPE = 'elecLamp';

// Every two-terminal part (contacts, coil, lamp, push button) shares one canvas: terminals A
// (top) and B (bottom) 80px apart on the vertical centerline, so both land on the 10px grid
// relative to the canvas's own center (see src/core/grid.ts) and parts stack straight into a
// ladder-style diagram.
const TWO_TERMINAL_W = 60;
const TWO_TERMINAL_H = 100;
const CX = TWO_TERMINAL_W / 2;
const TOP_Y = 10;
const BOT_Y = TWO_TERMINAL_H - 10;
const CONTACT_TOP_Y = 34;
const CONTACT_BOT_Y = 66;

const STROKE = '#111';
/** Blade colour while a contact's signal is acting on it (see drawContactSymbol). */
const OPERATED_STROKE = '#1c6fd1';

function line(x1: number, y1: number, x2: number, y2: number, width = 2): SVGLineElement {
  return createSvgEl('line', { x1, y1, x2, y2, stroke: STROKE, 'stroke-width': width });
}

function textEl(x: number, y: number, size: number, anchor = 'middle'): SVGTextElement {
  return createSvgEl('text', { x, y, 'text-anchor': anchor, 'font-size': size, fill: STROKE });
}

/** The smallest unused `${prefix}${n}` among `type` components' `key`, so a freshly placed coil
 * doesn't start out sharing a name with one already in the diagram. */
function nextFreeKey(prefix: string, type: string): string {
  const used = new Set(
    appState.components
      .filter((c) => c.type === type)
      .map((c) => String((c.snapshot() as Record<string, unknown>).key ?? '').toUpperCase()),
  );
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

interface ElecBase {
  shell: ReturnType<typeof buildComponentShell>;
  g: SVGGElement;
}

function twoTerminalBase(
  compLayer: HTMLElement,
  type: string,
  x: number,
  y: number,
  label: string,
  /** Where the drawn artwork starts on the left, for the selection outline and wire avoidance -
   * the push button's bracket reaches further left than the other parts. */
  left = 8,
): ElecBase {
  const shell = buildComponentShell(compLayer, type, x, y, TWO_TERMINAL_W, TWO_TERMINAL_H, label, {
    x: left,
    y: 0,
    w: TWO_TERMINAL_W - 8 - left,
    h: TWO_TERMINAL_H,
  });
  const g = createSvgEl('g');
  shell.svg.appendChild(g);
  return { shell, g };
}

function twoTerminalPorts(g: SVGElement): Component['ports'] {
  return {
    A: createPort(g, 'A', CX, TOP_Y, 'V', { electrical: true }),
    B: createPort(g, 'B', CX, BOT_Y, 'V', { electrical: true }),
  };
}

/** IEC 60617 make/break contact drawn vertically: the blade pivots on the lower fixed contact and
 * an actuator always swings it the same way, clockwise, as for a real contact block. NO
 * (07-02-01): at rest the blade leans off to the left, short of the upper contact; operated it
 * stands straight up onto it. NC (07-02-03): the upper contact has a short hook to the right
 * and at rest the blade leans right and presses up against its end; operated it swings further
 * right and down, leaving a clear gap below the hook. While operated the blade is drawn in
 * {@link OPERATED_STROKE}, so it is obvious during a run which contacts their signal is
 * acting on, whether that opens or closes them. */
function drawContactSymbol(
  g: SVGElement,
  normallyClosed: boolean,
): {
  setOperated(operated: boolean): void;
  setNormallyClosed(nc: boolean): void;
  /** Where the blade crosses height `y`, for attaching an actuator's mechanical link. */
  bladeXAt(y: number): number;
} {
  g.append(line(CX, TOP_Y, CX, CONTACT_TOP_Y), line(CX, CONTACT_BOT_Y, CX, BOT_Y));
  const hook = line(CX, CONTACT_TOP_Y, CX + 12, CONTACT_TOP_Y);
  const blade = line(CX, CONTACT_BOT_Y, CX, CONTACT_TOP_Y);
  blade.setAttribute('stroke-linecap', 'round');
  g.append(hook, blade);

  let nc = normallyClosed;
  let operated = false;
  let end = { x: CX, y: CONTACT_TOP_Y };
  function apply(): void {
    if (nc) {
      end = operated ? { x: CX + 20, y: CONTACT_TOP_Y + 7 } : { x: CX + 14, y: CONTACT_TOP_Y - 3 };
    } else {
      end = operated ? { x: CX, y: CONTACT_TOP_Y } : { x: CX - 13, y: CONTACT_TOP_Y + 3 };
    }
    blade.setAttribute('x2', String(end.x));
    blade.setAttribute('y2', String(end.y));
    blade.setAttribute('stroke', operated ? OPERATED_STROKE : STROKE);
    hook.style.display = nc ? '' : 'none';
  }
  apply();

  return {
    setOperated(v: boolean): void {
      operated = v;
      apply();
    },
    setNormallyClosed(v: boolean): void {
      nc = v;
      apply();
    },
    bladeXAt: (y: number) => CX + ((end.x - CX) * (CONTACT_BOT_Y - y)) / (CONTACT_BOT_Y - end.y),
  };
}

/** The signal / coil name beside a contact or coil: on the left of the symbol, level with its
 * middle, right-aligned so it ends just short of the artwork. */
function keyLabel(g: SVGElement, x = CX - 14): SVGTextElement {
  const label = textEl(x, 54, 11, 'end');
  g.appendChild(label);
  return label;
}

function railComponent(
  compLayer: HTMLElement,
  x: number,
  y: number,
  kind: 'plus' | 'zero',
): Component {
  // Lying on its side with the output to the right, so it feeds straight across into the
  // current path beside it. The port stays 20px off the canvas center, on grid.
  const w = 60;
  const h = 40;
  const type = kind === 'plus' ? ELEC_RAIL_PLUS_TYPE : ELEC_RAIL_ZERO_TYPE;
  const shell = buildComponentShell(
    compLayer,
    type,
    x,
    y,
    w,
    h,
    kind === 'plus' ? '+24 V supply' : '0 V supply',
    { x: 5, y: 0, w: w - 10, h },
  );
  // IEC 60617 terminal (03-02-02, an open circle) with the conductor running right to the port.
  // The voltage is written above the terminal.
  const TERM_R = 4;
  const termX = 16;
  const portX = 50;
  const midY = h / 2;
  shell.svg.append(
    line(termX + TERM_R, midY, portX, midY),
    createSvgEl('circle', {
      cx: termX,
      cy: midY,
      r: TERM_R,
      fill: '#fff',
      stroke: STROKE,
      'stroke-width': 2,
    }),
  );
  const label = textEl(termX, midY - TERM_R - 5, 11);
  label.textContent = kind === 'plus' ? '+24V' : '0V';
  shell.svg.appendChild(label);
  const ports = { P: createPort(shell.svg, 'P', portX, midY, 'H', { electrical: true }) };

  const comp: Component = {
    id: uid(),
    type,
    el: shell.el,
    x,
    y,
    svgW: w,
    svgH: h,
    gx: 0,
    gy: 0,
    ports,
    electrical: { role: { kind, port: 'P' } },
    conductivityRule: (): PortConnection[] => [],
    snapshot: () => ({ showName: shell.getNameVisible(), customName: shell.getCustomName() }),
    restore(data: Record<string, unknown>): void {
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
    },
    reset(): void {},
    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
  };
  return comp;
}

export function createElecRailPlus(compLayer: HTMLElement, x: number, y: number): Component {
  return railComponent(compLayer, x, y, 'plus');
}

export function createElecRailZero(compLayer: HTMLElement, x: number, y: number): Component {
  return railComponent(compLayer, x, y, 'zero');
}

/**
 * A contact driven by a named signal: a relay contact (key = the relay coil's name, e.g. "K1")
 * or a cylinder position sensor (key = the sensor label, e.g. "A1"), normally open or normally
 * closed. Reads the same signal bus the coils and cylinders publish to.
 */
export function createElecContact(compLayer: HTMLElement, x: number, y: number): Component {
  const { shell, g } = twoTerminalBase(compLayer, ELEC_CONTACT_TYPE, x, y, 'Contact');
  let key = '';
  let normallyClosed = false;
  let closed = false;
  const symbol = drawContactSymbol(g, normallyClosed);
  const label = keyLabel(g);
  const ports = twoTerminalPorts(g);

  function refreshLabel(): void {
    label.textContent = key;
    symbol.setNormallyClosed(normallyClosed);
  }
  refreshLabel();

  const comp: Component = {
    id: uid(),
    type: ELEC_CONTACT_TYPE,
    el: shell.el,
    x,
    y,
    svgW: TWO_TERMINAL_W,
    svgH: TWO_TERMINAL_H,
    gx: 0,
    gy: 0,
    ports,
    electrical: {
      closedEdges: (): PortConnection[] => (closed ? [{ a: 'A', b: 'B' }] : []),
    },
    conductivityRule: (): PortConnection[] => [],
    recompute(): void {
      const sig = key ? getSignal(key) : false;
      closed = normallyClosed ? !sig : sig;
      symbol.setOperated(sig);
    },
    snapshot: () => ({
      key,
      normallyClosed,
      showName: shell.getNameVisible(),
      customName: shell.getCustomName(),
    }),
    restore(data: Record<string, unknown>): void {
      key = (data.key as string) ?? '';
      normallyClosed = Boolean(data.normallyClosed);
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      refreshLabel();
      comp.recompute?.();
    },
    reset(): void {
      closed = false;
      comp.recompute?.();
    },
    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
  };
  comp.recompute?.();
  return comp;
}

/**
 * A changeover contact (växelkontakt, IEC 60617 07-02-04) driven by a named signal, like
 * {@link createElecContact}: the common terminal (bottom) connects to NC (top left) at rest and
 * switches over to NO (top right, in line with the common) while the signal is on.
 */
export function createElecChangeover(compLayer: HTMLElement, x: number, y: number): Component {
  const { shell, g } = twoTerminalBase(compLayer, ELEC_CHANGEOVER_TYPE, x, y, 'Changeover');
  const NC_X = CX - 20;
  let key = '';
  let operated = false;
  g.append(
    line(CX, CONTACT_BOT_Y, CX, BOT_Y),
    line(CX, TOP_Y, CX, CONTACT_TOP_Y),
    line(NC_X, TOP_Y, NC_X, CONTACT_TOP_Y),
    line(NC_X, CONTACT_TOP_Y, NC_X + 10, CONTACT_TOP_Y),
  );
  const blade = line(CX, CONTACT_BOT_Y, CX, CONTACT_TOP_Y);
  blade.setAttribute('stroke-linecap', 'round');
  g.appendChild(blade);
  const label = keyLabel(g);
  const ports: Component['ports'] = {
    NC: createPort(g, 'NC', NC_X, TOP_Y, 'V', { electrical: true }),
    NO: createPort(g, 'NO', CX, TOP_Y, 'V', { electrical: true }),
    COM: createPort(g, 'COM', CX, BOT_Y, 'V', { electrical: true }),
  };

  function refresh(): void {
    label.textContent = key;
    // At rest the blade leans left past the NC hook; operated it stands up onto the NO contact.
    blade.setAttribute('x2', String(operated ? CX : NC_X + 6));
    blade.setAttribute('y2', String(operated ? CONTACT_TOP_Y : CONTACT_TOP_Y - 3));
    blade.setAttribute('stroke', operated ? OPERATED_STROKE : STROKE);
  }
  refresh();

  const comp: Component = {
    id: uid(),
    type: ELEC_CHANGEOVER_TYPE,
    el: shell.el,
    x,
    y,
    svgW: TWO_TERMINAL_W,
    svgH: TWO_TERMINAL_H,
    gx: 0,
    gy: 0,
    ports,
    electrical: {
      closedEdges: (): PortConnection[] => [{ a: 'COM', b: operated ? 'NO' : 'NC' }],
    },
    conductivityRule: (): PortConnection[] => [],
    recompute(): void {
      operated = key ? getSignal(key) : false;
      refresh();
    },
    snapshot: () => ({
      key,
      showName: shell.getNameVisible(),
      customName: shell.getCustomName(),
    }),
    restore(data: Record<string, unknown>): void {
      key = (data.key as string) ?? '';
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      comp.recompute?.();
    },
    reset(): void {
      comp.recompute?.();
    },
    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
  };
  comp.recompute?.();
  return comp;
}

/** A manually operated contact: held closed (NO) or open (NC) while the mouse is pressed on it
 * during a run; Ctrl+click latches it, like the pneumatic push button. With `detent` set it is a
 * latching (detent) push button instead: every click toggles it, staying put in between. */
export function createElecPushButton(compLayer: HTMLElement, x: number, y: number): Component {
  const HEAD_X = CX - 30;
  const { shell, g } = twoTerminalBase(
    compLayer,
    ELEC_PUSH_BUTTON_TYPE,
    x,
    y,
    'Push button',
    HEAD_X - 2,
  );
  let normallyClosed = false;
  let pressed = false;
  let latched = false;
  let detent = false;
  const symbol = drawContactSymbol(g, normallyClosed);
  // IEC 60617 02-13-05 "operated by pushing": a "[" bracket on the left, joined to the blade by
  // a dashed mechanical link (02-12-01). The link is level and meets the bracket at its middle,
  // so the bracket reads symmetric whichever way the blade leans. Pressing slides the bracket
  // toward the contact.
  const HEAD_Y = 50;
  const linkAttrs = {
    y1: HEAD_Y,
    y2: HEAD_Y,
    stroke: STROKE,
    'stroke-width': 1.5,
    'stroke-dasharray': '3 2',
  };
  // Two pieces so the link can break around the detent; without one the second stays hidden
  // and the first runs the whole way.
  const link = createSvgEl('line', linkAttrs);
  const linkAfter = createSvgEl('line', linkAttrs);
  const head = createSvgEl('path', {
    d: `M ${HEAD_X + 4} ${HEAD_Y - 8} H ${HEAD_X} V ${HEAD_Y + 8} H ${HEAD_X + 4}`,
    fill: 'none',
    stroke: STROKE,
    'stroke-width': 2,
  });
  // Detent (latching), shown only when set: the link breaks and a small V notch hangs below the
  // gap, its open side on the link's line.
  const detentMark = createSvgEl('path', {
    fill: 'none',
    stroke: STROKE,
    'stroke-width': 1.5,
    'stroke-linejoin': 'round',
  });
  g.append(link, linkAfter, head, detentMark);
  const ports = twoTerminalPorts(g);

  function isClosed(): boolean {
    return normallyClosed ? !pressed : pressed;
  }
  function refresh(): void {
    symbol.setNormallyClosed(normallyClosed);
    symbol.setOperated(pressed);
    const shift = pressed ? 4 : 0;
    head.setAttribute('transform', shift ? `translate(${shift},0)` : '');
    const bladeX = symbol.bladeXAt(HEAD_Y);
    const startX = HEAD_X + shift;
    const nx = (startX + bladeX) / 2;
    const GAP = 5;
    link.setAttribute('x1', String(startX));
    link.setAttribute('x2', String(detent ? nx - GAP : bladeX));
    linkAfter.setAttribute('x1', String(nx + GAP));
    linkAfter.setAttribute('x2', String(bladeX));
    linkAfter.style.display = detent ? '' : 'none';
    detentMark.setAttribute(
      'd',
      `M ${nx - 4} ${HEAD_Y} L ${nx} ${HEAD_Y + 7} L ${nx + 4} ${HEAD_Y}`,
    );
    detentMark.style.display = detent ? '' : 'none';
  }
  refresh();

  const comp: Component = {
    id: uid(),
    type: ELEC_PUSH_BUTTON_TYPE,
    el: shell.el,
    x,
    y,
    svgW: TWO_TERMINAL_W,
    svgH: TWO_TERMINAL_H,
    gx: 0,
    gy: 0,
    ports,
    electrical: {
      closedEdges: (): PortConnection[] => (isClosed() ? [{ a: 'A', b: 'B' }] : []),
    },
    conductivityRule: (): PortConnection[] => [],
    snapshot: () => ({
      normallyClosed,
      detent,
      showName: shell.getNameVisible(),
      customName: shell.getCustomName(),
    }),
    restore(data: Record<string, unknown>): void {
      normallyClosed = Boolean(data.normallyClosed);
      detent = Boolean(data.detent);
      if (!detent && latched && pressed) {
        latched = false;
        pressed = false;
      }
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      refresh();
    },
    reset(): void {
      pressed = false;
      latched = false;
      refresh();
    },
    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
  };

  function setPressed(v: boolean): void {
    if (pressed === v) return;
    pressed = v;
    refresh();
  }
  shell.svg.addEventListener('mousedown', (e) => {
    if (appState.mode === Modes.STOP) return;
    if (latched) {
      latched = false;
      setPressed(false);
      return;
    }
    if (detent || e.ctrlKey) latched = true;
    setPressed(true);
  });
  window.addEventListener('mouseup', () => {
    if (!latched) setPressed(false);
  });
  shell.svg.addEventListener('mouseleave', () => {
    if (!latched) setPressed(false);
  });

  return comp;
}

/** A relay coil (IEC 60617 07-15-01, a plain box) or a valve solenoid (the ISO 1219-1
 * single-winding actuator, a box with one oblique stroke - the same symbol the solenoid valves
 * carry). Either way, while energized it publishes its name on the signal bus: contacts with the
 * same key follow it, and a solenoid valve with the same key shifts. The two only differ in
 * their artwork and default name series (K for relays, Y for solenoids). */
function coilComponent(
  compLayer: HTMLElement,
  x: number,
  y: number,
  kind: 'relay' | 'solenoid',
): Component {
  const type = kind === 'relay' ? ELEC_COIL_TYPE : ELEC_SOLENOID_TYPE;
  const { shell, g } = twoTerminalBase(
    compLayer,
    type,
    x,
    y,
    kind === 'relay' ? 'Relay coil' : 'Solenoid',
  );
  let key = kind === 'relay' ? nextFreeKey('K', type) : nextFreeKey('Y', type);
  const BOX_TOP = 39;
  const BOX_BOT = 61;
  const BOX_W = 36;
  const body = createSvgEl('rect', {
    x: CX - BOX_W / 2,
    y: BOX_TOP,
    width: BOX_W,
    height: BOX_BOT - BOX_TOP,
    fill: '#fff',
    stroke: STROKE,
    'stroke-width': 2,
  });
  g.append(line(CX, TOP_Y, CX, BOX_TOP), line(CX, BOX_BOT, CX, BOT_Y), body);
  if (kind === 'solenoid') {
    g.appendChild(line(CX - BOX_W / 2, BOX_BOT, CX + BOX_W / 2, BOX_TOP));
  }
  const label = keyLabel(g, CX - BOX_W / 2 - 2);
  const ports = twoTerminalPorts(g);

  function refreshLabel(): void {
    label.textContent = key;
  }
  refreshLabel();

  const comp: Component = {
    id: uid(),
    type,
    el: shell.el,
    x,
    y,
    svgW: TWO_TERMINAL_W,
    svgH: TWO_TERMINAL_H,
    gx: 0,
    gy: 0,
    ports,
    electrical: {
      get load() {
        return { a: 'A', b: 'B', key };
      },
      setEnergized(v: boolean): void {
        body.setAttribute('fill', v ? '#ffd966' : '#fff');
      },
    },
    conductivityRule: (): PortConnection[] => [],
    snapshot: () => ({
      key,
      showName: shell.getNameVisible(),
      customName: shell.getCustomName(),
    }),
    restore(data: Record<string, unknown>): void {
      key = (data.key as string) ?? key;
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
      refreshLabel();
    },
    reset(): void {
      comp.electrical?.setEnergized?.(false);
    },
    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
  };
  return comp;
}

/** A relay coil: contacts keyed to its name (default K1, K2, ...) follow it. */
export function createElecCoil(compLayer: HTMLElement, x: number, y: number): Component {
  return coilComponent(compLayer, x, y, 'relay');
}

/** A valve solenoid: the solenoid valve whose coil has the same name (default Y1, Y2, ...)
 * shifts while it is energized. */
export function createElecSolenoid(compLayer: HTMLElement, x: number, y: number): Component {
  return coilComponent(compLayer, x, y, 'solenoid');
}

/** Before the dedicated solenoid existed, a valve was driven by a plain coil sharing its name.
 * A saved coil whose name matches one of the project's solenoid valve coils (`solenoidKeys`,
 * upper-cased) is loaded as a solenoid instead, so it gets the symbol it stands for. */
export function upgradedCoilType(
  type: string,
  data: Record<string, unknown>,
  solenoidKeys: Set<string>,
): string {
  if (type !== ELEC_COIL_TYPE || typeof data.key !== 'string') return type;
  return solenoidKeys.has(data.key.trim().toUpperCase()) ? ELEC_SOLENOID_TYPE : type;
}

export function createElecLamp(compLayer: HTMLElement, x: number, y: number): Component {
  const { shell, g } = twoTerminalBase(compLayer, ELEC_LAMP_TYPE, x, y, 'Lamp');
  const bulb = createSvgEl('circle', {
    cx: CX,
    cy: 50,
    r: 14,
    fill: '#fff',
    stroke: STROKE,
    'stroke-width': 2,
  });
  g.append(
    line(CX, TOP_Y, CX, 36),
    line(CX, 64, CX, BOT_Y),
    bulb,
    line(CX - 10, 40, CX + 10, 60),
    line(CX - 10, 60, CX + 10, 40),
  );
  const ports = twoTerminalPorts(g);

  const comp: Component = {
    id: uid(),
    type: ELEC_LAMP_TYPE,
    el: shell.el,
    x,
    y,
    svgW: TWO_TERMINAL_W,
    svgH: TWO_TERMINAL_H,
    gx: 0,
    gy: 0,
    ports,
    electrical: {
      load: { a: 'A', b: 'B', key: '' },
      setEnergized(v: boolean): void {
        bulb.setAttribute('fill', v ? '#ffe45c' : '#fff');
      },
    },
    conductivityRule: (): PortConnection[] => [],
    snapshot: () => ({ showName: shell.getNameVisible(), customName: shell.getCustomName() }),
    restore(data: Record<string, unknown>): void {
      shell.setNameVisible(Boolean(data.showName));
      shell.setCustomName((data.customName as string | null) ?? null);
    },
    reset(): void {
      comp.electrical?.setEnergized?.(false);
    },
    setPos(nx: number, ny: number): void {
      comp.x = nx;
      comp.y = ny;
      shell.setPos(nx, ny);
    },
    getBounds: shell.getBounds,
    setSelected: shell.setSelected,
  };
  return comp;
}
