import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from './AppState';
import { initConfirmBeforeUnload } from './confirmClose';
import { createSource } from '../components/source';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

function dispatchBeforeUnload(): BeforeUnloadEvent {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}

describe('confirming before an accidental close', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
  });

  it('does not warn when the canvas is empty', () => {
    initConfirmBeforeUnload();
    const event = dispatchBeforeUnload();
    expect(event.defaultPrevented).toBe(false);
  });

  it('warns once there is at least one component on the canvas', () => {
    initConfirmBeforeUnload();
    appState.addComponent(createSource(compLayer(), 0, 0));

    // jsdom's plain Event doesn't fully model BeforeUnloadEvent's returnValue semantics, so
    // defaultPrevented (set by our handler's own preventDefault() call) is the reliable check -
    // it's the same signal real browsers require to show the confirmation at all.
    const event = dispatchBeforeUnload();
    expect(event.defaultPrevented).toBe(true);
  });
});
