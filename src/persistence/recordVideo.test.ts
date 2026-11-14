import { describe, expect, it } from 'vitest';
import { pickVideoFormat, videoSize } from './recordVideo';

describe('video recording', () => {
  it('records MP4 where the browser can, else WebM, else nothing', () => {
    expect(pickVideoFormat((m) => m.startsWith('video/mp4'))?.extension).toBe('mp4');
    expect(pickVideoFormat((m) => m.startsWith('video/webm'))).toEqual({
      mimeType: 'video/webm;codecs=vp9',
      extension: 'webm',
    });
    expect(pickVideoFormat(() => false)).toBeNull();
  });

  it('fits the circuit inside 1920 x 1080 in even pixels, keeping its proportions', () => {
    expect(videoSize(800, 450)).toEqual({ width: 1920, height: 1080 });
    const tall = videoSize(1000, 1000);
    expect(tall).toEqual({ width: 1080, height: 1080 });
    const odd = videoSize(1001, 333);
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
    expect(odd.width).toBeLessThanOrEqual(1920);
  });
});
