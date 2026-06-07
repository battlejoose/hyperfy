import { createNode } from './createNode'

export const FOOTSTEPS_SRC = 'asset://footsteps.mp3'

export const LocomotionModes = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  JUMP: 3,
  FALL: 4,
  FLY: 5,
  TALK: 6,
}

export function isWalkingMode(mode) {
  return mode === LocomotionModes.WALK || mode === LocomotionModes.RUN
}

export function initFootsteps(base) {
  const audio = createNode('audio', {
    src: FOOTSTEPS_SRC,
    volume: 0.45,
    loop: true,
    group: 'sfx',
    spatial: true,
    refDistance: 1,
    maxDistance: 25,
    rolloffFactor: 2,
  })
  base.add(audio)
  return audio
}

export function updateFootsteps(audio, { mode, isDead, isFlying, hasEffectEmote }) {
  if (!audio || !audio.ctx?.world?.audio) return

  const walking = isWalkingMode(mode) && !isDead && !isFlying && !hasEffectEmote
  if (walking) {
    const rate = mode === LocomotionModes.RUN ? 1.35 : 1
    if (!audio.isPlaying) {
      audio.play()
    }
    if (audio._footstepRate !== rate) {
      audio._footstepRate = rate
      audio.setPlaybackRate(rate)
    }
  } else {
    if (audio.isPlaying) audio.pause()
    audio._footstepRate = null
  }
}
