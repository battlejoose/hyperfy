import * as THREE from './three'
import { createNode } from './createNode'

export const ATTACK_GRUNT_SRC = 'asset://attackgrunt.mp3'

const GRUNT_HALF_DURATION = 1
const GRUNT_BACKSWING_OFFSET = 0
const GRUNT_SWING_OFFSET = 1
const GRUNT_BASE_VOLUME = 0.55
const GRUNT_BACKSWING_VOLUME = GRUNT_BASE_VOLUME * 1.2
const GRUNT_SWING_VOLUME = GRUNT_BASE_VOLUME * 0.8

const v1 = new THREE.Vector3()

function getGruntPosition(player) {
  v1.copy(player.base.position)
  v1.y += 1.4
  return v1
}

function playAttackGruntSegment(world, player, offset, volume) {
  if (!world.audio || !player?.base) return

  const audio = createNode('audio', {
    src: ATTACK_GRUNT_SRC,
    volume,
    loop: false,
    group: 'sfx',
    spatial: true,
    refDistance: 1,
    maxDistance: 25,
    rolloffFactor: 2,
  })

  audio.position.copy(getGruntPosition(player))
  audio.currentTime = offset
  audio.activate({ world, entity: player })
  audio.play()

  setTimeout(() => {
    if (audio.isPlaying) audio.stop()
    if (audio.active) audio.deactivate()
  }, GRUNT_HALF_DURATION * 1000)
}

export function playAttackBackswingGrunt(world, player) {
  playAttackGruntSegment(world, player, GRUNT_BACKSWING_OFFSET, GRUNT_BACKSWING_VOLUME)
}

export function playAttackSwingGrunt(world, player) {
  playAttackGruntSegment(world, player, GRUNT_SWING_OFFSET, GRUNT_SWING_VOLUME)
}
