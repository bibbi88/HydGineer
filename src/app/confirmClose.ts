import { appState } from './AppState';

/** Warns before closing/reloading the tab whenever there's actually something on the canvas to
 * lose - an empty project needs no confirmation. Browsers ignore any custom message text here
 * for security reasons and show their own fixed wording instead; setting `returnValue` (the
 * standard, still-supported way to trigger that) is all a page can do. */
export function initConfirmBeforeUnload(): void {
  window.addEventListener('beforeunload', (e) => {
    if (appState.components.length === 0) return;
    e.preventDefault();
    e.returnValue = '';
  });
}
