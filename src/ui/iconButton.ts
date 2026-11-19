import { createIcon, type IconName } from './icons';

/** A square icon toolbar button. The label becomes the tooltip and the accessible name; the
 * short `caption` (the label if not given) is drawn under the icon when the toolbar shows text
 * (Settings → Toolbar, body.toolbarText - see app/settings.ts). */
export function iconButton(
  icon: IconName,
  label: string,
  onClick: () => void,
  caption?: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'iconBtn';
  btn.type = 'button';
  btn.appendChild(createIcon(icon));
  const cap = document.createElement('span');
  cap.className = 'iconBtnCaption';
  btn.appendChild(cap);
  setIconButtonLabel(btn, label, caption);
  btn.addEventListener('click', onClick);
  return btn;
}

/** Changes a button's icon (if given), label and caption - e.g. Play turning into Stop. */
export function setIconButtonLabel(
  btn: HTMLButtonElement,
  label: string,
  caption = label,
  icon?: IconName,
): void {
  btn.title = label;
  btn.setAttribute('aria-label', label);
  if (icon) btn.querySelector('svg')?.replaceWith(createIcon(icon));
  let cap = btn.querySelector<HTMLElement>('.iconBtnCaption');
  if (!cap) {
    cap = document.createElement('span');
    cap.className = 'iconBtnCaption';
    btn.appendChild(cap);
  }
  cap.textContent = caption;
}
