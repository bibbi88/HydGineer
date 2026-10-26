const STORAGE_KEY = 'hydgineer.simSpeed';

/** The speeds the toolbar's slider steps through - slow motion to fast forward. */
export const SIM_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4] as const;

let speed = load();

function load(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return (SIM_SPEEDS as readonly number[]).includes(saved) ? saved : 1;
  } catch {
    return 1;
  }
}

/** How many seconds of simulated time pass per second of real time. A personal viewing
 * preference, like the grid - not part of any one project. */
export function getSimSpeed(): number {
  return speed;
}

export function setSimSpeed(next: number): void {
  speed = (SIM_SPEEDS as readonly number[]).includes(next) ? next : 1;
  try {
    localStorage.setItem(STORAGE_KEY, String(speed));
  } catch {
    // Private browsing / storage disabled - the choice just won't survive a reload.
  }
}

export function formatSimSpeed(s: number): string {
  return `${s}×`;
}
