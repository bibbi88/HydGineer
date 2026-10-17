export const Modes = {
  STOP: 'STOP',
  PLAY: 'PLAY',
  PAUSE: 'PAUSE',
} as const;

export type Mode = (typeof Modes)[keyof typeof Modes];

export function canEdit(mode: Mode): boolean {
  return mode === Modes.STOP;
}
