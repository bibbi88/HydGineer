import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/ui/styles/app.css'), 'utf-8');

function ruleBody(selector: string): string {
  const match = css.match(new RegExp(`${selector.replace(/[.#]/, '\\$&')}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no CSS rule found for ${selector}`);
  return match[1] ?? '';
}

describe('#viewport must not clip its own content', () => {
  // Regression test: #viewport previously had its own `overflow: hidden` plus a fixed
  // width/height, which clips based on that *local*, untransformed box - so a component placed
  // at a negative world x/y (or past that fixed size) silently disappeared no matter how far you
  // panned, since panning is done with a CSS transform that doesn't move the clip box with it.
  // .workspace's own overflow: hidden is what should (and does) clip to the actual visible
  // screen area, transform-independent.
  it('.workspace clips to the visible screen', () => {
    expect(ruleBody('.workspace')).toMatch(/overflow:\s*hidden/);
  });

  it('#viewport does not also clip, which would hide off-canvas-sized content regardless of pan', () => {
    expect(ruleBody('#viewport')).not.toMatch(/overflow:\s*hidden/);
  });

  // Regression test: #connLayer/#frameLayer/#handleLayer are each their own <svg> element, which
  // clips its content to its own local box by default regardless of any HTML-level overflow fix
  // above - world-space content bigger than the workspace itself (wires to a far component, or
  // the page frame's own sheet) still got silently cut off at that boundary even after the
  // #viewport fix, until this was added.
  it('.layer (every SVG layer) opts out of that per-element default clip', () => {
    expect(ruleBody('.layer')).toMatch(/overflow:\s*visible/);
  });
});
