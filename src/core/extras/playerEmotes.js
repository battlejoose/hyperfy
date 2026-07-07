export const Emotes = {
  IDLE: 'asset://mp-idle.glb',
  WALK: 'asset://mp-walk.glb?s=1.5',
  WALK_LEFT: 'asset://mp-walk-left.glb?s=1.5',
  WALK_RIGHT: 'asset://mp-walk-right.glb?s=1.5',
  WALK_BACK: 'asset://mp-walk-back.glb?s=1.5',
  RUN: 'asset://mp-jog.glb?s=1.4',
  RUN_LEFT: 'asset://mp-jog-left.glb?s=1.4',
  RUN_RIGHT: 'asset://mp-jog-right.glb?s=1.4',
  RUN_BACK: 'asset://mp-jog-back.glb?s=1.4',
  JUMP: 'asset://emote-jump.glb',
  FALL: 'asset://emote-fall.glb',
  FLY: 'asset://emote-float.glb',
  FLIP: 'asset://emote-flip.glb?s=1.1',
  TALK: 'asset://emote-talk.glb',
  ATTACK_LEFT: 'asset://attackleft.glb',
  ATTACK_RIGHT: 'asset://attackright.glb',
  ATTACK_HIGH: 'asset://attackhigh.glb',
  ATTACK_LOW: 'asset://attacklow.glb',
  BLOCK: 'asset://blockhigh.glb',
  BLOCK_LEFT: 'asset://blockleft.glb',
  BLOCK_RIGHT: 'asset://blockright.glb',
  BLOCK_HIGH: 'asset://blockhigh.glb',
  BLOCK_LOW: 'asset://blocklow.glb',
  KICK: 'asset://kick.glb',
  DEATH_FALL: 'asset://fall.glb',
  DEAD: 'asset://dead.glb',
  GETUP: 'asset://getup.glb',
}

// Kick clip is ~2.8s; first 0.5s is windup and skipped in playback
export const KickTiming = {
  trimStart: 0.5,
  duration: 2.3,
  colliderDelay: 0.7,
  colliderDuration: 0.5,
  blockCooldownAfterBreak: 1,
}

export const AttackTiming = {
  cooldownAfterBlock: 1,
  cooldownAfterHit: 0.5,
  /** Seconds trimmed from the tail of attack clips before returning to locomotion */
  recoveryTrim: 0.5,
}

/** Wall-clock swing end from attack start (includes windup). */
export function getAttackSwingEndTime(windupTime, totalDuration = 1.0) {
  return Math.max(windupTime + 0.05, totalDuration - AttackTiming.recoveryTrim)
}

/** Active swing phase after a charged release (elapsed resets to 0). */
export function getAttackSwingPhaseDuration(totalDuration = 1.0) {
  return Math.max(0.05, totalDuration - AttackTiming.recoveryTrim)
}

export const SprintTiming = {
  cooldownAfterCombat: 5,
}

export const JumpTiming = {
  cooldown: 3,
}

export const emoteUrls = [
  Emotes.IDLE,
  Emotes.WALK,
  Emotes.WALK_LEFT,
  Emotes.WALK_RIGHT,
  Emotes.WALK_BACK,
  Emotes.RUN,
  Emotes.RUN_LEFT,
  Emotes.RUN_RIGHT,
  Emotes.RUN_BACK,
  Emotes.JUMP,
  Emotes.FALL,
  Emotes.FLY,
  Emotes.FLIP,
  Emotes.TALK,
  Emotes.ATTACK_LEFT,
  Emotes.ATTACK_RIGHT,
  Emotes.ATTACK_HIGH,
  Emotes.ATTACK_LOW,
  Emotes.BLOCK_LEFT,
  Emotes.BLOCK_RIGHT,
  Emotes.BLOCK_HIGH,
  Emotes.BLOCK_LOW,
  Emotes.KICK,
  Emotes.DEATH_FALL,
  Emotes.DEAD,
  Emotes.GETUP,
]
