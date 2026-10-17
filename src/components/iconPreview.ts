import { createComponent, type ComponentFactoryContext } from './registry';

let hiddenHost: HTMLDivElement | null = null;

/** Off-screen (but attached, so layout-dependent code behaves normally) host to build throwaway
 * instances into just for icon extraction - shared across calls rather than one per icon. */
function getHiddenHost(): HTMLDivElement {
  if (hiddenHost) return hiddenHost;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed; left:-99999px; top:-99999px; visibility:hidden;';
  document.body.appendChild(el);
  hiddenHost = el;
  return el;
}

/**
 * Renders a small preview SVG for a component type by building a real (throwaway) instance
 * through the same factory used to place it on the canvas, then cropping to its own
 * `getBounds()` box - the drawn body, not the padded canvas reserved for pilot stubs/labels -
 * with port dots and text labels stripped since they're illegible at icon size. This is
 * deliberate: the sidebar icon is always the component's actual artwork, so a symbol tweak in
 * e.g. valve52.ts is reflected here automatically instead of needing a hand-drawn icon kept in
 * sync by hand.
 */
export function renderComponentIcon(type: string): SVGSVGElement {
  const ctx: ComponentFactoryContext = { compLayer: getHiddenHost() };
  const comp = createComponent(type, ctx, 0, 0);

  const liveSvg = comp.el.querySelector('svg');
  if (!liveSvg) throw new Error(`Component "${type}" has no svg to preview`);
  const icon = liveSvg.cloneNode(true) as SVGSVGElement;

  for (const el of Array.from(icon.querySelectorAll('text, circle.port'))) el.remove();

  // getBounds() is in world space relative to the (0,0) placement above; shift back into the
  // svg's own local 0..svgW/0..svgH coordinate space to use as its viewBox.
  const b = comp.getBounds();
  const pad = 6;
  const localX = b.x + comp.svgW / 2 - pad;
  const localY = b.y + comp.svgH / 2 - pad;
  icon.setAttribute('viewBox', `${localX} ${localY} ${b.w + pad * 2} ${b.h + pad * 2}`);
  icon.removeAttribute('width');
  icon.removeAttribute('height');
  icon.classList.add('libIcon');

  comp.el.remove();
  return icon;
}
