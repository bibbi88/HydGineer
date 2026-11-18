import { describe, expect, it } from 'vitest';
import { componentRegistry, placeableComponentsByCategory } from './registry';
import { HYD_CYLINDER_DOUBLE_ROD_TYPE, HYD_CYLINDER_DOUBLE_TYPE } from './hyd/actuators';
import { canSwap } from '../interaction/valveActuatorSwap';

describe('double-rod cylinder', () => {
  it('is not in the library - only a configuration of the double-acting cylinder', () => {
    const types = placeableComponentsByCategory().flatMap((g) => g.items.map((e) => e.type));
    expect(types).toContain(HYD_CYLINDER_DOUBLE_TYPE);
    expect(types).not.toContain(HYD_CYLINDER_DOUBLE_ROD_TYPE);
    expect(canSwap(HYD_CYLINDER_DOUBLE_TYPE, HYD_CYLINDER_DOUBLE_ROD_TYPE)).toBe(true);
    expect(canSwap(HYD_CYLINDER_DOUBLE_ROD_TYPE, HYD_CYLINDER_DOUBLE_TYPE)).toBe(true);
  });

  it('still opens from saved files', () => {
    expect(componentRegistry.has(HYD_CYLINDER_DOUBLE_ROD_TYPE)).toBe(true);
  });
});
