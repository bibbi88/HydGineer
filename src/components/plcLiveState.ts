import type { Component } from '../core/types';
import type { PlcGraph } from '../sim/plcGraph';
import type { FbState } from '../sim/plcProgram';

/** What a running PLC is doing right now - read by the live monitor (ui/plcMonitor.ts). */
export interface PlcLiveState {
  name: string;
  /** null for a program saved before the graphical editor, which only exists as text. */
  graph: PlcGraph | null;
  programText: string;
  /** L+ and M both connected - without them the PLC isn't scanning at all. */
  powered: boolean;
  inputs: Map<string, boolean>;
  outputs: Map<string, boolean>;
  fb: Map<string, FbState>;
}

// Kept apart from plc.ts so the monitor can read a PLC without importing the component (which
// itself imports the monitor, to open it on double-click while simulating).
const registry = new WeakMap<Component, () => PlcLiveState>();

export function registerPlcLiveState(comp: Component, read: () => PlcLiveState): void {
  registry.set(comp, read);
}

export function getPlcLiveState(comp: Component): PlcLiveState | null {
  return registry.get(comp)?.() ?? null;
}

export function isPlc(comp: Component): boolean {
  return registry.has(comp);
}
