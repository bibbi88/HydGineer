import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./project', () => ({
  serializeProject: (name: string) => ({ schemaVersion: 1, name, comps: [], conns: [] }),
}));

import { saveProjectToFile } from './save';

interface WindowWithPicker {
  showSaveFilePicker?: (...args: unknown[]) => Promise<unknown>;
}

describe('saveProjectToFile', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} });
  });

  afterEach(() => {
    clickSpy.mockRestore();
    alertSpy.mockRestore();
    delete (window as WindowWithPicker).showSaveFilePicker;
    vi.unstubAllGlobals();
  });

  it('falls back to a plain download with no alert when the File System Access API is unavailable', async () => {
    await saveProjectToFile('test');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('does nothing (no download) when the user cancels the native picker', async () => {
    const abort = Object.assign(new DOMException('cancelled', 'AbortError'));
    (window as WindowWithPicker).showSaveFilePicker = vi.fn().mockRejectedValue(abort);

    await saveProjectToFile('test');

    expect(clickSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('falls back to a download with no alert when the picker itself fails (nothing written yet)', async () => {
    (window as WindowWithPicker).showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new Error('permission denied'));

    await saveProjectToFile('test');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('writes through the picked handle with no download/alert when everything succeeds', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const handle = { createWritable: vi.fn().mockResolvedValue({ write, close }) };
    (window as WindowWithPicker).showSaveFilePicker = vi.fn().mockResolvedValue(handle);

    await saveProjectToFile('test');

    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  // Regression test: createWritable() truncates the picked file to empty as soon as it opens,
  // before write() ever runs - so a failure here used to silently fall back to an unrelated
  // download, leaving the user with an empty file at the location they picked and a second,
  // unexplained save prompt with no idea what happened.
  it('warns before falling back to a download when writing to the picked file fails partway through', async () => {
    const handle = {
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn().mockRejectedValue(new Error('disk full')),
        close: vi.fn(),
      }),
    };
    (window as WindowWithPicker).showSaveFilePicker = vi.fn().mockResolvedValue(handle);

    await saveProjectToFile('test');

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]?.[0]).toContain('disk full');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  // Regression test: an earlier version re-checked write permission via handle.requestPermission()
  // before calling createWritable() as a defensive measure - that check itself turned out to be
  // the actual bug (it consistently resolved as not-granted for at least one real user,
  // regardless of whether the file already existed, breaking every single save). There's no
  // permission pre-check anymore; createWritable() is called directly and is trusted to fail on
  // its own (surfaced via the alert above) if permission genuinely isn't there.
  it('calls createWritable() directly, with no permission pre-check even if the handle offers one', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const requestPermission = vi.fn().mockResolvedValue('granted');
    const handle = {
      requestPermission,
      createWritable: vi.fn().mockResolvedValue({ write, close: vi.fn().mockResolvedValue(undefined) }),
    };
    (window as WindowWithPicker).showSaveFilePicker = vi.fn().mockResolvedValue(handle);

    await saveProjectToFile('test');

    expect(requestPermission).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
