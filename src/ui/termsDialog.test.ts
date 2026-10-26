import { beforeEach, describe, expect, it } from 'vitest';
import { openTermsDialog, termsNeedAgreement, TERMS_SECTIONS, TERMS_VERSION } from './termsDialog';

function dialog(): HTMLElement | null {
  return document.querySelector('.termsDialog');
}

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.termsDialog button')).find(
    (b) => b.textContent === text,
  );
}

describe('terms of use', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('asks for agreement until it has been given with "Don’t show this again"', () => {
    expect(termsNeedAgreement()).toBe(true);

    openTermsDialog({ requireAgreement: true });
    button('I agree')?.click();
    expect(dialog()).toBeNull();
    expect(termsNeedAgreement()).toBe(true); // box not ticked: shown again next time

    openTermsDialog({ requireAgreement: true });
    document.querySelector<HTMLInputElement>('.termsDontShow input')?.click();
    button('I agree')?.click();
    expect(termsNeedAgreement()).toBe(false);
  });

  it('asks again when the terms change', () => {
    localStorage.setItem('hydgineer.termsAccepted', `${TERMS_VERSION}-old`);
    expect(termsNeedAgreement()).toBe(true);
  });

  it('cannot be dismissed without agreeing at start-up', () => {
    openTermsDialog({ requireAgreement: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.querySelector<HTMLElement>('.modalBackdrop')?.click();
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('.exportDialogClose')).toBeNull();
  });

  it('opened from Help, just closes, and records nothing', () => {
    openTermsDialog();
    expect(button('I agree')).toBeUndefined();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dialog()).toBeNull();
    expect(termsNeedAgreement()).toBe(true);
  });

  it('covers the disclaimer, liability and the MIT licence', () => {
    openTermsDialog();
    const text = dialog()?.textContent ?? '';
    expect(text).toContain('No warranty');
    expect(text).toContain('Limitation of liability');
    expect(text).toContain('MIT License - Copyright (c) 2026 bibbi88');
    expect(TERMS_SECTIONS.length).toBeGreaterThan(5);
  });
});
