import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetRecentHandle,
  listRecentHandles,
  rememberRecentHandle,
  resetRecentHandles,
} from './recentHandles';

const handle = (name: string) => ({ name, kind: 'file' });

describe('recent file handles', () => {
  beforeEach(() => resetRecentHandles());

  it('keeps the newest first, once each, and forgets one that is gone', async () => {
    const a = handle('a.hgcl');
    const b = handle('b.hgcl');
    await rememberRecentHandle(a, 1);
    await rememberRecentHandle(b, 2);
    await rememberRecentHandle(a, 3);
    expect((await listRecentHandles()).map((e) => e.name)).toEqual(['a.hgcl', 'b.hgcl']);
    await forgetRecentHandle(b);
    expect((await listRecentHandles()).map((e) => e.name)).toEqual(['a.hgcl']);
  });
});
