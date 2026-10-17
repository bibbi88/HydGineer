import { appState } from '../app/AppState';
import { portKey, pressureAt, type FrameGraph } from './pressure';
import { isElectricallyLive } from './electrical';

export function applyToDom(graph: FrameGraph): void {
  for (const c of appState.components) {
    for (const port of Object.values(c.ports)) {
      const key = portKey(c.id, port.key);
      const active = graph.pressurized.has(key);
      port.el.classList.toggle('pressurized', active);
      // The pressure actually at this port, which a regulator upstream will have reduced.
      port.el.setAttribute(
        'title',
        `${port.key}: ${active ? pressureAt(graph, key).toFixed(1) : '0.0'} bar`,
      );
    }
  }

  for (const conn of appState.connections) {
    const fromKey = portKey(conn.from.id, conn.from.port);
    const toKey = portKey(conn.to.id, conn.to.port);

    conn.pathEl.classList.toggle('live', isElectricallyLive(fromKey) && isElectricallyLive(toKey));

    const active = graph.pressurized.has(fromKey) && graph.pressurized.has(toKey);
    conn.pathEl.classList.toggle('active', active);
    // Both ends of a wire are the same node pneumatically, but the two can differ for one frame
    // while a change propagates - show the higher, so a freshly pressurized line doesn't
    // momentarily read as regulated when it isn't.
    const wirePressure = Math.max(pressureAt(graph, fromKey), pressureAt(graph, toKey));
    conn.labelEl.textContent = active ? `${wirePressure.toFixed(1)} bar` : '';

    const exhausting = graph.exhausting.has(fromKey) && graph.exhausting.has(toKey);
    conn.pathEl.classList.toggle('exhausting', exhausting);
    // The path is always drawn from `conn.from` to `conn.to` - flip the flow animation when air
    // is actually travelling the other way, so it always reads as moving out toward atmosphere
    // rather than (sometimes, depending on which end happened to get wired as "from") backward.
    const fromDepth = graph.exhaustDepth.get(fromKey) ?? 0;
    const toDepth = graph.exhaustDepth.get(toKey) ?? 0;
    conn.pathEl.classList.toggle('exhausting-reverse', exhausting && fromDepth > toDepth);
  }
}
