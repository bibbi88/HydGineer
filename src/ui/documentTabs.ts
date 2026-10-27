/**
 * The open documents (app/documents.ts) as tabs above the canvas, or as a list in the inspector
 * - which one is a setting (app/settings.ts). Click one to switch to it, double-click to rename
 * it, middle-click or × to close it, right-click for more.
 */
import {
  activeDocumentId,
  closeDocument,
  closeOtherDocuments,
  duplicateDocument,
  isDocumentEmpty,
  listDocuments,
  moveDocument,
  newDocument,
  renameDocument,
  switchDocument,
  type ProjectDocument,
} from '../app/documents';
import { getSettings } from '../app/settings';
import { showContextMenu, type ContextMenuItem } from '../interaction/contextMenu';
import { saveProjectToFile } from '../persistence/save';

/** Whether the documents are shown at all - with only one open, only if the setting asks. */
function documentsShown(): boolean {
  return getSettings().docsAlways || listDocuments().length > 1;
}

function saveToFile(doc: ProjectDocument): void {
  // Saving goes by what's on the canvas, so the document goes there first.
  switchDocument(doc.id);
  void saveProjectToFile(doc.name || 'project');
}

/** Closes `doc` - straight away if there's nothing in it, otherwise after asking, since its
 * circuit is then gone from the browser. */
export function askToCloseDocument(doc: ProjectDocument, x: number, y: number): void {
  if (isDocumentEmpty(doc.id)) {
    closeDocument(doc.id);
    return;
  }
  showContextMenu(x, y, [
    {
      label: `Close “${doc.name}” - its circuit is removed from this browser`,
      onClick: () => closeDocument(doc.id),
    },
    { label: 'Save it to a file first…', onClick: () => saveToFile(doc) },
    { label: 'Cancel', onClick: () => {} },
  ]);
}

function renameInPlace(doc: ProjectDocument, item: HTMLElement): void {
  const nameEl = item.querySelector('.docName');
  if (!nameEl) return;
  const input = document.createElement('input');
  input.className = 'docNameEdit';
  input.value = doc.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (keep: boolean): void => {
    if (done) return;
    done = true;
    if (keep) renameDocument(doc.id, input.value);
    // Re-rendered by the rename; without one (cancelled, or the same name) put the label back.
    if (input.isConnected) input.replaceWith(nameEl);
  };
  input.addEventListener('keydown', (e) => {
    // Typing a name must not reach the canvas's own shortcuts (R, Delete...).
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('mousedown', (e) => e.stopPropagation());
}

function documentMenu(doc: ProjectDocument, item: HTMLElement, x: number, y: number): void {
  const docs = listDocuments();
  const i = docs.indexOf(doc);
  const items: ContextMenuItem[] = [
    { label: 'Rename', onClick: () => renameInPlace(doc, item) },
    { label: 'Duplicate', onClick: () => duplicateDocument(doc.id) },
    { label: 'Save to a file…', onClick: () => saveToFile(doc) },
  ];
  if (i > 0) items.push({ label: 'Move left', onClick: () => moveDocument(doc.id, -1) });
  if (i < docs.length - 1)
    items.push({ label: 'Move right', onClick: () => moveDocument(doc.id, 1) });
  items.push({ label: 'New circuit', onClick: () => newDocument() });
  // The confirmation is a menu of its own, opened once this one has closed.
  items.push({ label: 'Close', onClick: () => setTimeout(() => askToCloseDocument(doc, x, y), 0) });
  if (docs.length > 1)
    items.push({ label: 'Close the others', onClick: () => closeOtherDocuments(doc.id) });
  showContextMenu(x, y, items);
}

function documentItem(doc: ProjectDocument, className: string): HTMLElement {
  const item = document.createElement('div');
  const isActive = doc.id === activeDocumentId();
  item.className = className + (isActive ? ' active' : '');
  item.setAttribute('role', 'tab');
  item.setAttribute('aria-selected', String(isActive));
  item.title = `${doc.name} - double-click to rename, right-click for more`;

  const name = document.createElement('span');
  name.className = 'docName';
  name.textContent = doc.name;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'docClose';
  close.textContent = '×';
  close.title = 'Close';
  close.setAttribute('aria-label', `Close ${doc.name}`);
  item.append(name, close);

  item.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.docClose, input')) return;
    switchDocument(doc.id);
  });
  item.addEventListener('dblclick', (e) => {
    if ((e.target as Element).closest('.docClose')) return;
    renameInPlace(doc, item);
  });
  item.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    askToCloseDocument(doc, e.clientX, e.clientY);
  });
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    documentMenu(doc, item, e.clientX, e.clientY);
  });
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = close.getBoundingClientRect();
    askToCloseDocument(doc, r.left, r.bottom + 4);
  });
  return item;
}

/** Fills the tab bar above the canvas - or hides it, when the documents are listed in the
 * inspector instead or there's only one and the setting says not to show it alone. */
export function renderDocumentTabs(bar: HTMLElement): void {
  bar.replaceChildren();
  bar.hidden = getSettings().docsPlace !== 'tabs' || !documentsShown();
  if (bar.hidden) return;
  for (const doc of listDocuments()) bar.appendChild(documentItem(doc, 'docTab'));
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'docNew';
  plus.textContent = '+';
  plus.title = 'New circuit';
  plus.setAttribute('aria-label', 'New circuit');
  plus.addEventListener('click', () => newDocument());
  bar.appendChild(plus);
}

/** The inspector's "Documents" section, when the documents are listed there rather than as
 * tabs. */
export function renderDocumentListSection(container: HTMLElement): void {
  if (getSettings().docsPlace !== 'inspector' || !documentsShown()) return;
  const heading = document.createElement('div');
  heading.className = 'inspectorSectionHeading';
  heading.textContent = 'Documents';
  container.appendChild(heading);
  const list = document.createElement('div');
  list.className = 'docList';
  list.setAttribute('role', 'tablist');
  for (const doc of listDocuments()) list.appendChild(documentItem(doc, 'docRow'));
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'btn docListNew';
  plus.textContent = '+ New circuit';
  plus.addEventListener('click', () => newDocument());
  container.append(list, plus);
}
