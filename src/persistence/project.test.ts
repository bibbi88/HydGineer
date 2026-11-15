import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '../app/AppState';
import { serializeProject, loadProject } from './project';
import { setComponentMirrored, setComponentRotation } from '../interaction/componentContextMenu';
import {
  createHydPump as createSource,
  HYD_PUMP_TYPE as SOURCE_TYPE,
} from '../components/hyd/supply';
import type { ComponentFactoryContext } from '../components/registry';
import type { ViewportAdapter } from '../ui/viewport';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

const ctx: ComponentFactoryContext = { compLayer: compLayer() };
const viewport: ViewportAdapter = {
  clientToWorld: (cx, cy) => ({ x: cx, y: cy }),
  applyTransform: () => {},
  getTransform: () => ({ scale: 1, tx: 0, ty: 0 }),
  setTransform: () => {},
  setGridVisible: () => {},
};

describe('project rotation round-trip', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
  });

  it('serializeProject captures a component rotation set via the context menu', () => {
    const comp = createSource(compLayer(), 0, 0);
    appState.addComponent(comp);
    setComponentRotation(comp, 90);

    const file = serializeProject('test');
    expect(file.comps[0]?.rot).toBe(90);
  });

  it('mirroring round-trips through save and load', () => {
    const comp = createSource(compLayer(), 0, 0);
    appState.addComponent(comp);
    setComponentMirrored(comp, true);

    const file = serializeProject('test');
    expect(file.comps[0]?.mirror).toBe(true);

    loadProject(file, ctx, viewport);
    const loaded = appState.components[0];
    expect(loaded?.el.dataset.mirror).toBe('1');
    expect(loaded?.el.querySelector<SVGSVGElement>('svg.compSvg')?.style.transform).toBe(
      'scaleX(-1)',
    );
  });

  it('serializeProject omits rotation as 0 for an unrotated component', () => {
    const comp = createSource(compLayer(), 0, 0);
    appState.addComponent(comp);

    const file = serializeProject('test');
    expect(file.comps[0]?.rot).toBe(0);
  });

  it('loadProject restores a saved rotation onto the newly spawned component', () => {
    const file = {
      schemaVersion: 1 as const,
      name: 'test',
      comps: [{ id: 1, type: SOURCE_TYPE, x: 0, y: 0, rot: 180, data: {} }],
      conns: [],
    };

    loadProject(file, ctx, viewport);

    expect(appState.components).toHaveLength(1);
    expect(appState.components[0]?.el.dataset.rot).toBe('180');
    expect(appState.components[0]?.el.style.transform).toContain('rotate(180deg)');
  });

  it('loadProject treats a missing rot as unrotated, for files saved before this field existed', () => {
    const file = {
      schemaVersion: 1 as const,
      name: 'test',
      comps: [{ id: 1, type: SOURCE_TYPE, x: 0, y: 0, data: {} }],
      conns: [],
    };

    loadProject(file, ctx, viewport);

    expect(appState.components[0]?.el.dataset.rot).toBeUndefined();
  });
});

describe('project title-block metadata round-trip', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    appState.projectAuthor = '';
    appState.projectCheckedBy = '';
    appState.projectCompany = '';
    appState.projectDate = '';
  });

  it('serializeProject captures author/checkedBy/company/date from appState', () => {
    appState.projectAuthor = 'Jane';
    appState.projectCheckedBy = 'Alex';
    appState.projectCompany = 'Acme Pneumatics';
    appState.projectDate = '2026-09-18';

    const file = serializeProject('test');
    expect(file.meta).toEqual({
      author: 'Jane',
      checkedBy: 'Alex',
      company: 'Acme Pneumatics',
      date: '2026-09-18',
    });
  });

  it('loadProject restores saved meta onto appState', () => {
    const file = {
      schemaVersion: 1 as const,
      name: 'test',
      meta: {
        author: 'Jane',
        checkedBy: 'Alex',
        company: 'Acme Pneumatics',
        date: '2026-09-18',
      },
      comps: [],
      conns: [],
    };

    loadProject(file, ctx, viewport);

    expect(appState.projectAuthor).toBe('Jane');
    expect(appState.projectCheckedBy).toBe('Alex');
    expect(appState.projectCompany).toBe('Acme Pneumatics');
    expect(appState.projectDate).toBe('2026-09-18');
  });

  it('loadProject treats a missing meta as blank, for files saved before this field existed', () => {
    appState.projectAuthor = 'stale value from a previous project';
    appState.projectDate = '2026-01-01';
    const file = { schemaVersion: 1 as const, name: 'test', comps: [], conns: [] };

    loadProject(file, ctx, viewport);

    expect(appState.projectAuthor).toBe('');
    expect(appState.projectCheckedBy).toBe('');
    expect(appState.projectCompany).toBe('');
    expect(appState.projectDate).toBe('');
  });
});

