import type { ComponentBounds, PortDef, PortKey } from '../../core/types';
import { rotateQuarter } from '../../geometry/coords';

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function createSvgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export interface ComponentShell {
  el: HTMLDivElement;
  svg: SVGSVGElement;
  labelEl: HTMLDivElement;
  setPos(x: number, y: number): void;
  getBounds(): ComponentBounds;
  setSelected(sel: boolean): void;
  /** Sets the auto-generated name shown when no custom name is set (e.g. "Cylinder A",
   * "Throttle valve (50%)") - components whose default name can change at runtime should call this
   * instead of writing to `labelEl` directly, so a custom name (and the hidden-by-default
   * visibility) keeps taking priority over it correctly. */
  setDefaultName(text: string): void;
  setNameVisible(visible: boolean): void;
  getNameVisible(): boolean;
  /** null means "use the default name" - an empty/whitespace-only string is treated the same. */
  setCustomName(name: string | null): void;
  getCustomName(): string | null;
  /** Changes the canvas size after creation, for a component whose artwork grows and shrinks
   * (a text note). The bounds become the whole new canvas; the component stays centered on
   * its position. */
  resize(w: number, h: number): void;
}

export function buildComponentShell(
  compLayer: HTMLElement,
  type: string,
  x: number,
  y: number,
  svgW: number,
  svgH: number,
  label: string,
  /** Local box (within the svg's own 0..svgW/0..svgH canvas) that getBounds() should report
   * instead of the full padded canvas - e.g. just the component's drawn body rectangle, so
   * obstacle avoidance/selection reflects what's actually visible rather than the extra padding
   * reserved for port labels, pilot stubs, etc. Defaults to the full canvas when omitted. */
  innerBounds?: { x: number; y: number; w: number; h: number },
): ComponentShell {
  const el = document.createElement('div');
  el.className = 'comp';
  el.dataset.type = type;

  const labelEl = document.createElement('div');
  labelEl.className = 'label';
  el.appendChild(labelEl);

  // The name text lives in its own span (rather than directly as labelEl's textContent) so a
  // component that appends other, always-visible controls into labelEl (e.g. the single-acting
  // cylinder's push/pull toggle) can do so without those controls being hidden along with the
  // name - only this span's visibility is toggled.
  const nameTextEl = document.createElement('span');
  nameTextEl.className = 'compNameText';
  labelEl.appendChild(nameTextEl);

  let defaultName = label;
  let customName: string | null = null;
  let nameVisible = false;

  function renderName(): void {
    nameTextEl.textContent = customName ?? defaultName;
    nameTextEl.style.display = nameVisible ? '' : 'none';
  }
  renderName();

  const svg = createSvgEl('svg', { class: 'compSvg', width: svgW, height: svgH });
  svg.style.display = 'block';
  el.appendChild(svg);

  // Inset a couple px from whatever the component itself considers its own drawn edge - both
  // the selection outline and getBounds() (obstacle avoidance, marquee hit-testing) read `box`,
  // so without this the selection rectangle would land flush against the artwork's own outline
  // (or a port dot right at the edge), reading as clipped rather than as a selection around it.
  const BOUNDS_INSET = 2;
  const box = { x: 0, y: 0, w: 0, h: 0 };
  function setBox(rawBox: { x: number; y: number; w: number; h: number }): void {
    box.x = rawBox.x + BOUNDS_INSET;
    box.y = rawBox.y + BOUNDS_INSET;
    box.w = Math.max(0, rawBox.w - BOUNDS_INSET * 2);
    box.h = Math.max(0, rawBox.h - BOUNDS_INSET * 2);
  }
  setBox(innerBounds ?? { x: 0, y: 0, w: svgW, h: svgH });

  // Selection is highlighted on this box, not the outer .comp div - the div always spans the
  // full padded canvas (ports, labels, pilot stubs and all), so outlining it directly would
  // draw the same oversized rectangle around every component regardless of how tight
  // `innerBounds` is. This one is sized/positioned to the same tight box getBounds() reports.
  const boundsEl = document.createElement('div');
  boundsEl.className = 'boundsBox';
  function placeBoundsEl(): void {
    boundsEl.style.left = `${box.x}px`;
    boundsEl.style.top = `${box.y}px`;
    boundsEl.style.width = `${box.w}px`;
    boundsEl.style.height = `${box.h}px`;
  }
  placeBoundsEl();
  el.appendChild(boundsEl);

  let cx = x;
  let cy = y;

  // `box` in world space, following the component's current rotation (comp.el's data-rot, a
  // multiple of 90) and mirroring (data-mirror, which flips the svg artwork left-right about its
  // own center) - read live from the same attributes the CSS transform is built from, so a
  // rotated component is avoided by the wire router, and hit by a marquee, where it is actually
  // drawn rather than where it would be unrotated.
  function worldBounds(): ComponentBounds {
    let x0 = box.x - svgW / 2;
    const y0 = box.y - svgH / 2;
    if (el.dataset.mirror === '1') x0 = -(x0 + box.w);
    const rot = (((Number(el.dataset.rot ?? '0') % 360) + 360) % 360) as 0 | 90 | 180 | 270;
    const [ax, ay] = rotateQuarter(x0, y0, rot);
    const [bx, by] = rotateQuarter(x0 + box.w, y0 + box.h, rot);
    return {
      x: cx + Math.min(ax, bx),
      y: cy + Math.min(ay, by),
      w: Math.abs(bx - ax),
      h: Math.abs(by - ay),
    };
  }

  function setPos(nx: number, ny: number): void {
    cx = nx;
    cy = ny;
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
  }
  setPos(x, y);

  compLayer.appendChild(el);

  return {
    el,
    svg,
    labelEl,
    setPos,
    getBounds: worldBounds,
    setSelected: (sel: boolean) => {
      // boundsEl sits on comp.el (rotated with it) but outside the mirrored svg, so follow the
      // mirroring by hand to keep the outline on the artwork.
      const mirrored = el.dataset.mirror === '1';
      boundsEl.style.left = `${mirrored ? svgW - box.x - box.w : box.x}px`;
      boundsEl.classList.toggle('selected', sel);
      // Lets CSS bring back the port dots a wire or silencer otherwise hides (see app.css).
      el.classList.toggle('compSelected', sel);
    },
    setDefaultName: (text: string) => {
      defaultName = text;
      renderName();
    },
    setNameVisible: (visible: boolean) => {
      nameVisible = visible;
      renderName();
    },
    getNameVisible: () => nameVisible,
    setCustomName: (name: string | null) => {
      customName = name && name.trim() !== '' ? name : null;
      renderName();
    },
    getCustomName: () => customName,
    resize: (w: number, h: number) => {
      svgW = w;
      svgH = h;
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      setBox({ x: 0, y: 0, w, h });
      placeBoundsEl();
    },
  };
}

