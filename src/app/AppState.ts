import { onRemoved, runRemoved } from './componentLifetime';
import type { Component, ComponentId, Connection } from '../core/types';
import { Modes, type Mode } from './modes';

class AppState {
  components: Component[] = [];
  connections: Connection[] = [];
  selectedComponents = new Set<ComponentId>();
  selectedConnectionId: ComponentId | null = null;
  mode: Mode = Modes.STOP;
  /** Title-block metadata - shown/edited in the inspector's "Project info" section (see
   * ui/inspector.ts) and round-tripped through the project file (see persistence/project.ts)
   * alongside the project name itself, which lives in ui/projectBar.ts instead since it's also
   * shown in the sidebar. */
  projectAuthor = '';
  projectCheckedBy = '';
  projectCompany = '';
  /** ISO yyyy-mm-dd, or '' - whatever an `<input type="date">` gives back. */
  projectDate = '';
  /** The optional print-sheet guide (see ui/pageFrame.ts and persistence/schema.ts's PageFrame
   * doc) - 'none' draws nothing. x/y are its world-space center, meaningless while size is
   * 'none'. */
  pageFrameSize: 'none' | 'a4' | 'a3' = 'none';
  pageFrameX = 0;
  pageFrameY = 0;
  /** A random per-browser ID (see app/deviceId.ts) - null until the project's first save, then
   * frozen from then on regardless of which browser saves it later (see persistence/project.ts's
   * own serializeProject doc for exactly where that "only ever set once" happens). Not shown
   * anywhere in the app's own UI - just carried in the saved file itself (plain JSON, so still
   * readable by anyone who opens it). */
  projectOriginDeviceId: string | null = null;
  /** Same idea, but for the *most recent* save - overwritten every time (see serializeProject).
   * Comparing this to the origin id above is a weak trace for flagging a redistributed file, not
   * real access control. */
  projectLastSavedDeviceId: string | null = null;
  /** Unix time, s, the project was created - null for a fresh one not yet stamped (see
   * serializeProject), 'unknown' for one saved before the field existed. */
  projectCreatedAt: number | null | 'unknown' = null;
  /** Unix time, s, the project was last saved to a file - null until then. */
  projectLastSavedAt: number | null = null;
  /** Bumped whenever components/connections are added or removed, so cached graphs know to rebuild. */
  /** Draw a small jump (half-circle) where a wire crosses another it isn't connected to - a
   * per-project drawing choice, saved with it. */
  lineJumps = true;
  topologyVersion = 0;

  private changeListeners: Array<() => void> = [];
  private modeListeners: Array<() => void> = [];
  private suppressed = false;

  /** Notified whenever setMode() runs (Play/Pause/Stop). With `owner` (a component's element),
   * the subscription ends when that component is removed (see componentLifetime.ts). */
  onModeChange(cb: () => void, owner?: object): void {
    this.modeListeners.push(cb);
    if (owner) onRemoved(owner, () => this.modeListeners.splice(this.modeListeners.indexOf(cb), 1));
  }

  /** Notified whenever the project's topology changes (add/remove component or wire). With
   * `owner`, the subscription ends when that component is removed. */
  onChange(cb: () => void, owner?: object): void {
    this.changeListeners.push(cb);
    if (owner) {
      onRemoved(owner, () => this.changeListeners.splice(this.changeListeners.indexOf(cb), 1));
    }
  }

  /**
   * Runs `fn` without firing onChange for each individual mutation inside it, then fires
   * exactly one notification afterward. Used by project load/undo/redo, which each make many
   * low-level component/connection mutations that should look like a single change to
   * subscribers (autosave, history) rather than one notification per mutation.
   */
  runSuppressed(fn: () => void): void {
    this.suppressed = true;
    try {
      fn();
    } finally {
      this.suppressed = false;
    }
    this.notifyChange();
  }

  private notifyChange(): void {
    if (this.suppressed) return;
    // A copy: a listener may remove a component, and so other listeners, while this runs.
    for (const cb of [...this.changeListeners]) cb();
  }

  addComponent(c: Component): void {
    this.components.push(c);
    this.topologyVersion++;
    this.notifyChange();
  }

  removeComponent(id: ComponentId): void {
    const c = this.components.find((c) => c.id === id);
    c?.el.remove();
    c?.destroy?.();
    if (c) runRemoved(c.el);
    this.components = this.components.filter((c) => c.id !== id);
    this.selectedComponents.delete(id);
    this.topologyVersion++;
    this.notifyChange();
  }

  findComponent(id: ComponentId): Component | undefined {
    return this.components.find((c) => c.id === id);
  }

  addConnection(c: Connection): void {
    this.connections.push(c);
    this.topologyVersion++;
    this.notifyChange();
  }

  removeConnection(id: ComponentId): void {
    this.connections = this.connections.filter((c) => c.id !== id);
    if (this.selectedConnectionId === id) this.selectedConnectionId = null;
    this.topologyVersion++;
    this.notifyChange();
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    for (const cb of [...this.modeListeners]) cb();
  }

  /** For edits that change the project (e.g. dragging a wire bend) without adding/removing a
   * component or connection - so autosave/history still pick them up, without bumping
   * topologyVersion (no cached graph needs to rebuild for a cosmetic reroute). */
  markDirty(): void {
    this.notifyChange();
  }
}

export const appState = new AppState();