describe('project page-frame round-trip', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    appState.pageFrameSize = 'none';
    appState.pageFrameX = 0;
    appState.pageFrameY = 0;
  });

  it('serializeProject captures the current page frame size and position', () => {
    appState.pageFrameSize = 'a3';
    appState.pageFrameX = 120;
    appState.pageFrameY = -40;

    const file = serializeProject('test');
    expect(file.pageFrame).toEqual({ size: 'a3', x: 120, y: -40 });
  });

  it('loadProject restores the saved page frame onto appState', () => {
    const file = {
      schemaVersion: 1 as const,
      name: 'test',
      pageFrame: { size: 'a4' as const, x: 300, y: 150 },
      comps: [],
      conns: [],
    };

    loadProject(file, ctx, viewport);

    expect(appState.pageFrameSize).toBe('a4');
    expect(appState.pageFrameX).toBe(300);
    expect(appState.pageFrameY).toBe(150);
  });

  it('loadProject treats a missing pageFrame as none, for files saved before this field existed', () => {
    appState.pageFrameSize = 'a3';
    const file = { schemaVersion: 1 as const, name: 'test', comps: [], conns: [] };

    loadProject(file, ctx, viewport);

    expect(appState.pageFrameSize).toBe('none');
    expect(appState.pageFrameX).toBe(0);
    expect(appState.pageFrameY).toBe(0);
  });
});

describe('project origin/last-saved device id (not shown in the UI, only carried in the file)', () => {
  beforeEach(() => {
    appState.components = [];
    appState.connections = [];
    appState.projectOriginDeviceId = null;
    appState.projectLastSavedDeviceId = null;
    localStorage.clear();
  });

  it('stamps this browser’s id as os on the first serialization; LS waits for a save', () => {
    appState.projectLastSavedDeviceId = null;
    appState.projectLastSavedAt = null;
    const file = serializeProject('test');

    expect(file.os).toBe(appState.projectOriginDeviceId);
    expect(file).not.toHaveProperty('LS');
    expect(file).not.toHaveProperty('lst');
    expect(file).not.toHaveProperty('origin');
    expect(file).not.toHaveProperty('lastSaved');
  });

  it('keeps os and ct frozen across serializations', () => {
    const first = serializeProject('test');
    const second = serializeProject('test');

    expect(second.os).toBe(first.os);
    expect(second.ct).toBe(first.ct);
  });

  it('stamps ct on a new project as a Unix time in seconds', () => {
    loadProject({ schemaVersion: 1 as const, name: 'new', comps: [], conns: [] }, ctx, viewport);
    const before = Math.floor(Date.now() / 1000);
    const file = serializeProject('new');

    expect(file.ct).toBeGreaterThanOrEqual(before);
    expect(file.ct).toBeLessThanOrEqual(before + 1);
  });

  it('round-trips os, LS, ct and lst', () => {
    const file = {
      schemaVersion: 1 as const,
      name: 'test',
      os: 'device-a',
      LS: 'device-b',
      ct: 1_700_000_000,
      lst: 1_700_000_500,
      comps: [],
      conns: [],
    };
    loadProject(file, ctx, viewport);
    const again = serializeProject('test');

    expect(again).toMatchObject({
      os: 'device-a',
      LS: 'device-b',
      ct: 1_700_000_000,
      lst: 1_700_000_500,
    });
  });

  it('reads the older origin/lastSaved names, and writes them as os/LS', () => {
    const file = {
      schemaVersion: 1 as const,
      name: 'test',
      origin: 'device-from-a-different-browser',
      lastSaved: 'device-from-a-different-browser',
      comps: [],
      conns: [],
    };
    loadProject(file, ctx, viewport);

    const resaved = serializeProject('test');

    expect(resaved.os).toBe('device-from-a-different-browser');
    expect(resaved.LS).toBe('device-from-a-different-browser');
    // Saved before creation times were kept: no made-up ct.
    expect(resaved).not.toHaveProperty('ct');
  });

  it('loadProject treats missing origin/lastSaved as unset, for files saved before this field existed', () => {
    appState.projectOriginDeviceId = 'stale-id-from-a-previous-project';
    appState.projectLastSavedDeviceId = 'stale-id-from-a-previous-project';
    const file = { schemaVersion: 1 as const, name: 'test', comps: [], conns: [] };

    loadProject(file, ctx, viewport);

    expect(appState.projectOriginDeviceId).toBeNull();
    expect(appState.projectLastSavedDeviceId).toBeNull();
  });
});
