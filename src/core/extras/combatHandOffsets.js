/**
 * Vertical hips offset (meters) while combat poses play (attack, block, kick).
 * Applied at runtime after the animation mixer — not baked into clips, so the
 * value is exact (combat clips use 5x blend weight which over-amplifies baked offsets).
 * Negative = lower, positive = raise. Save this file to tune; no rejoin needed.
 */
export const COMBAT_POSITION_Y_OFFSET = -0.02

/**
 * Extra right-hand rotation baked into combat GLB clips at load time (in memory only).
 * Angles are degrees in the rightHand bone's local space:
 *   x — pitch forward (extend wrist / sword outward)
 *   y — yaw (left/right)
 *   z — roll (twist)
 */
export const CombatHandOffsets = {
  attackLeft: null,
  attackRight: null,
  attackHigh: null,
  attackLow: { x: 30, y: 0, z: -60 },
  block: null,
  blockLeft: null,
  blockRight: null,
  blockHigh: null,
  blockLow: null,
  kick: null,
}
