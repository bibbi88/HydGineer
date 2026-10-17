import type { ConductivityContext, FlowVisualContext, SimStepContext } from '../core/types';
import { appState } from '../app/AppState';
import {
  computeFrameGraph,
  flowMultiplierToNearestSource,
  flowMultiplierToOpenExhaust,
  markExhaustFlow,
  markSupplyFlow,
  portKey,
  pressureAt,
  sourceDistance,
  type FrameGraph,
} from './pressure';
import { getSignal, setSignal } from './signals';
import { solveElectrical } from './electrical';

export function stepSimulation(dt: number): FrameGraph {
  // First, so solenoid valves/contacts see this frame's coil states when pneumatics is computed.
  solveElectrical(dt);

  for (const c of appState.components) c.recompute?.();

  let graph = computeFrameGraph(
    appState.components,
    appState.connections,
    appState.topologyVersion,
  );

  let anyEdgeTriggered = false;
  for (const c of appState.components) {
    if (!c.onPressureChange) continue;
    anyEdgeTriggered = true;
    const ctx: ConductivityContext = {
      isPressurized: (p) => graph.pressurized.has(portKey(c.id, p)),
    };
    c.onPressureChange(ctx);
  }

  // An edge-triggered component (e.g. a double-pilot 5/2 valve) may have just flipped its own
  // internal state based on the graph above and already updated its visual position - recompute
  // once more so the graph actually returned (what render.ts colors ports/wires from, and what
  // step() hooks like cylinder motion see) reflects that new state immediately, instead of
  // lagging one whole frame behind the position that's already on screen.
  if (anyEdgeTriggered) {
    graph = computeFrameGraph(appState.components, appState.connections, appState.topologyVersion);
  }

  for (const c of appState.components) {
    if (!c.step) continue;
    const ctx: SimStepContext = {
      dt,
      isPressurized: (p) => graph.pressurized.has(portKey(c.id, p)),
      flowMultiplierToNearestSource: (p) => flowMultiplierToNearestSource(graph, portKey(c.id, p)),
      flowMultiplierToOpenExhaust: (p) => flowMultiplierToOpenExhaust(graph, portKey(c.id, p)),
      pressureAt: (p) => pressureAt(graph, portKey(c.id, p)),
      emitSignal: setSignal,
      readSignal: getSignal,
    };
    c.step(dt, ctx);
  }

  // Venting state (e.g. which chamber a cylinder is currently exhausting through) is only known
  // now that every step() has run - collect it and flood it over the same adjacency graph used
  // for pressure, purely so render.ts can animate the wires actually carrying exhaust flow.
  const ventingKeys: string[] = [];
  for (const c of appState.components) {
    for (const p of c.currentlyVenting?.() ?? []) ventingKeys.push(portKey(c.id, p));
  }
  markExhaustFlow(graph, ventingKeys);

  // Same for supply air actually streaming in (a cylinder still moving), as opposed to a line
  // that is merely pressurized - lets e.g. a check valve close again once the piston stops.
  const fillingKeys: string[] = [];
  for (const c of appState.components) {
    for (const p of c.currentlyFilling?.() ?? []) fillingKeys.push(portKey(c.id, p));
  }
  markSupplyFlow(graph, fillingKeys);

  // Only now that markExhaustFlow has run does anything have a reliable answer to "is this port
  // exhausting" - a separate, purely-cosmetic pass so a component's step() (which runs before
  // it's known) never has to fall back on `isPressurized` alone for that.
  for (const c of appState.components) {
    if (!c.updateFlowVisual) continue;
    const ctx: FlowVisualContext = {
      isPressurized: (p) => graph.pressurized.has(portKey(c.id, p)),
      isExhausting: (p) => graph.exhausting.has(portKey(c.id, p)),
      exhaustDistance: (p) => graph.exhaustDepth.get(portKey(c.id, p)) ?? Infinity,
      sourceDistance: (p) => sourceDistance(graph, portKey(c.id, p)),
      supplyDistance: (p) => graph.supplyDepth.get(portKey(c.id, p)) ?? Infinity,
    };
    c.updateFlowVisual(ctx);
  }

  return graph;
}
