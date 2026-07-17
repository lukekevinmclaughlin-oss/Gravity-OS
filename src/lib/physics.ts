/**
 * Gravity OS motion model. One law everywhere: UI elements have mass.
 * Light things snap, heavy things settle. All springs are critically-ish
 * damped so nothing wobbles like a toy.
 */

export interface MassSpec {
  mass: number;
  stiffness: number;
  damping: number;
}

export const LIGHT: MassSpec = { mass: 1, stiffness: 320, damping: 26 };
export const MEDIUM: MassSpec = { mass: 1.6, stiffness: 210, damping: 26 };
export const HEAVY: MassSpec = { mass: 2.6, stiffness: 150, damping: 28 };

/** Advance a spring by dt seconds. Returns [position, velocity]. */
export function springStep(
  pos: number,
  vel: number,
  target: number,
  spec: MassSpec,
  dt: number
): [number, number] {
  const force = -spec.stiffness * (pos - target) - spec.damping * vel;
  const accel = force / spec.mass;
  const nextVel = vel + accel * dt;
  const nextPos = pos + nextVel * dt;
  return [nextPos, nextVel];
}

export function isSettled(pos: number, vel: number, target: number, eps = 0.0015): boolean {
  return Math.abs(pos - target) < eps && Math.abs(vel) < eps;
}

/**
 * Gravity-well influence used by Orbit: 1 at the centre of mass,
 * falling off quadratically to 0 at the well radius.
 */
export function gravityWell(distance: number, radius: number): number {
  const d = Math.min(Math.abs(distance), radius) / radius;
  return (1 - d) * (1 - d);
}
