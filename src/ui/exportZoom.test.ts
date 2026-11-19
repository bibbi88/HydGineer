import { describe, expect, it } from 'vitest';
import { exportZoom, renderExportZoom, type ExportZoomState } from './exportZoom';
import { layoutPdfPage } from '../persistence/exportImage';

describe('export zoom', () => {
  it('fit, or a percent typed or stepped with −/+ (25-400 %)', () => {
    const s: ExportZoomState = { fit: true, percent: 100 };
    const el = renderExportZoom(s, 'Fit');
    expect(exportZoom(s)).toBeUndefined();
    expect(exportZoom(s, true)).toBe(1);
    const [minus, plus] = el.querySelectorAll<HTMLButtonElement>('.exportZoomStep');
    plus!.click();
    expect(s).toEqual({ fit: false, percent: 125 });
    expect(el.querySelector<HTMLInputElement>('.exportZoomField')?.value).toBe('125');
    for (let i = 0; i < 10; i++) minus!.click();
    expect(s.percent).toBe(25);
    const field = el.querySelector<HTMLInputElement>('.exportZoomField')!;
    field.value = '240';
    field.dispatchEvent(new Event('input'));
    expect(exportZoom(s)).toBe(2.4);
    field.value = '900';
    field.dispatchEvent(new Event('change'));
    expect(s.percent).toBe(400);
    expect(field.value).toBe('400');
  });

  it('a PDF page at a fixed zoom: that size, but never past the page', () => {
    // 400 px wide at 100 %: 300 pt.
    const small = layoutPdfPage('a4', 2, 1, 400);
    expect(small.imageRect.w).toBeCloseTo(300);
    expect(small.shrunk).toBe(false);
    const big = layoutPdfPage('a4', 2, 4, 4000);
    expect(big.shrunk).toBe(true);
    expect(big.imageRect.w).toBeCloseTo(layoutPdfPage('a4', 2).imageRect.w);
  });
});
