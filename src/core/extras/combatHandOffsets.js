/**
 * Extra right-hand rotation baked into combat GLB clips at load time (in memory only).
 * Does not modify source .glb files — tune here and reload the client.
 *
 * Passed to createEmoteFactory.toClip() via addPose clipOptions in createVRMFactory.
 * Keys match pose names (attackLow, attackRight, blockLeft, kick, …).
 * Angles are degrees in the rightHand bone's local space:
 *   x — pitch forward (extend wrist / sword outward)
 *   y — yaw (left/right)
 *   z — roll (twist)
 *
 * Omit a pose or set null for no adjustment.
 */
export const CombatHandOffsets = {
  attackLeft: null,
  attackRight: null,
  attackHigh: null,
  attackLow: { x: 30, y: 0, z: -45 },
  block: null,
  blockLeft: null,
  blockRight: null,
  blockHigh: null,
  blockLow: null,
  kick: null,
}
