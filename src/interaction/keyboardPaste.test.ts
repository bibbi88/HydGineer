import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pasted = vi.hoisted(() => ({ components: 0, pictures: 0 }));

vi.mock('./clipboard', () => ({
  copySelection: () => {},
  pasteClipboard: () => {
    pasted.components++;
  },
}));
vi.mock('./pictures', () => ({
  pastePictureFrom: (data: { items?: unknown[] } | null) => {
    if (!data?.items?.length) return false;
    pasted.pictures++;
    return true;
  },
}));

import { initKeyboard } from './keyboard';

function ctrlV(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true }));
}

/** The browser's paste event, carrying a picture or not. */
function paste(withPicture: boolean): void {
  const e = new Event('paste', { cancelable: true });
  Object.defineProperty(e, 'clipboardData', {
    value: { items: withPicture ? [{ kind: 'file', type: 'image/png' }] : [] },
  });
  window.dispatchEvent(e);
}

describe('Ctrl+V', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pasted.components = 0;
    pasted.pictures = 0;
    initKeyboard();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pastes only the picture, even when the paste arrives late', () => {
    ctrlV();
    vi.advanceTimersByTime(150);
    paste(true);
    vi.advanceTimersByTime(1000);
    expect(pasted).toEqual({ components: 0, pictures: 1 });
  });

  it('pastes the copied components once when the paste carries no picture', () => {
    ctrlV();
    paste(false);
    vi.advanceTimersByTime(1000);
    expect(pasted).toEqual({ components: 1, pictures: 0 });
  });

  it('still pastes the copied components when the browser sends no paste at all', () => {
    ctrlV();
    vi.advanceTimersByTime(1000);
    expect(pasted).toEqual({ components: 1, pictures: 0 });
  });
});
