import { describe, expect, it } from 'vitest';
import type { Component, Connection } from '../core/types';
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
import { createSource } from '../components/source';
import { createAndValve } from '../components/andValve';
import { createOrValve } from '../components/orValve';
import { createCheckValve } from '../components/checkValve';
import { createValve52 } from '../components/valve52';
import { createValve52Mono } from '../components/valve52Mono';
import { createOneWayFlowControlValve } from '../components/oneWayFlowControlValve';
import { createCylinderDouble } from '../components/cylinderDouble';
import { BASE_CYL_SPEED } from './constants';

let version = 0;
function nextVersion(): number {
  return ++version;
}

function compLayer(): HTMLElement {
  return document.createElement('div');
}

function flowVisualCtx(graph: FrameGraph, componentId: number) {
  return {
    isPressurized: (p: string) => graph.pressurized.has(portKey(componentId, p)),
    isExhausting: (p: string) => graph.exhausting.has(portKey(componentId, p)),
    exhaustDistance: (p: string) => graph.exhaustDepth.get(portKey(componentId, p)) ?? Infinity,
    sourceDistance: (p: string) => sourceDistance(graph, portKey(componentId, p)),
    supplyDistance: (p: string) => graph.supplyDepth.get(portKey(componentId, p)) ?? Infinity,
  };
}

function wire(fromId: number, fromPort: string, toId: number, toPort: string): Connection {
  return {
    id: 0,
    from: { id: fromId, port: fromPort },
    to: { id: toId, port: toPort },
    guides: [],
    stubStartLen: null,
    stubEndLen: null,
    pathEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    hitEl: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    labelEl: document.createElementNS('http://www.w3.org/2000/svg', 'text'),
  };
}

