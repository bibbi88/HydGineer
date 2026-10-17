import { createIcon, type IconName } from './icons';

/** A square icon-only toolbar button. The label isn't drawn - it becomes the tooltip and the
 * accessible name, since the toolbar is too narrow to caption every control. */
export function iconButton(icon: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'iconBtn';
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.appendChild(createIcon(icon));
  btn.addEventListener('click', onClick);
  return btn;
}
