/**
 * How a throttle's orifice is given - the ways a datasheet or a calculation states it:
 *
 * - `diameter`: a sharp-edged orifice of that bore (mm);
 * - `rating`:   a reference point, Q L/min at Δp bar (as catalogues rate valves and nozzles);
 * - `area`:     the flow area (mm²), e.g. of a needle valve's opening;
 * - `kv`:       Kv, m³/h of water at a 1 bar drop (European valve sizing);
 * - `cv`:       Cv, US gal/min of water at a 1 psi drop (American valve sizing).
 *
 * Each becomes the orifice coefficient K (L/min per √bar, Q = K·√Δp) the solver uses; the
 * others are kept as they were, so switching back and forth loses nothing.
 */
import {
  KV_PER_CV,
  equivalentOrificeDiameter,
  orificeKFromArea,
  orificeKFromDiameter,
  orificeKFromKv,
  orificeKFromRating,
} from '../../sim/hydraulics';
import { readNum } from './base';

export type OrificeSizing = 'diameter' | 'rating' | 'area' | 'kv' | 'cv';

export const ORIFICE_SIZINGS: Array<{ value: OrificeSizing; label: string }> = [
  { value: 'diameter', label: 'Orifice diameter (mm)' },
  { value: 'rating', label: 'Reference flow: Q at Δp' },
  { value: 'area', label: 'Flow area (mm²)' },
  { value: 'kv', label: 'Kv (m³/h, water, 1 bar)' },
  { value: 'cv', label: 'Cv (US gpm, water, 1 psi)' },
];

export interface OrificeSpec {
  sizing: OrificeSizing;
  diameter: number;
  qRef: number;
  dpRef: number;
  area: number;
  kv: number;
  cv: number;
}

export function defaultOrificeSpec(diameter = 2): OrificeSpec {
  return { sizing: 'diameter', diameter, qRef: 10, dpRef: 10, area: 3, kv: 0.1, cv: 0.1 };
}

/** The orifice coefficient K (L/min per √bar). */
export function orificeK(s: OrificeSpec): number {
  switch (s.sizing) {
    case 'rating':
      return orificeKFromRating(s.qRef, s.dpRef);
    case 'area':
      return orificeKFromArea(s.area);
    case 'kv':
      return orificeKFromKv(s.kv);
    case 'cv':
      return orificeKFromKv(s.cv * KV_PER_CV);
    default:
      return orificeKFromDiameter(s.diameter);
  }
}

const trim = (v: number, digits: number): string => String(Number(v.toFixed(digits)));

/** A short label for the symbol: "⌀2", "10 L/min @ 10 bar", "A 3 mm²", "Kv 0.1", "Cv 0.1". */
export function orificeSymbolText(s: OrificeSpec): string {
  switch (s.sizing) {
    case 'rating':
      return `${trim(s.qRef, 1)} L/min @ ${trim(s.dpRef, 1)} bar`;
    case 'area':
      return `A ${trim(s.area, 2)} mm²`;
    case 'kv':
      return `Kv ${trim(s.kv, 3)}`;
    case 'cv':
      return `Cv ${trim(s.cv, 3)}`;
    default:
      return `⌀${trim(s.diameter, 2)}`;
  }
}

/** What the setting amounts to, in the other terms - for the inspector. */
export function orificeSummary(s: OrificeSpec): string {
  const k = orificeK(s);
  if (!(k > 0)) return 'Closed (no flow).';
  const d = equivalentOrificeDiameter(k);
  const kv = (k * Math.sqrt(0.87)) / (1000 / 60);
  return (
    `K = ${k.toFixed(2)} L/min/√bar: ${(k * Math.sqrt(10)).toFixed(1)} L/min at 10 bar, ` +
    `Δp ${(100 / (k * k)).toFixed(1)} bar at 10 L/min. ≈ ⌀${d.toFixed(2)} mm sharp-edged, ` +
    `Kv ${kv.toFixed(3)}.`
  );
}

export function orificeSpecSnapshot(s: OrificeSpec): Record<string, unknown> {
  return { ...s };
}

export function restoreOrificeSpec(s: OrificeSpec, data: Record<string, unknown>): void {
  if (ORIFICE_SIZINGS.some((o) => o.value === data.sizing)) s.sizing = data.sizing as OrificeSizing;
  s.diameter = readNum(data, 'diameter', s.diameter, 0, 50);
  s.qRef = readNum(data, 'qRef', s.qRef, 0, 5000);
  s.dpRef = readNum(data, 'dpRef', s.dpRef, 0.01, 1000);
  s.area = readNum(data, 'area', s.area, 0, 2000);
  s.kv = readNum(data, 'kv', s.kv, 0, 500);
  s.cv = readNum(data, 'cv', s.cv, 0, 600);
}
