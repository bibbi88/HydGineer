import { describe, expect, it } from 'vitest';
import { migrate } from './migrations';

describe('migrate', () => {
  it('passes through a current-schema file unchanged', () => {
    const file = { schemaVersion: 1, name: 'test', comps: [], conns: [] };
    expect(migrate(file)).toEqual(file);
  });

  it('throws on an unrecognized schema version', () => {
    expect(() => migrate({ schemaVersion: 99 })).toThrow();
  });

  it('throws on non-object input', () => {
    expect(() => migrate(null)).toThrow();
    expect(() => migrate('not a project')).toThrow();
  });
});
