/** Length in world px of the straight stub every wire grows out of its endpoint before turning. */
export const WIRE_STUB = 14;

/** Per-frame delta-time clamp (seconds), so a slow/backgrounded tab doesn't jump the sim ahead. */
export const MAX_DT = 0.05;

/** Screen-px radius within which a port lights up, and a wire being drawn snaps onto it when
 * let go - so the pointer doesn't have to land on the small port circle itself. */
export const PORT_SNAP_RADIUS = 22;
/** Screen-px radius within which pressing starts a wire from a port rather than grabbing the
 * component - smaller than the snap radius, so a press on a valve's body near a port still
 * moves the valve. */
export const PORT_GRAB_RADIUS = 12;
