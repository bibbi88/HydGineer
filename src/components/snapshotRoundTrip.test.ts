import { describe, expect, it } from 'vitest';
import { createCylinderDouble } from './cylinderDouble';
import { createCylinderSingle } from './cylinderSingle';
import { createValve52 } from './valve52';
import { createValve52Mono } from './valve52Mono';
import { createThrottleValve } from './throttleValve';
import { createSource } from './source';
import { createTextAnnotation } from './textAnnotation';
import { createPushButton32 } from './pushButton32';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

describe('component snapshot/restore round-trips', () => {
  it('cylinderDouble persists its letter as real state, not scraped from label text', () => {
    const original = createCylinderDouble(compLayer(), 0, 0);
    const snap = original.snapshot();
    expect(snap.letter).toBe('A');

    // simulate a fresh app session: a brand new instance restoring saved data
    const restored = createCylinderDouble(compLayer(), 10, 10);
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);
  });

  it('cylinderSingle round-trips mode and normallyExtended', () => {
    const original = createCylinderSingle(compLayer(), 0, 0);
    const snap = original.snapshot();

    const restored = createCylinderSingle(compLayer(), 0, 0);
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);
  });

  it('cylinderSingle switching to pull immediately rests with the piston out, not on the next step', () => {
    const cyl = createCylinderSingle(compLayer(), 0, 0);
    expect(cyl.snapshot()).toMatchObject({ mode: 'push', pos: 0, normallyExtended: false });

    cyl.setCylinderMode?.('pull');
    expect(cyl.snapshot()).toMatchObject({ mode: 'pull', pos: 1, normallyExtended: true });

    // Switching back to push snaps it straight back to retracted, same reasoning.
    cyl.setCylinderMode?.('push');
    expect(cyl.snapshot()).toMatchObject({ mode: 'push', pos: 0, normallyExtended: false });
  });

  it('cylinderSingle loading a saved pull cylinder keeps its saved position, not the mode default', () => {
    // A pull cylinder saved mid-stroke (e.g. autosaved while the sim was running) must restore
    // exactly where it was - setCylinderMode()'s "snap to default" logic must not run here.
    const cyl = createCylinderSingle(compLayer(), 0, 0);
    cyl.restore({
      pos: 0.37,
      letter: 'A',
      mode: 'pull',
      normallyExtended: true,
      sensors: [],
      showName: false,
      customName: null,
    });
    expect(cyl.snapshot()).toMatchObject({ mode: 'pull', pos: 0.37 });
  });

  it('valve52 round-trips its state', () => {
    const original = createValve52(compLayer(), 0, 0);
    original.onPressureChange?.({ isPressurized: (p) => p === '12' });
    const snap = original.snapshot();
    expect(snap.state).toBe(1);

    const restored = createValve52(compLayer(), 0, 0);
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);
  });

  it('valve52Mono round-trips its state and defaults its silencers on, same as the bistable valve', () => {
    const original = createValve52Mono(compLayer(), 0, 0);
    const defaultSnap = original.snapshot();
    expect(defaultSnap.silencer3).toBe('silencer');
    expect(defaultSnap.silencer5).toBe('silencer');

    original.onPressureChange?.({ isPressurized: () => true });
    const snap = original.snapshot();
    expect(snap.state).toBe(0);

    const restored = createValve52Mono(compLayer(), 0, 0);
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);
  });

  it('throttleValve round-trips flowPct', () => {
    const original = createThrottleValve(compLayer(), 0, 0);
    const snap = original.snapshot();

    const restored = createThrottleValve(compLayer(), 0, 0);
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);
  });

  it('names are hidden with no custom override by default, and round-trip when set', () => {
    const original = createSource(compLayer(), 0, 0);
    const defaultSnap = original.snapshot();
    expect(defaultSnap.showName).toBe(false);
    expect(defaultSnap.customName).toBeNull();

    original.restore({ ...defaultSnap, showName: true, customName: 'Main supply' });
    const snap = original.snapshot();
    expect(snap.showName).toBe(true);
    expect(snap.customName).toBe('Main supply');

    const restored = createSource(compLayer(), 0, 0);
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);
  });

  it('valve52 silencers are on by default (conventional fit) and round-trip independently per port', () => {
    const original = createValve52(compLayer(), 0, 0);
    const defaultSnap = original.snapshot();
    expect(defaultSnap.silencer3).toBe('silencer');
    expect(defaultSnap.silencer5).toBe('silencer');

    original.restore({ ...defaultSnap, silencer3: 'none', silencer5: 'silencer' });
    const snap = original.snapshot();
    expect(snap.silencer3).toBe('none');
    expect(snap.silencer5).toBe('silencer');

    const restored = createValve52(compLayer(), 0, 0);
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);
  });

  it('pushButton32 exhaust silencer is on by default (conventional fit) and round-trips', () => {
    const original = createPushButton32(compLayer(), 0, 0);
    expect(original.snapshot().silencer3).toBe('silencer');

    original.restore({ ...original.snapshot(), silencer3: 'none' });
    const snap = original.snapshot();
    expect(snap.silencer3).toBe('none');

    const restored = createPushButton32(compLayer(), 0, 0);
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);
  });

  it('text annotation round-trips its text', () => {
    const original = createTextAnnotation(compLayer(), 0, 0);
    expect(original.snapshot().text).toBe('Note');

    original.restore({ text: 'Bleed valve before startup' });
    const snap = original.snapshot();
    expect(snap.text).toBe('Bleed valve before startup');

    const restored = createTextAnnotation(compLayer(), 0, 0);
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);
  });
});
