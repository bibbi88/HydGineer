import { describe, expect, it } from 'vitest';
import { createSource, SOURCE_DEFAULT_GEOMETRY } from './source';
import { createCheckValve } from './checkValve';
import { createCylinderDouble } from './cylinderDouble';
import { createCylinderSingle } from './cylinderSingle';
import { createValve52 } from './valve52';
import { createValve53Mono, VALVE_53_MONO_DEFAULT_GEOMETRY } from './valve53Mono';
import { createValve53Solenoid } from './solenoidValves';
import { createPushButton32 } from './pushButton32';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

// buildComponentShell insets `innerBounds` by 2px on every side (BOUNDS_INSET in svgHelpers.ts),
// so getBounds() reports a box a little smaller than the component's own drawn body, not flush
// against its outline - these expected sizes are each component's drawn-body size minus 4 (2px
// off both width and height).
describe('getBounds() reports a box a little smaller than the drawn body, not the padded canvas', () => {
  it('source: bounds are inset from the pressure-source circle', () => {
    const comp = createSource(compLayer(), 100, 100);
    const bounds = comp.getBounds();
    expect(bounds.w).toBe(26);
    expect(bounds.h).toBe(26);
    expect(bounds.w).toBeLessThan(comp.svgW);
    expect(bounds.h).toBeLessThan(comp.svgH);
  });

  it('checkValve: bounds are inset from the (scaled) housing area', () => {
    const comp = createCheckValve(compLayer(), 100, 100);
    const bounds = comp.getBounds();
    expect(bounds.w).toBe(36);
    expect(bounds.h).toBe(36);
  });

  it('cylinderDouble: bounds are inset from the (shrunk) body rectangle, not the padded canvas', () => {
    const comp = createCylinderDouble(compLayer(), 100, 100);
    const bounds = comp.getBounds();
    expect(bounds.w).toBe(172);
    expect(bounds.h).toBe(52);
    expect(bounds.w).toBeLessThan(comp.svgW);
    expect(bounds.h).toBeLessThan(comp.svgH);
  });

  it('cylinderSingle: bounds are inset from the (shrunk) body rectangle, not the padded canvas', () => {
    const comp = createCylinderSingle(compLayer(), 100, 100);
    const bounds = comp.getBounds();
    expect(bounds.w).toBe(156);
    expect(bounds.h).toBe(52);
    expect(bounds.w).toBeLessThan(comp.svgW);
    expect(bounds.h).toBeLessThan(comp.svgH);
  });

  it('valve52: bounds are inset from the housing, excluding the pilot-port padding', () => {
    const comp = createValve52(compLayer(), 100, 100);
    const bounds = comp.getBounds();
    expect(bounds.w).toBe(156);
    expect(bounds.h).toBe(56);
    expect(bounds.w).toBeLessThan(comp.svgW);
    expect(bounds.h).toBeLessThan(comp.svgH);
  });

  // The 5/3 family's body is three cells wide, not the 5/2's two - w0 * 3 = 240, less the 4px
  // inset. Getting this wrong is visible as well as behavioral: the same box draws the
  // selection outline, so a too-narrow one leaves a whole cell outside the highlight, and
  // zoom-to-fit/export crop the diagram short by that much.
  it('valve53Mono: bounds span all three cells of the body, not just two', () => {
    const comp = createValve53Mono(compLayer(), 100, 100);
    const bounds = comp.getBounds();
    expect(bounds.w).toBe(236);
    expect(bounds.h).toBe(56);
    expect(bounds.w).toBeLessThan(comp.svgW);
    expect(bounds.h).toBeLessThan(comp.svgH);
  });

  it('valve53Mono: the bounds box actually covers the drawn body in the rest position', () => {
    // In the centered rest state the three-cell assembly starts one cell left of gx0, so the
    // body spans gx0 - w0 .. gx0 + w0 * 2 in canvas coordinates. Checked against the geometry
    // rather than a literal, so retuning the symbol can't silently desync the two.
    const geo = VALVE_53_MONO_DEFAULT_GEOMETRY;
    const comp = createValve53Mono(compLayer(), 0, 0);
    const bounds = comp.getBounds();
    const bodyLeft = geo.gx0 - geo.w0 - comp.svgW / 2;
    const bodyRight = geo.gx0 + geo.w0 * 2 - comp.svgW / 2;

    // Inset by 2px on each side (BOUNDS_INSET), and otherwise flush with the drawn body.
    expect(bounds.x).toBeCloseTo(bodyLeft + 2);
    expect(bounds.x + bounds.w).toBeCloseTo(bodyRight - 2);
  });

  it('valve53Solenoid: matches the pneumatic 5/3 it shares a body with', () => {
    const solenoid = createValve53Solenoid(compLayer(), 100, 100);
    const pneumatic = createValve53Mono(compLayer(), 100, 100);
    expect(solenoid.getBounds()).toEqual(pneumatic.getBounds());
  });

  it('pushButton32: bounds are inset from the sliding-valve housing, excluding the spring/actuator padding', () => {
    const comp = createPushButton32(compLayer(), 100, 100);
    const bounds = comp.getBounds();
    expect(bounds.w).toBe(136);
    expect(bounds.h).toBe(56);
    expect(bounds.w).toBeLessThan(comp.svgW);
    expect(bounds.h).toBeLessThan(comp.svgH);
  });
});

describe('source symbol placement', () => {
  it('centers the drawing in its own canvas, and keeps OUT on the grid at the canvas center', () => {
    const geo = SOURCE_DEFAULT_GEOMETRY;
    // The drawing runs from the port down to the bottom of the circle.
    const top = geo.portY;
    const bottom = geo.cy + geo.r;
    expect((top + bottom) / 2).toBeCloseTo(geo.svgH / 2);
    expect(top).toBeCloseTo(geo.svgH - bottom);

    // Horizontally the circle, the stem and the port all share one axis, on the canvas center -
    // that is what lets a wire leave straight up with no jog.
    expect(geo.gx + geo.cx).toBeCloseTo(geo.svgW / 2);

    const comp = createSource(compLayer(), 100, 100);
    const port = comp.ports.OUT;
    expect(Math.abs((geo.gx + geo.cx - comp.svgW / 2) % 10)).toBe(0);
    expect(Math.abs((geo.gy + (port?.cy ?? 0) - comp.svgH / 2) % 10)).toBe(0);
  });
});