describe('computeFrameGraph', () => {
  it('propagates pressure from a source through wires', () => {
    const source = createSource(compLayer(), 0, 0);
    const target: Component = createSource(compLayer(), 0, 0);
    const connections = [wire(source.id, 'OUT', target.id, 'OUT')];

    const graph = computeFrameGraph([source, target], connections, nextVersion());

    expect(graph.pressurized.has(portKey(source.id, 'OUT'))).toBe(true);
    expect(graph.pressurized.has(portKey(target.id, 'OUT'))).toBe(true);
  });

  it('AND valve only conducts when both inputs are pressurized', () => {
    const sourceA = createSource(compLayer(), 0, 0);
    const sourceB = createSource(compLayer(), 0, 0);
    const and = createAndValve(compLayer(), 0, 0);
    const connections = [
      wire(sourceA.id, 'OUT', and.id, 'A'),
      wire(sourceB.id, 'OUT', and.id, 'B'),
    ];

    const graph = computeFrameGraph([sourceA, sourceB, and], connections, nextVersion());
    expect(graph.pressurized.has(portKey(and.id, 'OUT'))).toBe(true);
  });

  it('AND valve does not conduct with only one input pressurized', () => {
    const sourceA = createSource(compLayer(), 0, 0);
    const and = createAndValve(compLayer(), 0, 0);
    const connections = [wire(sourceA.id, 'OUT', and.id, 'A')];

    const graph = computeFrameGraph([sourceA, and], connections, nextVersion());
    expect(graph.pressurized.has(portKey(and.id, 'OUT'))).toBe(false);
  });

  it('OR valve conducts with either input pressurized', () => {
    const sourceA = createSource(compLayer(), 0, 0);
    const or = createOrValve(compLayer(), 0, 0);
    const connections = [wire(sourceA.id, 'OUT', or.id, 'A')];

    const graph = computeFrameGraph([sourceA, or], connections, nextVersion());
    expect(graph.pressurized.has(portKey(or.id, 'OUT'))).toBe(true);
  });

  it('check valve blocks backward flow', () => {
    const source = createSource(compLayer(), 0, 0);
    const check = createCheckValve(compLayer(), 0, 0);
    // wire the source to the check valve's OUT (i.e. pressurizing from the "wrong" side)
    const connections = [wire(source.id, 'OUT', check.id, 'OUT')];

    const graph = computeFrameGraph([source, check], connections, nextVersion());
    expect(graph.pressurized.has(portKey(check.id, 'IN'))).toBe(false);
  });

  it('check valve allows forward flow', () => {
    const source = createSource(compLayer(), 0, 0);
    const check = createCheckValve(compLayer(), 0, 0);
    const connections = [wire(source.id, 'OUT', check.id, 'IN')];

    const graph = computeFrameGraph([source, check], connections, nextVersion());
    expect(graph.pressurized.has(portKey(check.id, 'OUT'))).toBe(true);
  });

  it('flowMultiplierToNearestSource finds the source through a check valve, not just wires', () => {
    // Regression test: a check valve's edge is genuinely one-directional (`directed: true`, no
    // reverse entry in `adjacency` at all, unlike the one-way flow control valve's undirected
    // pair). Walking "backward" from a port downstream of it used to only ever look at that
    // port's own outgoing edges, which for a one-directional edge never includes the one leading
    // back to the source - so a cylinder driven through a check valve read a pressurized supply
    // port yet always computed a 0 speed multiplier and never actually moved.
    const source = createSource(compLayer(), 0, 0);
    const check = createCheckValve(compLayer(), 0, 0);
    const connections = [wire(source.id, 'OUT', check.id, 'IN')];

    const graph = computeFrameGraph([source, check], connections, nextVersion());
    expect(flowMultiplierToNearestSource(graph, portKey(check.id, 'OUT'))).toBeCloseTo(1);
  });

  it('valve52 toggles which ports connect after a pilot rising edge', () => {
    const valve = createValve52(compLayer(), 0, 0);

    // Defaults to state 1 (1<->2, 4<->5) when freshly placed.
    const before = valve.conductivityRule({ isPressurized: () => false });
    expect(before).toEqual(expect.arrayContaining([expect.objectContaining({ a: '1', b: '2' })]));

    valve.onPressureChange?.({ isPressurized: (p) => p === '14' });

    const after = valve.conductivityRule({ isPressurized: () => false });
    expect(after).toEqual(expect.arrayContaining([expect.objectContaining({ a: '1', b: '4' })]));
  });

  it('valve52 ignores a simultaneous rising edge on both pilots (ambiguous command)', () => {
    const valve = createValve52(compLayer(), 0, 0);
    const before = valve.conductivityRule({ isPressurized: () => false });

    valve.onPressureChange?.({ isPressurized: () => true });

    const after = valve.conductivityRule({ isPressurized: () => false });
    expect(after).toEqual(before);
  });

  it('valve52 ignores a pilot rising edge while the other pilot is already held on', () => {
    const valve = createValve52(compLayer(), 0, 0);

    // Hold pilot 12 on for a tick first (matches the default state, so this alone is a no-op).
    valve.onPressureChange?.({ isPressurized: (p) => p === '12' });
    const afterFirstPilot = valve.conductivityRule({ isPressurized: () => false });

    // Now 14 also rises while 12 is still held - this must NOT move the valve, even though 14
    // itself is a fresh rising edge (only its simultaneous-rise guard would have missed this).
    valve.onPressureChange?.({ isPressurized: () => true });
    const afterBothHeld = valve.conductivityRule({ isPressurized: () => false });
    expect(afterBothHeld).toEqual(afterFirstPilot);

    // And the reverse order: hold 14 first, then bring 12 up while 14 is still held.
    const valve2 = createValve52(compLayer(), 0, 0);
    valve2.onPressureChange?.({ isPressurized: (p) => p === '14' });
    const afterFirstPilot2 = valve2.conductivityRule({ isPressurized: () => false });

    valve2.onPressureChange?.({ isPressurized: () => true });
    const afterBothHeld2 = valve2.conductivityRule({ isPressurized: () => false });
    expect(afterBothHeld2).toEqual(afterFirstPilot2);
  });

  it('valve52 obeys the remaining pilot once the other one is removed', () => {
    const valve = createValve52(compLayer(), 0, 0);

    // Hold 12 (matches the default state 1), then bring 14 up too - blocked, stays at state 1.
    valve.onPressureChange?.({ isPressurized: (p) => p === '12' });
    valve.onPressureChange?.({ isPressurized: () => true });
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual(
      expect.arrayContaining([expect.objectContaining({ a: '1', b: '2' })]),
    );

    // Now 14 drops out while 12 is still held - 12 should immediately win now that the
    // ambiguity is gone, even though 12 itself never had a fresh rising edge here.
    valve.onPressureChange?.({ isPressurized: (p) => p === '12' });
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual(
      expect.arrayContaining([expect.objectContaining({ a: '1', b: '2' })]),
    );

    // Symmetric case: get the valve into state 0 via 14, hold both, then drop 12 - 14 should
    // win and flip the valve even though it never got a fresh rising edge of its own either.
    const valve2 = createValve52(compLayer(), 0, 0);
    valve2.onPressureChange?.({ isPressurized: (p) => p === '14' });
    valve2.onPressureChange?.({ isPressurized: () => true });
    expect(valve2.conductivityRule({ isPressurized: () => false })).toEqual(
      expect.arrayContaining([expect.objectContaining({ a: '1', b: '4' })]),
    );

    valve2.onPressureChange?.({ isPressurized: (p) => p === '14' });
    expect(valve2.conductivityRule({ isPressurized: () => false })).toEqual(
      expect.arrayContaining([expect.objectContaining({ a: '1', b: '4' })]),
    );
  });

  it("valve52Mono is spring-return: position always follows the single pilot's current level", () => {
    const valve = createValve52Mono(compLayer(), 0, 0);

    // Default (unpowered) rest position matches the bistable valve's own default: 1<->2, 4<->5.
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual(
      expect.arrayContaining([expect.objectContaining({ a: '1', b: '2' })]),
    );

    // Pilot 14 pressurized -> shifts immediately, no rising-edge needed.
    valve.onPressureChange?.({ isPressurized: () => true });
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual(
      expect.arrayContaining([expect.objectContaining({ a: '1', b: '4' })]),
    );

    // Pilot released -> the spring pulls it straight back, the same tick, no held state.
    valve.onPressureChange?.({ isPressurized: () => false });
    expect(valve.conductivityRule({ isPressurized: () => false })).toEqual(
      expect.arrayContaining([expect.objectContaining({ a: '1', b: '2' })]),
    );
  });

  it('one-way flow control valve only throttles the OUT->IN direction, not IN->OUT too', () => {
    const sourceOnIn = createSource(compLayer(), 0, 0);
    const valve = createOneWayFlowControlValve(compLayer(), 0, 0);
    const forwardConnections = [wire(sourceOnIn.id, 'OUT', valve.id, 'IN')];

    const forwardGraph = computeFrameGraph([sourceOnIn, valve], forwardConnections, nextVersion());
    expect(flowMultiplierToNearestSource(forwardGraph, portKey(valve.id, 'OUT'))).toBeCloseTo(1);

    const sourceOnOut = createSource(compLayer(), 0, 0);
    const reverseConnections = [wire(sourceOnOut.id, 'OUT', valve.id, 'OUT')];

    const reverseGraph = computeFrameGraph([sourceOnOut, valve], reverseConnections, nextVersion());
    expect(flowMultiplierToNearestSource(reverseGraph, portKey(valve.id, 'IN'))).toBeCloseTo(0.5);
  });

  it('flowMultiplierToOpenExhaust is unrestricted for a port with nothing wired to it', () => {
    const cyl = createCylinderDouble(compLayer(), 0, 0);
    const graph = computeFrameGraph([cyl], [], nextVersion());
    expect(flowMultiplierToOpenExhaust(graph, portKey(cyl.id, 'B'))).toBe(1);
  });

  it('flowMultiplierToOpenExhaust picks up a one-way flow control valve throttling the exhaust', () => {
    const cyl = createCylinderDouble(compLayer(), 0, 0);
    const flowValve = createOneWayFlowControlValve(compLayer(), 0, 0);
    // Cylinder's exhaust wired to the flow control valve's OUT side, its IN side left open (a
    // stand-in for "leads on out to atmosphere") - free IN->OUT into the cylinder, throttled
    // OUT->IN on the way back out, the standard "meter-out" placement for speed control.
    const connections = [wire(cyl.id, 'B', flowValve.id, 'OUT')];
    const graph = computeFrameGraph([cyl, flowValve], connections, nextVersion());
    expect(flowMultiplierToOpenExhaust(graph, portKey(cyl.id, 'B'))).toBeCloseTo(0.5);
  });

  it('a throttle in front of one cylinder does not slow another cylinder sharing the same exhaust line', () => {
    // One valve port feeding two cylinders, the second one metered in through its own one-way
    // flow control valve (free flow back out of cylinder 2, throttled on the way in). Cylinder
    // 1's exhaust walk reaches cylinder 2's chamber through that throttle in its throttled
    // direction - but a cylinder chamber is a closed volume, not a way out to atmosphere, so it
    // must not count as an (extra-restrictive) exhaust route for cylinder 1.
    const cyl1 = createCylinderDouble(compLayer(), 0, 0);
    const cyl2 = createCylinderDouble(compLayer(), 0, 0);
    const meterIn = createOneWayFlowControlValve(compLayer(), 0, 0);
    // Stand-in for the valve's open exhaust port: free flow IN -> OUT, OUT left open.
    const vent = createOneWayFlowControlValve(compLayer(), 0, 0);
    const connections = [
      wire(cyl1.id, 'B', vent.id, 'IN'),
      wire(cyl1.id, 'B', meterIn.id, 'OUT'),
      wire(meterIn.id, 'IN', cyl2.id, 'B'),
    ];
    const graph = computeFrameGraph([cyl1, cyl2, meterIn, vent], connections, nextVersion());

    expect(flowMultiplierToOpenExhaust(graph, portKey(cyl1.id, 'B'))).toBe(1);
    // Cylinder 2 exhausts back out through the check valve, unthrottled.
    expect(flowMultiplierToOpenExhaust(graph, portKey(cyl2.id, 'B'))).toBe(1);
  });

  it('a throttled exhaust slows the cylinder down, not just a throttled supply', () => {
    // Regression test: cylinder speed used to only ever look at flowMultiplierToNearestSource on
    // the driving port, so a flow control valve wired to meter the exhaust (the way these are
    // actually used in practice) had no effect on speed at all.
    const source = createSource(compLayer(), 0, 0);
    const cyl = createCylinderDouble(compLayer(), 0, 0);
    const flowValve = createOneWayFlowControlValve(compLayer(), 0, 0);
    const connections = [
      wire(source.id, 'OUT', cyl.id, 'A'),
      wire(cyl.id, 'B', flowValve.id, 'OUT'),
    ];
    const graph = computeFrameGraph([source, cyl, flowValve], connections, nextVersion());

    const ctx = {
      dt: 0.1,
      isPressurized: (p: string) => graph.pressurized.has(portKey(cyl.id, p)),
      flowMultiplierToNearestSource: (p: string) =>
        flowMultiplierToNearestSource(graph, portKey(cyl.id, p)),
      flowMultiplierToOpenExhaust: (p: string) =>
        flowMultiplierToOpenExhaust(graph, portKey(cyl.id, p)),
      pressureAt: (p: string) => pressureAt(graph, portKey(cyl.id, p)),
      emitSignal: () => {},
      readSignal: () => false,
    };

    cyl.step?.(0.1, ctx);
    const throttledPos = (cyl.snapshot() as { pos: number }).pos;

    expect(throttledPos).toBeCloseTo(BASE_CYL_SPEED * 0.5 * 0.1);
    // Sanity check against the untouched, unthrottled rate - the throttle must have actually
    // done something, not coincidentally matched the free-flow distance.
    expect(throttledPos).toBeLessThan(BASE_CYL_SPEED * 0.1);
  });

  it('markExhaustFlow marks every port air passes through on its way to atmosphere', () => {
    const cyl = createCylinderDouble(compLayer(), 0, 0);
    const flowValve = createOneWayFlowControlValve(compLayer(), 0, 0);
    const connections = [wire(cyl.id, 'B', flowValve.id, 'OUT')];
    const graph = computeFrameGraph([cyl, flowValve], connections, nextVersion());

    markExhaustFlow(graph, [portKey(cyl.id, 'B')]);

    expect(graph.exhausting.has(portKey(cyl.id, 'B'))).toBe(true);
    expect(graph.exhausting.has(portKey(flowValve.id, 'OUT'))).toBe(true);
    expect(graph.exhausting.has(portKey(flowValve.id, 'IN'))).toBe(true);
    // A port on some unrelated, unwired component must not light up too.
    const bystander = createSource(compLayer(), 0, 0);
    const graph2 = computeFrameGraph([cyl, flowValve, bystander], connections, nextVersion());
    markExhaustFlow(graph2, [portKey(cyl.id, 'B')]);
    expect(graph2.exhausting.has(portKey(bystander.id, 'OUT'))).toBe(false);

    // Called again with no venting ports (e.g. the cylinder just reached its target and stopped)
    // must clear out anything left over from a previous frame.
    markExhaustFlow(graph, []);
    expect(graph.exhausting.size).toBe(0);
  });

  describe('one-way flow control valve flow visual', () => {
    /** source -> valve `supplyPort`, valve's other port -> cylinder A, then marks this frame's
     * flow: cylinder A filling (`filling`) and/or cylinder B venting through the valve
     * (`venting`, B wired to the valve's other port instead of A). */
    function run(opts: {
      supplyPort?: 'IN' | 'OUT';
      exhaustPort?: 'IN' | 'OUT';
      filling?: boolean;
    }) {
      const cyl = createCylinderDouble(compLayer(), 0, 0);
      const valve = createOneWayFlowControlValve(compLayer(), 0, 0);
      const comps: Component[] = [cyl, valve];
      const connections: Connection[] = [];
      if (opts.supplyPort) {
        const source = createSource(compLayer(), 0, 0);
        comps.push(source);
        const other = opts.supplyPort === 'IN' ? 'OUT' : 'IN';
        connections.push(wire(source.id, 'OUT', valve.id, opts.supplyPort));
        connections.push(wire(valve.id, other, cyl.id, 'A'));
      }
      if (opts.exhaustPort) connections.push(wire(cyl.id, 'B', valve.id, opts.exhaustPort));

      const graph = computeFrameGraph(comps, connections, nextVersion());
      markExhaustFlow(graph, opts.exhaustPort ? [portKey(cyl.id, 'B')] : []);
      markSupplyFlow(graph, opts.filling ? [portKey(cyl.id, 'A')] : []);
      valve.updateFlowVisual?.(flowVisualCtx(graph, valve.id));
      return valve;
    }

    it('supply streaming IN -> OUT: ball lifted, check valve path in the pressure colour', () => {
      const valve = run({ supplyPort: 'IN', filling: true });
      expect(owfvPathFlow(valve, 'check')).toBe('supply');
      expect(owfvPathFlow(valve, 'throttle')).toBe(null);
      expect(ballLifted(valve)).toBe(true);
    });

    it('cylinder at its end position: nothing flows, ball closed, only the open throttle path shows the pressure', () => {
      const valve = run({ supplyPort: 'IN', filling: false });
      expect(owfvPathFlow(valve, 'check')).toBe(null);
      expect(owfvPathFlow(valve, 'throttle')).toBe('supply');
      expect(ballLifted(valve)).toBe(false);
    });

    it('no pressure and no flow: nothing lit, ball closed', () => {
      const valve = run({});
      expect(owfvPathFlow(valve, 'check')).toBe(null);
      expect(owfvPathFlow(valve, 'throttle')).toBe(null);
      expect(ballLifted(valve)).toBe(false);
    });

    it('supply streaming OUT -> IN (meter-in): throttle path in the pressure colour, ball closed', () => {
      const valve = run({ supplyPort: 'OUT', filling: true });
      expect(owfvPathFlow(valve, 'throttle')).toBe('supply');
      expect(owfvPathFlow(valve, 'check')).toBe(null);
      expect(ballLifted(valve)).toBe(false);
    });

    it('exhaust returning OUT -> IN (meter-out): throttle path in the exhaust colour, ball closed', () => {
      // OUT is one hop from the venting cylinder port, IN two, so air enters at OUT.
      const valve = run({ exhaustPort: 'OUT' });
      expect(owfvPathFlow(valve, 'throttle')).toBe('exhaust');
      expect(owfvPathFlow(valve, 'check')).toBe(null);
      expect(ballLifted(valve)).toBe(false);
    });

    it('exhaust returning IN -> OUT: ball lifted, check valve path in the exhaust colour', () => {
      const valve = run({ exhaustPort: 'IN' });
      expect(owfvPathFlow(valve, 'check')).toBe('exhaust');
      expect(owfvPathFlow(valve, 'throttle')).toBe(null);
      expect(ballLifted(valve)).toBe(true);
    });
  });
});

/** Which kind of air the one-way flow control valve's 'check' or 'throttle' path is lit for:
 * 'supply' (pressure colour), 'exhaust' (exhaust colour), or null when it isn't lit at all. */
function owfvPathFlow(
  valve: { el: HTMLElement },
  path: 'check' | 'throttle',
): 'supply' | 'exhaust' | null {
  const segs = Array.from(valve.el.querySelectorAll(`[data-path="${path}"]`));
  if (segs.some((el) => el.classList.contains('owfvFlowPath--exhausting'))) return 'exhaust';
  if (segs.some((el) => el.classList.contains('owfvFlowPath--pressurized'))) return 'supply';
  return null;
}

function ballLifted(valve: { el: HTMLElement }): boolean {
  return valve.el.querySelector('.flowThrottleCircle')?.classList.contains('flowing') ?? false;
}
