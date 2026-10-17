import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import {
  createValve52Solenoid,
  createValve52SolenoidDouble,
  createValve53Solenoid,
} from './solenoidValves';
import { createElecSolenoid } from './electrical';
import type { Component } from '../core/types';

function layer(): HTMLElement {
  return document.createElement('div');
}

/** Placing a component for real goes through spawnComponent, which registers it - that is what
 * makes it visible to the next valve's own name lookup. */
function place(make: () => Component): Component {
  const comp = make();
  appState.addComponent(comp);
  return comp;
}

function keys(comp: Component): string[] {
  const snap = comp.snapshot() as Record<string, unknown>;
  return ['key', 'key14', 'key12']
    .map((f) => snap[f])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}

describe('solenoid valves get their own coil names', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
  });

  it('a second single-solenoid valve does not reuse the first one’s coil', () => {
    const first = place(() => createValve52Solenoid(layer(), 0, 0));
    const second = place(() => createValve52Solenoid(layer(), 300, 0));

    expect(keys(first)).toEqual(['Y1']);
    expect(keys(second)).toEqual(['Y2']);
  });

  it('a double-solenoid valve takes two names, and the next valve carries on past them', () => {
    const double = place(() => createValve52SolenoidDouble(layer(), 0, 0));
    const single = place(() => createValve52Solenoid(layer(), 300, 0));

    expect(keys(double)).toEqual(['Y1', 'Y2']);
    expect(keys(single)).toEqual(['Y3']);
  });

  it('names stay unique across the different solenoid valve types', () => {
    const a = place(() => createValve52Solenoid(layer(), 0, 0));
    const b = place(() => createValve53Solenoid(layer(), 300, 0));
    const c = place(() => createValve52SolenoidDouble(layer(), 600, 0));

    const all = [...keys(a), ...keys(b), ...keys(c)];
    expect(all).toEqual(['Y1', 'Y2', 'Y3', 'Y4', 'Y5']);
    expect(new Set(all).size).toBe(all.length);
  });

  it('reuses a name freed by deleting a valve, rather than counting ever upward', () => {
    const first = place(() => createValve52Solenoid(layer(), 0, 0));
    place(() => createValve52Solenoid(layer(), 300, 0));

    appState.components = appState.components.filter((c) => c.id !== first.id);
    const replacement = place(() => createValve52Solenoid(layer(), 600, 0));

    expect(keys(replacement)).toEqual(['Y1']);
  });

  it('respects a renamed coil instead of handing the same name out again', () => {
    const first = place(() => createValve52Solenoid(layer(), 0, 0));
    first.restore({ ...first.snapshot(), key: 'Y7' });

    const second = place(() => createValve52Solenoid(layer(), 300, 0));
    expect(keys(second)).toEqual(['Y1']);

    const third = place(() => createValve52Solenoid(layer(), 600, 0));
    expect(keys(third)).toEqual(['Y2']);
  });

  it('does not skip past a valve when naming an electrical solenoid', () => {
    // The coil that drives a valve is meant to share its name - allocating them from one pool
    // would hand the first coil Y2 and leave the first valve with nothing driving it.
    const valve = place(() => createValve52Solenoid(layer(), 0, 0));
    const coil = place(() => createElecSolenoid(layer(), 300, 0));

    expect(keys(valve)).toEqual(['Y1']);
    expect((coil.snapshot() as Record<string, unknown>).key).toBe('Y1');
  });

  it('a loaded project keeps its saved names, whatever the factory picked first', () => {
    const valve = place(() => createValve52SolenoidDouble(layer(), 0, 0));
    valve.restore({ ...valve.snapshot(), key14: 'K1', key12: 'K2' });
    expect(keys(valve)).toEqual(['K1', 'K2']);
  });
});

function labels(comp: Component): SVGTextElement[] {
  return Array.from(comp.el.querySelectorAll('text')).filter((t) =>
    /^[A-Z]\d+$/i.test(t.textContent ?? ''),
  );
}

function flagged(comp: Component): string[] {
  return labels(comp)
    .filter((t) => t.classList.contains('solenoidLabelDuplicate'))
    .map((t) => t.textContent ?? '');
}

describe('duplicate coil labels are flagged', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
  });

  it('leaves auto-assigned names unflagged, since they are unique by construction', () => {
    const a = place(() => createValve52Solenoid(layer(), 0, 0));
    const b = place(() => createValve52Solenoid(layer(), 300, 0));
    appState.markDirty();

    expect(flagged(a)).toEqual([]);
    expect(flagged(b)).toEqual([]);
  });

  it('flags both valves once one is renamed onto the other', () => {
    const a = place(() => createValve52Solenoid(layer(), 0, 0));
    const b = place(() => createValve52Solenoid(layer(), 300, 0));

    // What the inspector does when you type over the coil name.
    b.restore({ ...b.snapshot(), key: 'Y1' });
    appState.markDirty();

    expect(flagged(b)).toEqual(['Y1']);
    // The other valve never saw the edit itself - it repaints off the change notification.
    expect(flagged(a)).toEqual(['Y1']);
  });

  it('clears the flag again when the clash is resolved', () => {
    const a = place(() => createValve52Solenoid(layer(), 0, 0));
    const b = place(() => createValve52Solenoid(layer(), 300, 0));
    b.restore({ ...b.snapshot(), key: 'Y1' });
    appState.markDirty();
    expect(flagged(a)).toEqual(['Y1']);

    b.restore({ ...b.snapshot(), key: 'Y9' });
    appState.markDirty();
    expect(flagged(a)).toEqual([]);
    expect(flagged(b)).toEqual([]);
  });

  it('catches a valve whose own two coils were given the same name', () => {
    // Both ends would fire at once off one signal - the case a plain "does another component
    // use this?" check would miss entirely.
    const valve = place(() => createValve52SolenoidDouble(layer(), 0, 0));
    valve.restore({ ...valve.snapshot(), key12: 'Y1' });
    appState.markDirty();

    expect(flagged(valve)).toEqual(['Y1', 'Y1']);
  });

  it('matches names case-insensitively, the way the signal bus does', () => {
    const a = place(() => createValve52Solenoid(layer(), 0, 0));
    const b = place(() => createValve52Solenoid(layer(), 300, 0));
    b.restore({ ...b.snapshot(), key: 'y1' });
    appState.markDirty();

    expect(flagged(a)).toEqual(['Y1']);
    expect(flagged(b)).toEqual(['y1']);
  });

  it('does not flag a valve merely because an electrical solenoid shares its name', () => {
    // That pairing is the mechanism - the coil is what drives the valve.
    const valve = place(() => createValve52Solenoid(layer(), 0, 0));
    place(() => createElecSolenoid(layer(), 300, 0));
    appState.markDirty();

    expect(flagged(valve)).toEqual([]);
  });
});
