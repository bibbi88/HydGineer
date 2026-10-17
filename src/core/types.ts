export type ComponentId = number;
export type PortKey = string;

export interface PortDef {
  key: PortKey;
  cx: number;
  cy: number;
  el: SVGCircleElement;
  entryOrientation: 'H' | 'V';
  isPilot?: boolean;
  pilotDir?: 1 | -1;
  /** An electrical terminal rather than a pneumatic port - only ever wired to other electrical
   * terminals (see interaction/linking.ts), and solved by sim/electrical.ts instead of the
   * pressure graph. */
  electrical?: boolean;
}

/** How a component takes part in the electrical circuit solved by sim/electrical.ts. */
export interface ElectricalBehavior {
  /** A supply rail: every port named `port` is held at +24 V ('plus') or 0 V ('zero'). */
  role?: { kind: 'plus' | 'zero'; port: PortKey };
  /** Currently-closed contacts: each pair of ports is a wire while it's listed. */
  closedEdges?(): PortConnection[];
  /** A load (relay/solenoid coil, lamp) between two terminals: energized when one is live and
   * the other is connected to 0 V. A non-empty `key` is published on the signal bus while
   * energized, which is how contacts and solenoid valves bound to that key react. */
  load?: { a: PortKey; b: PortKey; key: string };
  setEnergized?(energized: boolean): void;
  /** Terminals currently driven to +24 V by the component itself (a PLC's active outputs). */
  sources?(): PortKey[];
  /** Runs the component's own logic against the solved circuit (a PLC scan): given which
   * terminals are connected to +24 V / 0 V, updates its outputs and returns whether any changed
   * (so the solver knows to settle again). */
  scan?(
    dt: number,
    isLive: (port: PortKey) => boolean,
    isGround: (port: PortKey) => boolean,
  ): boolean;
}

export interface PortConnection {
  a: PortKey;
  b: PortKey;
  directed?: boolean;
}

export interface ConductivityContext {
  isPressurized(port: PortKey): boolean;
}

export interface SimStepContext {
  dt: number;
  isPressurized(port: PortKey): boolean;
  flowMultiplierToNearestSource(port: PortKey): number;
  /** Companion to `flowMultiplierToNearestSource` for the port on the opposite (venting) side -
   * how restricted the path out to open atmosphere is, so a flow control valve throttling a
   * cylinder's exhaust actually slows it down instead of only supply-side throttling counting. */
  flowMultiplierToOpenExhaust(port: PortKey): number;
  /** Pressure (bar) actually available at `port` this frame: the supply pressure, less any
   * reduction imposed by a pressure-reducing valve between it and the supply. 0 when the port
   * isn't pressurized at all. What a cylinder computes its force from. */
  pressureAt(port: PortKey): number;
  emitSignal(key: string, value: boolean): void;
  readSignal(key: string): boolean;
}

export interface FlowVisualContext {
  isPressurized(port: PortKey): boolean;
  /** Whether `port` is currently carrying live exhaust flow (see `markExhaustFlow` in
   * sim/pressure.ts) - only known after every component's step() has already run this frame
   * (a cylinder doesn't report what it's venting until then), which is why this is its own
   * hook rather than something `step()`/`SimStepContext` can offer directly. Ports on either
   * side of a component whose own edge is undirected (conducts both ways, e.g. a one-way flow
   * control valve's IN<->OUT) always share the same `isPressurized` value regardless of which
   * side actually has a source behind it - and, less obviously, also always share the same
   * `isExhausting` value (the flood-fill that computes it walks the same undirected edge just
   * as indiscriminately) - so neither boolean alone can tell such a pair of ports apart. Use
   * `exhaustDistance`/`sourceDistance` for that. */
  isExhausting(port: PortKey): boolean;
  /** Hop-count from `port` to the nearest actively-venting port, over the same graph
   * `isExhausting` floods - Infinity if `port` isn't part of any exhaust path right now.
   * Comparing this between a component's own two ports (which always share one `isExhausting`
   * boolean when the edge between them is undirected) says which one is actually closer to
   * the open vent, i.e. which way air is really leaving through this component. */
  exhaustDistance(port: PortKey): number;
  /** Hop-count from `port` to the nearest currently-pressurized source - Infinity if none is
   * reachable. The supply-side companion to `exhaustDistance`, for telling apart two ports
   * that likewise always share one `isPressurized` boolean. */
  sourceDistance(port: PortKey): number;
  /** Hop-count from `port` to the nearest port actively drawing supply air (see
   * `Component.currentlyFilling`), walking back toward the supply over pressurized ports only -
   * Infinity if no supply air is streaming through `port` right now. The supply-flow companion
   * to `exhaustDistance`: air moves from the higher count toward the lower one. */
  supplyDistance(port: PortKey): number;
}

