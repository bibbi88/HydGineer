/**
 * Clean-up tied to a component: subscriptions and window listeners a component makes live as
 * long as it does. Undo, loading and switching tabs rebuild every component on the canvas;
 * without this, each discarded one stayed subscribed - kept alive, its old DOM with it, and
 * still doing its work at every change - so a long session grew slower and slower.
 *
 * The owner is the component's element; AppState.removeComponent runs its clean-up.
 */

const cleanups = new WeakMap<object, Array<() => void>>();

/** Runs `fn` when `owner` is removed. */
export function onRemoved(owner: object, fn: () => void): void {
  const list = cleanups.get(owner);
  if (list) list.push(fn);
  else cleanups.set(owner, [fn]);
}

/** `owner` has been removed: everything registered for it is undone. */
export function runRemoved(owner: object): void {
  const list = cleanups.get(owner);
  if (!list) return;
  cleanups.delete(owner);
  for (const fn of list) fn();
}

/** A window listener that goes away with `owner`. */
export function listenWindow<K extends keyof WindowEventMap>(
  owner: object,
  type: K,
  listener: (e: WindowEventMap[K]) => void,
): void {
  window.addEventListener(type, listener);
  onRemoved(owner, () => window.removeEventListener(type, listener));
}
