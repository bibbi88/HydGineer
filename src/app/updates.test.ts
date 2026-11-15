import { afterEach, describe, expect, it, vi } from 'vitest';
import { initUpdates } from './updates';
import { resetSettings, updateSettings } from './settings';

function fakeDesktop(supported: boolean): { checks: number } {
  const calls = { checks: 0 };
  (window as unknown as { hydgineerDesktop: unknown }).hydgineerDesktop = {
    updates: {
      supported: async () => supported,
      check: async () => {
        calls.checks++;
      },
      install: () => {},
      onStatus: () => {},
    },
  };
  return calls;
}

afterEach(() => {
  delete (window as unknown as { hydgineerDesktop?: unknown }).hydgineerDesktop;
  resetSettings();
  vi.useRealTimers();
});

describe('desktop updates', () => {
  it('checks once, shortly after start, while the setting is on', async () => {
    vi.useFakeTimers();
    const calls = fakeDesktop(true);
    await initUpdates(() => {});
    expect(calls.checks).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(calls.checks).toBe(1);
  });

  it('never checks - never goes online - with the setting off', async () => {
    vi.useFakeTimers();
    updateSettings({ checkUpdates: false });
    const calls = fakeDesktop(true);
    await initUpdates(() => {});
    vi.advanceTimersByTime(60_000);
    expect(calls.checks).toBe(0);
  });

  it('never checks where the app cannot update itself (Linux)', async () => {
    vi.useFakeTimers();
    const calls = fakeDesktop(false);
    await initUpdates(() => {});
    vi.advanceTimersByTime(60_000);
    expect(calls.checks).toBe(0);
  });
});
