import { installUpdate } from '../app/updates';

/** A bar along the bottom of the window: a downloaded update, Restart now or Later (it's then
 * installed when the app is closed). */
export function showUpdateReady(version: string | undefined): void {
  document.querySelector('.updateBanner')?.remove();
  const bar = document.createElement('div');
  bar.className = 'updateBanner';
  bar.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = version
    ? `HydGineer ${version} is ready to install.`
    : 'A new version of HydGineer is ready to install.';
  const restart = document.createElement('button');
  restart.type = 'button';
  restart.className = 'btn';
  restart.textContent = 'Restart now';
  restart.addEventListener('click', () => installUpdate());
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn';
  later.textContent = 'Later';
  later.title = 'It will be installed when HydGineer is closed';
  later.addEventListener('click', () => bar.remove());
  bar.append(text, restart, later);
  document.body.appendChild(bar);
}