export function createPort(
  svg: SVGElement,
  key: PortKey,
  cx: number,
  cy: number,
  entryOrientation: 'H' | 'V',
  opts: { isPilot?: boolean; pilotDir?: 1 | -1; radius?: number; electrical?: boolean } = {},
): PortDef {
  const circle = createSvgEl('circle', {
    class: opts.electrical ? 'port portElectrical' : 'port',
    cx,
    cy,
    r: opts.radius ?? 6,
  });
  circle.dataset.port = key;
  svg.appendChild(circle);
  return {
    key,
    cx,
    cy,
    el: circle,
    entryOrientation,
    isPilot: opts.isPilot,
    pilotDir: opts.pilotDir,
    electrical: opts.electrical,
  };
}

/** Port number/name label, matching the old app's convention of placing text just to the
 * side of the port dot rather than on top of it. */
export function createPortLabel(
  svg: SVGElement,
  cx: number,
  cy: number,
  text: string,
  opts: { anchor?: 'start' | 'middle' | 'end'; dx?: number; dy?: number; fontSize?: number } = {},
): SVGTextElement {
  const t = createSvgEl('text', {
    x: cx + (opts.dx ?? 0),
    y: cy + (opts.dy ?? 0),
    'text-anchor': opts.anchor ?? 'middle',
    'font-size': opts.fontSize ?? 11,
  });
  t.textContent = text;
  svg.appendChild(t);
  return t;
}

/** A port dot plus its number label, positioned the way the old symbols did: label to the
 * left for a port whose wire leaves horizontally, above/below for one that leaves vertically. */
export function createLabeledPort(
  svg: SVGElement,
  key: PortKey,
  cx: number,
  cy: number,
  entryOrientation: 'H' | 'V',
  labelSide: 'left' | 'right' | 'above' | 'below',
  opts: { isPilot?: boolean; pilotDir?: 1 | -1; radius?: number; fontSize?: number } = {},
): PortDef {
  const port = createPort(svg, key, cx, cy, entryOrientation, opts);
  const labelPos: Record<
    typeof labelSide,
    { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }
  > = {
    left: { dx: -14, dy: 4, anchor: 'end' },
    right: { dx: 14, dy: 4, anchor: 'start' },
    above: { dx: 0, dy: -10, anchor: 'middle' },
    below: { dx: 0, dy: 18, anchor: 'middle' },
  };
  const p = labelPos[labelSide];
  createPortLabel(svg, cx, cy, key, {
    anchor: p.anchor,
    dx: p.dx,
    dy: p.dy,
    fontSize: opts.fontSize,
  });
  return port;
}

/** Arrowhead marker (matches the old app's ISO flow-direction arrows). Call once per SVG. */
export function addArrowMarker(svg: SVGSVGElement, id: string): void {
  const defs = createSvgEl('defs');
  const marker = createSvgEl('marker', {
    id,
    markerWidth: 10,
    markerHeight: 10,
    refX: 9,
    refY: 5,
    orient: 'auto',
  });
  const path = createSvgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#111' });
  marker.appendChild(path);
  defs.appendChild(marker);
  svg.appendChild(defs);
}

/** Arrowhead marker for lines with BOTH marker-start and marker-end (double-headed arrows).
 * Needs 'auto-start-reverse' so the start marker flips to point outward instead of also
 * pointing along the line's forward direction, which otherwise renders backwards/overlapping
 * arrowheads at the start of the line. */
export function addDoubleArrowMarker(svg: SVGSVGElement, id: string): void {
  const defs = createSvgEl('defs');
  const marker = createSvgEl('marker', {
    id,
    viewBox: '0 0 10 10',
    refX: 10,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: 'auto-start-reverse',
  });
  const path = createSvgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#111' });
  marker.appendChild(path);
  defs.appendChild(marker);
  svg.appendChild(defs);
}
