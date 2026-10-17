import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = { lastLoaded: null as unknown, lastOnBeforeApply: false };

vi.mock('./project', () => ({
  loadProject: (file: unknown) => {
    mockState.lastLoaded = file;
  },
}));

import { loadProjectFromPicker } from './load';
import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';

interface WindowWithPicker {
  showOpenFilePicker?: (...args: unknown[]) => Promise<unknown>;
}

const ctx: ComponentFactoryContext = { compLayer: document.createElement('div') };
const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

function validProjectJson(name = 'my-project'): string {
  return JSON.stringify({ schemaVersion: 1, name, comps: [], conns: [] });
}

describe('loadProjectFromPicker', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockState.lastLoaded = null;
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    clickSpy.mockRestore();
    delete (window as WindowWithPicker).showOpenFilePicker;
  });

  it('falls back to the <input type=file> picker with no alert when the API is unavailable', async () => {
    const result = loadProjectFromPicker(ctx, viewport);
    // Nothing to resolve it in this path (no file chosen in the fallback input) - just confirm
    // it took the fallback instead of the native picker.
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    void result;
  });

  it('resolves undefined with no alert when the user cancels the native picker', async () => {
    const abort = new DOMException('cancelled', 'AbortError');
    (window as WindowWithPicker).showOpenFilePicker = vi.fn().mockRejectedValue(abort);

    const result = await loadProjectFromPicker(ctx, viewport);

    expect(result).toBeUndefined();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('falls back to the file-input picker with no alert when the native picker itself fails (nothing read yet)', async () => {
    (window as WindowWithPicker).showOpenFilePicker = vi
      .fn()
      .mockRejectedValue(new Error('API present but blocked'));

    // Deliberately not awaited: the file-input fallback's own promise only resolves once a file
    // is chosen through it, which nothing in this test ever does - awaiting it would hang.
    const result = loadProjectFromPicker(ctx, viewport);
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(alertSpy).not.toHaveBeenCalled();
    void result;
  });

  it('loads and applies the file when everything succeeds, with no alert and no second dialog', async () => {
    const handle = {
      getFile: vi.fn().mockResolvedValue({
        text: () => Promise.resolve(validProjectJson('loaded-name')),
      }),
    };
    (window as WindowWithPicker).showOpenFilePicker = vi.fn().mockResolvedValue([handle]);

    const result = await loadProjectFromPicker(ctx, viewport);

    expect(result).toBe('loaded-name');
    expect((mockState.lastLoaded as { name: string }).name).toBe('loaded-name');
    expect(alertSpy).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  // Regression test: a file *was* successfully picked here - if reading/parsing/applying it then
  // failed (bad JSON, an unrecognized schema version, etc.), silently reopening the fallback
  // <input type=file> picker used to look exactly like "it didn't open the file the first time,
  // then the dialog came back a second time" with zero explanation of what actually went wrong.
  it('alerts with the real reason instead of silently reopening a second picker when the file is invalid', async () => {
    const handle = {
      getFile: vi.fn().mockResolvedValue({
        text: () => Promise.resolve('not valid json at all'),
      }),
    };
    (window as WindowWithPicker).showOpenFilePicker = vi.fn().mockResolvedValue([handle]);

    const result = await loadProjectFromPicker(ctx, viewport);

    expect(result).toBeUndefined();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(mockState.lastLoaded).toBeNull();
  });

  it('alerts (no fallback dialog) for an unsupported/unrecognized project schema', async () => {
    const handle = {
      getFile: vi.fn().mockResolvedValue({
        text: () => Promise.resolve(JSON.stringify({ schemaVersion: 99 })),
      }),
    };
    (window as WindowWithPicker).showOpenFilePicker = vi.fn().mockResolvedValue([handle]);

    const result = await loadProjectFromPicker(ctx, viewport);

    expect(result).toBeUndefined();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]?.[0]).toContain('schema version');
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('runs onBeforeApply only once a file was actually picked and applied', async () => {
    const onBeforeApply = vi.fn();
    const handle = {
      getFile: vi.fn().mockResolvedValue({ text: () => Promise.resolve(validProjectJson()) }),
    };
    (window as WindowWithPicker).showOpenFilePicker = vi.fn().mockResolvedValue([handle]);

    await loadProjectFromPicker(ctx, viewport, onBeforeApply);

    expect(onBeforeApply).toHaveBeenCalledTimes(1);
  });
});
