import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canWriteBack, fileHandles, saveDocument, type FileHandleLike } from './save';

interface WindowWithPicker {
  showSaveFilePicker?: (...args: unknown[]) => Promise<unknown>;
}

/** A stand-in for Chrome's showSaveFilePicker: counts the picks and records what's written to
 * each picked file. */
function stubPicker(names: string[]) {
  const writes: Array<{ file: string; text: string }> = [];
  let picks = 0;
  const pick = vi.fn(async (_opts?: unknown) => {
    const name = names[picks++] ?? `file${picks}.hgcl`;
    const handle: FileHandleLike = {
      name,
      async createWritable() {
        const parts: Array<Blob | string> = [];
        return {
          async write(data: Blob | string) {
            parts.push(data);
          },
          async close() {
            const texts = await Promise.all(
              parts.map((p) => (typeof p === 'string' ? p : p.text())),
            );
            writes.push({ file: name, text: texts.join('') });
          },
        };
      },
    };
    return handle;
  });
  (window as WindowWithPicker).showSaveFilePicker = pick;
  return { pick, writes, picks: () => pick.mock.calls.length };
}

const req = (text: string, asNew = false) => ({
  docId: 'd1',
  name: 'beam',
  text: () => text,
  asNew,
});

describe('saveDocument', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let promptSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fileHandles.clear();
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    promptSpy = vi.spyOn(window, 'prompt').mockImplementation((_m, d) => d ?? null);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as WindowWithPicker).showSaveFilePicker;
    vi.unstubAllGlobals();
  });

  it('asks where on the first Save, then writes back without asking', async () => {
    const picker = stubPicker(['beam.hgcl']);
    expect(canWriteBack()).toBe(true);

    const first = await saveDocument(req('one'));
    expect(first.kind).toBe('written');
    expect(picker.picks()).toBe(1);
    expect(picker.pick.mock.calls[0]?.[0]).toMatchObject({
      suggestedName: 'beam.hgcl',
      id: 'hydgineer-files',
    });

    const second = await saveDocument(req('two'));
    expect(second.kind).toBe('written');
    expect(picker.picks()).toBe(1);
    expect(picker.writes).toEqual([
      { file: 'beam.hgcl', text: 'one' },
      { file: 'beam.hgcl', text: 'two' },
    ]);
    expect(fileHandles.get('d1')?.name).toBe('beam.hgcl');
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('Save as always asks, and the next Save goes to the new file', async () => {
    const picker = stubPicker(['beam.hgcl', 'beam v2.hgcl']);
    await saveDocument(req('one'));
    await saveDocument(req('two', true));
    expect(picker.picks()).toBe(2);
    await saveDocument(req('three'));
    expect(picker.picks()).toBe(2);
    expect(picker.writes.at(-1)).toEqual({ file: 'beam v2.hgcl', text: 'three' });
    expect(fileHandles.get('d1')?.name).toBe('beam v2.hgcl');
  });

  it('cancelling the picker saves nothing', async () => {
    (window as WindowWithPicker).showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    expect((await saveDocument(req('x'))).kind).toBe('cancelled');
    expect(clickSpy).not.toHaveBeenCalled();
    expect(fileHandles.has('d1')).toBe(false);
  });

  it('drops a handle that no longer writes, and asks again', async () => {
    const picker = stubPicker(['again.hgcl']);
    fileHandles.set('d1', {
      name: 'gone.hgcl',
      createWritable: () => Promise.reject(new DOMException('moved', 'NotFoundError')),
    });
    const out = await saveDocument(req('x'));
    expect(out.kind).toBe('written');
    expect(picker.picks()).toBe(1);
    expect(fileHandles.get('d1')?.name).toBe('again.hgcl');
  });

  it('warns and downloads when writing the picked file fails partway', async () => {
    (window as WindowWithPicker).showSaveFilePicker = vi.fn().mockResolvedValue({
      name: 'beam.hgcl',
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn().mockRejectedValue(new Error('disk full')),
        close: vi.fn(),
      }),
    });
    const out = await saveDocument(req('x'));
    expect(out.kind).toBe('downloaded');
    expect(alertSpy.mock.calls[0]?.[0]).toContain('disk full');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('Firefox (no showSaveFilePicker): asks for a name and downloads, every time', async () => {
    expect(canWriteBack()).toBe(false);
    promptSpy.mockReturnValue('my beam');
    const out = await saveDocument(req('x'));
    expect(out).toEqual({ kind: 'downloaded', fileName: 'my beam.hgcl' });
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    await saveDocument(req('y'));
    expect(promptSpy).toHaveBeenCalledTimes(2);
    expect(fileHandles.has('d1')).toBe(false);

    promptSpy.mockReturnValue(null);
    expect((await saveDocument(req('z'))).kind).toBe('cancelled');
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });
});
