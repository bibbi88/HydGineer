import type { Component, ComponentId } from '../core/types';
import { appState } from '../app/AppState';

const selectionListeners: Array<() => void> = [];

export function onSelectionChange(cb: () => void): void {
  selectionListeners.push(cb);
}

function notifySelectionChange(): void {
  for (const cb of selectionListeners) cb();
}

function applySelectedClasses(): void {
  for (const c of appState.components) {
    c.setSelected(appState.selectedComponents.has(c.id));
  }
}

export function selectOnly(id: ComponentId): void {
  appState.selectedComponents.clear();
  appState.selectedComponents.add(id);
  appState.selectedConnectionId = null;
  applySelectedClasses();
  applyConnectionSelectedClass();
  notifySelectionChange();
}

export function addToSelection(id: ComponentId): void {
  appState.selectedComponents.add(id);
  applySelectedClasses();
  notifySelectionChange();
}

export function toggleSelection(id: ComponentId): void {
  if (appState.selectedComponents.has(id)) {
    appState.selectedComponents.delete(id);
  } else {
    appState.selectedComponents.add(id);
  }
  // A wire and components are never selected together (see selectConnection).
  appState.selectedConnectionId = null;
  applySelectedClasses();
  applyConnectionSelectedClass();
  notifySelectionChange();
}

export function clearSelection(): void {
  appState.selectedComponents.clear();
  appState.selectedConnectionId = null;
  applySelectedClasses();
  applyConnectionSelectedClass();
  notifySelectionChange();
}

export function getSelectedComponents(): Component[] {
  return appState.components.filter((c) => appState.selectedComponents.has(c.id));
}

export function selectConnection(id: ComponentId): void {
  appState.selectedComponents.clear();
  appState.selectedConnectionId = id;
  applySelectedClasses();
  applyConnectionSelectedClass();
  notifySelectionChange();
}

export function clearConnectionSelection(): void {
  appState.selectedConnectionId = null;
  applyConnectionSelectedClass();
  notifySelectionChange();
}

function applyConnectionSelectedClass(): void {
  for (const conn of appState.connections) {
    conn.pathEl.classList.toggle('selected', conn.id === appState.selectedConnectionId);
  }
}
