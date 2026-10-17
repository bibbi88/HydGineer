import { describe, expect, it } from 'vitest';
import {
  createPressureReducingValve,
  PRESSURE_REDUCING_VALVE_DEFAULT_GEOMETRY,
} from './pressureReducingValve';
import { SOURCE_PRESSURE } from '../sim/constants';

function layer(): HTMLElement {
  return document.createElement('div');
}

const noPressure = { isPressurized: () => false };

describe('createPressureReducingValve', () => {
  it('is normally open IN -> OUT, and one way only', () => {
    const valve = createPressureReducingValve(layer(), 0, 0);
    expect(valve.conductivityRule(noPressure)).toEqual([{ a: 'IN', b: 'OUT', directed: true }]);
  });

  it('starts at a reduced set pressure, below the supply', () => {
    const valve = createPressureReducingValve(layer(), 0, 0);
    const set = valve.snapshot().outletPressure as number;
    expect(set).toBeGreaterThan(0);
    expect(set).toBeLessThan(SOURCE_PRESSURE);
  });

  it('shows the set pressure in its default label', () => {
    const valve = createPressureReducingValve(layer(), 0, 0);
    valve.restore({ ...valve.snapshot(), outletPressure: 4.5 });
    expect(valve.el.textContent).toContain('4.5 bar');
  });

  it('clamps the set pressure to the supply - a regulator can only reduce', () => {
    const valve = createPressureReducingValve(layer(), 0, 0);
    valve.restore({ ...valve.snapshot(), outletPressure: SOURCE_PRESSURE + 5 });
    expect(valve.snapshot().outletPressure).toBe(SOURCE_PRESSURE);

    valve.restore({ ...valve.snapshot(), outletPressure: -2 });
    expect(valve.snapshot().outletPressure).toBe(0);
  });

  it('falls back to the default rather than NaN for a missing or unusable value', () => {
    const valve = createPressureReducingValve(layer(), 0, 0);
    const fresh = valve.snapshot().outletPressure;

    valve.restore({ ...valve.snapshot(), outletPressure: 'nonsense' });
    expect(valve.snapshot().outletPressure).toBe(fresh);

    // An older project file saved before this component gained the field.
    valve.restore({ showName: false, customName: null });
    expect(valve.snapshot().outletPressure).toBe(fresh);
  });

  it('round-trips its set pressure', () => {
    const original = createPressureReducingValve(layer(), 0, 0);
    original.restore({ ...original.snapshot(), outletPressure: 2.5 });
    const snap = original.snapshot();

    const restored = createPressureReducingValve(layer(), 10, 10);
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);
  });

  it('has IN and OUT on the flow axis, both landing on the 10px grid', () => {
    const geo = PRESSURE_REDUCING_VALVE_DEFAULT_GEOMETRY;
    const valve = createPressureReducingValve(layer(), 0, 0);
    // Ports are created inside the body group, so their stored cx/cy are local to it - the
    // world position adds that group's own offset, which is what has to land on the grid.
    const ox = (valve.svgW - geo.localW) / 2;
    const oy = (valve.svgH - geo.localH) / 2;
    for (const key of ['IN', 'OUT']) {
      const port = valve.ports[key];
      expect(port, `missing port ${key}`).toBeDefined();
      const worldX = ox + (port?.cx ?? 0);
      const worldY = oy + (port?.cy ?? 0);
      expect(Math.abs((worldX - valve.svgW / 2) % 10), `${key} cx off-grid`).toBe(0);
      expect(Math.abs((worldY - valve.svgH / 2) % 10), `${key} cy off-grid`).toBe(0);
    }
    // Both sit on the same vertical axis, which is what lets the valve splice into a wire.
    expect(valve.ports.IN?.cx).toBe(valve.ports.OUT?.cx);
  });

  it('draws the control line dashed and tapped off the outlet, not the inlet', () => {
    // The one feature that tells a reducing valve apart from a relief valve in ISO 1219 - a
    // relief valve senses its own inlet instead, so getting this backwards draws a different
    // component entirely.
    const geo = PRESSURE_REDUCING_VALVE_DEFAULT_GEOMETRY;
    const valve = createPressureReducingValve(layer(), 0, 0);
    const dashed = Array.from(valve.el.querySelectorAll('path')).filter((p) =>
      p.getAttribute('stroke-dasharray'),
    );
    expect(dashed.length).toBe(1);

    // It starts above the envelope, on the OUT side of it (smaller y is nearer OUT).
    const d = dashed[0]?.getAttribute('d') ?? '';
    const startY = Number(d.split(/[ ,]/)[2]);
    expect(startY).toBeLessThan(geo.localH / 2);
  });
});
