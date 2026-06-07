/**
 * Extra right-hand rotation applied on top of combat GLB animations (runtime only).
 * Does not modify source .glb files — tune here and reload the client.
 *
 * Keys match pose names in createVRMFactory (attackLow, attackRight, blockLeft, kick, …).
 * Angles are degrees in the VRM rightHand bone's local space (same axes we used when patching GLBs):
 *   x — pitch forward (extend wrist / sword outward)
 *   y — yaw (left/right)
 *   z — roll (twist)
 *
 * Omit a pose or set all axes to 0 for no adjustment.
 */
export const CombatHandOffsets = {
  attackLeft: null,
  attackRight: null,
  attackHigh: null,
  attackLow: { x: 0, y: 0, z: -45 },
  block: null,
  blockLeft: null,
  blockRight: null,
  blockHigh: null,
  blockLow: null,
  kick: null,
}