export interface ComponentBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ContextMenuAction {
  label: string;
  onClick: () => void;
}

export interface Component<TSnapshot = Record<string, unknown>> {
  readonly id: ComponentId;
  readonly type: string;
  el: HTMLElement;
  x: number;
  y: number;
  svgW: number;
  svgH: number;
  gx: number;
  gy: number;
  ports: Record<PortKey, PortDef>;
  electrical?: ElectricalBehavior;

  conductivityRule(ctx: ConductivityContext): PortConnection[];
  flowMultiplier?(fromPort: PortKey, toPort: PortKey): number;
  /** Ceiling, in bar, this component imposes on air crossing from `fromPort` to `toPort` - a
   * pressure-reducing valve's set pressure. null (or omitted) means it imposes none, which is
   * what every other component does. Direction matters: a regulator only reduces downstream, so
   * it caps IN -> OUT and leaves OUT -> IN alone. See sim/pressure.ts, which propagates the
   * resulting pressure outward from the supply. */
  pressureLimit?(fromPort: PortKey, toPort: PortKey): number | null;
  /** Ports that inject pressure into the system (e.g. a pressure source's outlet). */
  sourcePorts?(): PortKey[];
  /** Ports this component is actively venting air out through as of the most recent step() -
   * e.g. a cylinder's currently-retracting chamber. Purely a visualization hook (drives the
   * exhaust flow animation on wires); has no effect on the pressure/conductivity simulation
   * itself. Empty (or omitted) when nothing is currently moving/exhausting. */
  currentlyVenting?(): PortKey[];
  /** The supply-side counterpart of `currentlyVenting`: ports this component is actively drawing
   * supply air in through as of the most recent step() - e.g. a cylinder's currently-driven
   * chamber while the piston is still moving. Once the piston reaches its end position the air
   * stops flowing (the line stays pressurized, but nothing streams through it any more), so
   * this goes empty. Purely a visualization hook, like `currentlyVenting`. */
  currentlyFilling?(): PortKey[];

  snapshot(): TSnapshot;
  restore(data: TSnapshot): void;
  reset(): void;

  setPos(x: number, y: number): void;
  getBounds(): ComponentBounds;
  setSelected(sel: boolean): void;
  destroy?(): void;
  /** Reassigns a fresh distinguishing label (e.g. a cylinder's letter) - called after pasting a
   * copy so it doesn't keep the exact identity (and signal names) of the component it was
   * copied from. Components without a meaningful identity to reassign can omit this. */
  relabel?(): void;
  /** Renames this component's user-facing identifying label (e.g. a cylinder's letter) to
   * `newValue`, cascading to anything derived from the old one (sensor labels, other
   * components bound to them). Returns whether `newValue` was valid and applied - an invalid
   * value leaves everything unchanged. Drives the inspector's rename field. */
  renameLabel?(newValue: string): boolean;
  /** Switches a single-acting cylinder between push/pull, immediately snapping its piston to
   * that mode's own default rest position (rather than animating there on the next simulation
   * step) since this is a configuration change, not a live simulation event. Drives the
   * inspector's mode field - not part of the generic snapshot()/restore() round trip because a
   * loaded project's saved position must NOT be overridden by this same "reset to default"
   * logic. */
  setCylinderMode?(mode: 'push' | 'pull'): void;
  /** Extra type-specific entries spliced into this component's right-click menu, alongside the
   * generic rotate/delete every component gets. */
  contextMenuItems?(): ContextMenuAction[];

  recompute?(): void;
  onPressureChange?(ctx: ConductivityContext): void;
  step?(dt: number, ctx: SimStepContext): void;
  /** Purely cosmetic per-frame update (e.g. highlighting which internal path currently has air
   * moving through it) that needs `FlowVisualContext.isExhausting` - called once per frame,
   * after every component's step() and after exhaust flow has been computed, so never a place
   * to put anything that affects the simulation itself. */
  updateFlowVisual?(ctx: FlowVisualContext): void;
}

export interface ConnectionEndpoint {
  id: ComponentId;
  port: PortKey;
}

export interface WireGuide {
  type: 'H' | 'V';
  pos: number;
}

export interface Connection {
  id: ComponentId;
  from: ConnectionEndpoint;
  to: ConnectionEndpoint;
  guides: WireGuide[];
  stubStartLen: number | null;
  stubEndLen: number | null;
  dashed?: boolean;
  pathEl: SVGPathElement;
  /** Wider, invisible path stacked on top of pathEl so clicking/right-clicking the wire is easier. */
  hitEl: SVGPathElement;
  labelEl: SVGTextElement;
}
