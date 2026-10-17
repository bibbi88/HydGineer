import { beforeEach, describe, expect, it } from 'vitest';
import { getDeviceId } from './deviceId';

describe('getDeviceId', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates an id and persists it in localStorage', () => {
    const id = getDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem('pneugineer.deviceId')).toBe(id);
  });

  it('returns the same id on later calls instead of generating a new one each time', () => {
    const first = getDeviceId();
    const second = getDeviceId();
    expect(second).toBe(first);
  });
});
