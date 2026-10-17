/** Length in world px of the straight stub every wire grows out of its endpoint before turning. */
export const WIRE_STUB = 14;

/** Pressure (bar) emitted by a pressure source's port when the sim is running. */
export const SOURCE_PRESSURE = 6.0;

/** Cylinder piston travel speed, in position-units (0..1) per second, before flow throttling. */
export const BASE_CYL_SPEED = 0.8;

/** Per-frame delta-time clamp (seconds), so a slow/backgrounded tab doesn't jump the sim ahead. */
export const MAX_DT = 0.05;

/** Screen-px radius within which a port gets a hover highlight while linking a wire. */
export const PORT_HOVER_RADIUS = 16;
