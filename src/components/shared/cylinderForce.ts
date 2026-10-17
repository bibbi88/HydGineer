import { SOURCE_PRESSURE } from '../../sim/constants';

/** Sensible default bore/rod sizing for a freshly-placed cylinder (a small, common pneumatic
 * cylinder size) - purely a starting point for the force calculation, not tied to anything else
 * about how the symbol is drawn (the cylinder's on-screen size doesn't change with these). */
export const DEFAULT_BORE_DIAMETER_MM = 32;
export const DEFAULT_ROD_DIAMETER_MM = 12;

/** Full-bore piston area, in mm². */
export function boreAreaMm2(boreDiameterMm: number): number {
  const r = boreDiameterMm / 2;
  return Math.PI * r * r;
}

/** Annular (rod-side) piston area, in mm² - what the air actually pushes against on the side
 * the rod passes through, since the rod itself takes up part of the bore there. */
export function annularAreaMm2(boreDiameterMm: number, rodDiameterMm: number): number {
  return Math.max(0, boreAreaMm2(boreDiameterMm) - boreAreaMm2(rodDiameterMm));
}

/** Force (N) from `pressureBar` acting across `areaMm2` - 1 bar = 0.1 N/mm², so this is just
 * that conversion factor applied. Defaults to the full supply pressure for callers that have no
 * particular port in mind; a cylinder passes what its driven port is actually seeing, which a
 * pressure-reducing valve upstream will have lowered (see SimStepContext.pressureAt). */
export function forceFromArea(areaMm2: number, pressureBar: number = SOURCE_PRESSURE): number {
  return pressureBar * 0.1 * areaMm2;
}
