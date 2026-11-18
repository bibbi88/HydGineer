/** A short message at the bottom of the window that fades by itself ("Saved Valve test.hgcl"). */
let current: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function showToast(text: string, ms = 2200): void {
  current?.remove();
  if (timer) clearTimeout(timer);
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  current = el;
  timer = setTimeout(() => {
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 250);
    if (current === el) current = null;
  }, ms);
}
