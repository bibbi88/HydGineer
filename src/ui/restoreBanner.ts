export function showRestoreBanner(onRestore: () => void, onDismiss: () => void): void {
  const banner = document.createElement('div');
  banner.className = 'restoreBanner';

  const text = document.createElement('span');
  text.textContent = 'Unsaved work found from a previous session.';
  banner.appendChild(text);

  const restoreBtn = document.createElement('button');
  restoreBtn.textContent = 'Restore';
  restoreBtn.addEventListener('click', () => {
    onRestore();
    banner.remove();
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', () => {
    onDismiss();
    banner.remove();
  });

  banner.append(restoreBtn, dismissBtn);
  document.body.appendChild(banner);
}
