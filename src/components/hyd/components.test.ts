import { describe, expect, it } from 'vitest';
import { componentRegistry } from '../registry';

const layer = (): HTMLElement => document.createElement('div');
const HYD_TYPES = [...componentRegistry.keys()].filter((t) => t.startsWith('hyd'));

describe('hydraulic components', () => {
  it('are all registered', () => {
    expect(HYD_TYPES.length).toBeGreaterThanOrEqual(16);
  });

  it.each(HYD_TYPES)('%s: every port sits on the 10 px grid relative to its centre', (type) => {
    const comp = componentRegistry.get(type)!.factory({ compLayer: layer() }, 0, 0);
    for (const port of Object.values(comp.ports)) {
      expect(Math.abs((port.cx - comp.svgW / 2) % 10), `${type}.${port.key} x`).toBe(0);
      expect(Math.abs((port.cy - comp.svgH / 2) % 10), `${type}.${port.key} y`).toBe(0);
    }
  });

  it.each(HYD_TYPES)('%s: snapshot/restore round-trips', (type) => {
    const factory = componentRegistry.get(type)!.factory;
    const a = factory({ compLayer: layer() }, 0, 0);
    const snap = a.snapshot();
    const b = factory({ compLayer: layer() }, 0, 0);
    b.restore(JSON.parse(JSON.stringify(snap)));
    expect(b.snapshot()).toEqual(snap);
  });

  it.each(HYD_TYPES)(
    '%s: hydraulic elements only reference its own ports or internal nodes',
    (type) => {
      const comp = componentRegistry.get(type)!.factory({ compLayer: layer() }, 0, 0);
      for (const e of comp.hydElements?.() ?? []) {
        for (const key of ['a', 'b', 'out', 'x'] as const) {
          const port = (e as Record<string, unknown>)[key];
          if (typeof port !== 'string') continue;
          expect(
            port in comp.ports || port.startsWith('_'),
            `${type} ${e.kind}.${key}=${port}`,
          ).toBe(true);
        }
      }
    },
  );
});
