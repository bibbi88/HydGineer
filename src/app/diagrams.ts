/**
 * The diagrams a project shows of its recorded runs (ui/diagramPanel.ts): which quantities each
 * plots, between which events, and the ratios worked out from them (e.g. an efficiency). Saved in
 * the project file, as the circuit's own: they refer to its components.
 */
import { appState } from './AppState';

/** A moment in the run: its start or end, a time, or the nth time a signal turns on or off (a
 * push button, a sensor such as A1, a relay...). For a window's end, the nth after its start. */
export type DiagramEvent =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'time'; t: number }
  | { kind: 'signal'; name: string; edge: 'on' | 'off'; n: number };

/** A recorded quantity: a component's probe (Component.probes). */
export interface SeriesRef {
  compId: number;
  key: string;
}

export type RatioMeasure = 'integral' | 'mean' | 'max';

/** numerator / denominator over the window - e.g. the energy to the load over the pump's shaft
 * energy: the efficiency. */
export interface RatioCalc {
  label: string;
  num: SeriesRef;
  den: SeriesRef;
  measure: RatioMeasure;
}

export interface DiagramConfig {
  id: string;
  title: string;
  series: SeriesRef[];
  from: DiagramEvent;
  to: DiagramEvent;
  ratios: RatioCalc[];
}

let diagrams: DiagramConfig[] = [];
const listeners: Array<() => void> = [];

export function listDiagrams(): DiagramConfig[] {
  return diagrams;
}

export function onDiagramsChange(cb: () => void): void {
  listeners.push(cb);
}

/** The diagrams changed (added, removed, edited): redrawn, and the project marked changed. */
export function diagramsChanged(): void {
  for (const cb of listeners) cb();
  appState.markDirty();
}

export function newDiagram(): DiagramConfig {
  const d: DiagramConfig = {
    id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    title: `Diagram ${diagrams.length + 1}`,
    series: [],
    from: { kind: 'start' },
    to: { kind: 'end' },
    ratios: [],
  };
  diagrams.push(d);
  diagramsChanged();
  return d;
}

export function removeDiagram(id: string): void {
  diagrams = diagrams.filter((d) => d.id !== id);
  diagramsChanged();
}

function validEvent(e: unknown): e is DiagramEvent {
  if (typeof e !== 'object' || e === null) return false;
  const k = (e as { kind?: unknown }).kind;
  if (k === 'start' || k === 'end') return true;
  if (k === 'time') return typeof (e as { t?: unknown }).t === 'number';
  if (k === 'signal') {
    const s = e as { name?: unknown; edge?: unknown; n?: unknown };
    return (
      typeof s.name === 'string' && (s.edge === 'on' || s.edge === 'off') && typeof s.n === 'number'
    );
  }
  return false;
}

function validRef(r: unknown): r is SeriesRef {
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof (r as SeriesRef).compId === 'number' &&
    typeof (r as SeriesRef).key === 'string'
  );
}

/** The project's diagrams for its file - component ids as they are now, which is how the file
 * refers to its components. */
export function serializeDiagrams(): DiagramConfig[] | undefined {
  return diagrams.length ? JSON.parse(JSON.stringify(diagrams)) : undefined;
}

/** A loaded project's diagrams, its component ids renumbered as the components got new ones
 * (`idMap`: file id -> new id); references to components that aren't there are dropped. */
export function restoreDiagrams(data: unknown, idMap: Map<number, number>): void {
  const out: DiagramConfig[] = [];
  if (Array.isArray(data)) {
    for (const raw of data) {
      if (typeof raw !== 'object' || raw === null) continue;
      const d = raw as Partial<DiagramConfig>;
      const map = (r: unknown): SeriesRef | null => {
        if (!validRef(r)) return null;
        const id = idMap.get(r.compId);
        return id === undefined ? null : { compId: id, key: r.key };
      };
      const series = (Array.isArray(d.series) ? d.series : [])
        .map(map)
        .filter((r): r is SeriesRef => r !== null);
      const ratios: RatioCalc[] = [];
      for (const rc of Array.isArray(d.ratios) ? d.ratios : []) {
        const num = map(rc?.num);
        const den = map(rc?.den);
        if (!num || !den) continue;
        const measure: RatioMeasure =
          rc.measure === 'mean' || rc.measure === 'max' ? rc.measure : 'integral';
        ratios.push({
          label: typeof rc.label === 'string' ? rc.label : 'Ratio',
          num,
          den,
          measure,
        });
      }
      out.push({
        id: typeof d.id === 'string' ? d.id : `g${out.length}`,
        title: typeof d.title === 'string' ? d.title : `Diagram ${out.length + 1}`,
        series,
        from: validEvent(d.from) ? d.from : { kind: 'start' },
        to: validEvent(d.to) ? d.to : { kind: 'end' },
        ratios,
      });
    }
  }
  diagrams = out;
  for (const cb of listeners) cb();
}
