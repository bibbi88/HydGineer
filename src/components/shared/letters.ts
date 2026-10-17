import { appState } from '../../app/AppState';
import type { ComponentId } from '../../core/types';

let cylinderCount = 0;

/** True if `letter` (matched case-insensitively) is already some *other* cylinder's letter -
 * two cylinders sharing one would also share every auto-named sensor label derived from it
 * (A0, A1, ...), silently colliding. Pass `excludeCompId` when checking a rename so a cylinder
 * doesn't flag its own current letter. */
export function isCylinderLetterInUse(letter: string, excludeCompId?: ComponentId): boolean {
  const target = letter.trim().toUpperCase();
  for (const comp of appState.components) {
    if (excludeCompId !== undefined && comp.id === excludeCompId) continue;
    const snap = comp.snapshot() as Record<string, unknown>;
    if (typeof snap.letter === 'string' && snap.letter.toUpperCase() === target) return true;
  }
  return false;
}

/** The next letter for a freshly placed cylinder - cycles A-Z, skipping any letter already
 * claimed by another cylinder still on the canvas. Past 26 live cylinders every letter is
 * necessarily taken; rather than refuse to place the 27th, it reuses one (the rename path is
 * still the one place an actual duplicate is blocked outright). */
export function nextCylinderLetter(): string {
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + (cylinderCount % 26));
    cylinderCount++;
    if (!isCylinderLetterInUse(letter)) return letter;
  }
  return String.fromCharCode(65 + (cylinderCount % 26));
}

export function resetCylinderLetters(): void {
  cylinderCount = 0;
}
