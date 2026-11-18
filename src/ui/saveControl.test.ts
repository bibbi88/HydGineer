import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSaveControl } from './saveControl';

function control(state: { writeBack: boolean; file: string | null }) {
  const save = vi.fn();
  const saveAs = vi.fn();
  const c = createSaveControl({
    save,
    saveAs,
    saveAll: () => null,
    docCount: () => 1,
    canWriteBack: () => state.writeBack,
    fileName: () => state.file,
  });
  document.body.appendChild(c.el);
  return { c, save, saveAs };
}

const label = (el: HTMLElement) => el.querySelector('.saveMainBtn')?.textContent;
const arrow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.iconBtn--menuArrow')!;

describe('Save button', () => {
  afterEach(() => document.body.replaceChildren());

  it('reads "Save as" until the circuit has a file, then "Save" - naming it', () => {
    const state = { writeBack: true, file: null as string | null };
    const { c } = control(state);
    expect(label(c.el)).toBe('Save as');
    state.file = 'beam.hgcl';
    c.refresh();
    expect(label(c.el)).toBe('Save');
    expect(c.el.querySelector<HTMLElement>('.saveMainBtn')?.title).toContain('beam.hgcl');
  });

  it('always reads "Save" where the page can only download', () => {
    const { c } = control({ writeBack: false, file: null });
    expect(label(c.el)).toBe('Save');
  });

  it('its menu offers Save and Save as, and names the file in the footer', () => {
    const { c, saveAs } = control({ writeBack: true, file: 'beam.hgcl' });
    const a = arrow(c.el);
    expect(a.getAttribute('aria-haspopup')).toBe('true');
    a.click();
    expect(a.getAttribute('aria-expanded')).toBe('true');
    const menu = document.querySelector('.saveMenu')!;
    expect(menu.getAttribute('role')).toBe('menu');
    const rows = menu.querySelectorAll('[role="menuitem"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Write the changes to beam.hgcl');
    expect(menu.querySelector('.saveMenuFoot')?.textContent).toBe('Saved to beam.hgcl');
    (rows[1] as HTMLElement).click();
    expect(saveAs).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.saveMenu')).toBeNull();
  });

  it('says when there is no file yet, and in Firefox that Save downloads', () => {
    const { c } = control({ writeBack: false, file: null });
    arrow(c.el).click();
    const menu = document.querySelector('.saveMenu')!;
    expect(menu.textContent).toContain('Download the file');
    expect(menu.querySelector('.saveMenuFoot')?.textContent).toBe('Not saved to a file yet');
  });

  it('keyboard: opens with focus on the first row, arrows move, Escape closes to the arrow', () => {
    const { c, save } = control({ writeBack: true, file: null });
    const a = arrow(c.el);
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const menu = document.querySelector<HTMLElement>('.saveMenu')!;
    const rows = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(document.activeElement).toBe(rows[0]);
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows[1]);
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows[0]);
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(save).toHaveBeenCalledTimes(1);
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document
      .querySelector('.saveMenu')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.saveMenu')).toBeNull();
    expect(document.activeElement).toBe(a);
  });

  it('a click outside or a resize closes it', () => {
    const { c } = control({ writeBack: true, file: null });
    arrow(c.el).click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.saveMenu')).toBeNull();
    arrow(c.el).click();
    window.dispatchEvent(new Event('resize'));
    expect(document.querySelector('.saveMenu')).toBeNull();
  });
});
