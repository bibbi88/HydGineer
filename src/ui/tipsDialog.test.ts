import { afterEach, describe, expect, it } from 'vitest';
import { openTipsDialog } from './tipsDialog';

describe('openTipsDialog', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('renders every tip section with at least one tip each', () => {
    openTipsDialog();

    const headings = document.querySelectorAll('.inspectorSectionHeading');
    expect(headings.length).toBeGreaterThan(0);
    const lists = document.querySelectorAll('.tipsList');
    expect(lists.length).toBe(headings.length);
    for (const list of Array.from(lists)) {
      expect(list.querySelectorAll('li').length).toBeGreaterThan(0);
    }
  });

  it('closes on Escape', () => {
    openTipsDialog();
    expect(document.querySelector('.modalBackdrop')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.querySelector('.modalBackdrop')).toBeNull();
  });

  it('closes when clicking the backdrop but not the dialog itself', () => {
    openTipsDialog();
    const backdrop = document.querySelector('.modalBackdrop') as HTMLElement;
    const dialog = document.querySelector('.tipsDialog') as HTMLElement;

    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.modalBackdrop')).not.toBeNull();

    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.modalBackdrop')).toBeNull();
  });
});
