/**
 * Settings: how the app looks and behaves for this viewer (app/settings.ts) - kept in this
 * browser, not in the project. Opened from the toolbar's gear button.
 */
import { getSettings, updateSettings, type Settings } from '../app/settings';

function checkboxOption(
  label: string,
  hint: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'settingsOption';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  const text = document.createElement('span');
  const title = document.createElement('b');
  title.textContent = label;
  const small = document.createElement('small');
  small.textContent = hint;
  text.append(title, small);
  row.append(box, text);
  return row;
}

export function openSettingsDialog(): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const dialog = document.createElement('div');
  dialog.className = 'exportDialog settingsDialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Settings');
  backdrop.appendChild(dialog);

  const header = document.createElement('div');
  header.className = 'exportDialogHeader';
  const title = document.createElement('h2');
  title.textContent = 'Settings';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'exportDialogClose';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', () => close());
  header.append(title, closeBtn);
  dialog.appendChild(header);

  const settings = getSettings();

  const heading = document.createElement('div');
  heading.className = 'inspectorSectionHeading';
  heading.textContent = 'Documents';
  dialog.appendChild(heading);

  const placeRow = document.createElement('label');
  placeRow.className = 'inspectorRow';
  const placeLabel = document.createElement('span');
  placeLabel.textContent = 'Open documents';
  const place = document.createElement('select');
  const places: Array<{ value: Settings['docsPlace']; label: string }> = [
    { value: 'tabs', label: 'Tabs above the canvas' },
    { value: 'inspector', label: 'List in the inspector' },
  ];
  for (const p of places) {
    const option = document.createElement('option');
    option.value = p.value;
    option.textContent = p.label;
    place.appendChild(option);
  }
  place.value = settings.docsPlace;
  place.addEventListener('change', () =>
    updateSettings({ docsPlace: place.value as Settings['docsPlace'] }),
  );
  placeRow.append(placeLabel, place);
  dialog.appendChild(placeRow);

  dialog.append(
    checkboxOption(
      'Show the documents even when only one is open',
      'Otherwise the tabs or the list appear once a second document is open.',
      settings.docsAlways,
      (docsAlways) => updateSettings({ docsAlways }),
    ),
    checkboxOption(
      'Open examples and files in a new document',
      'Otherwise they replace the circuit on the canvas (Undo brings it back). An empty ' +
        'document is used either way.',
      settings.openInNewDoc,
      (openInNewDoc) => updateSettings({ openInNewDoc }),
    ),
  );

  const note = document.createElement('p');
  note.className = 'inspectorHint';
  note.textContent =
    'Settings are kept in this browser. Every open document is kept here too, so they are ' +
    'all back after a reload - save to a file to keep a circuit for good.';
  dialog.appendChild(note);

  function close(): void {
    backdrop.remove();
    window.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  window.addEventListener('keydown', onKeydown);

  document.body.appendChild(backdrop);
}
