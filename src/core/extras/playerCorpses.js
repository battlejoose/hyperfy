import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'

import * as THREE from './three'
import { Emotes } from './playerEmotes'

const MAX_CORPSES = 50
const corpses = []

function trimCorpses() {
  while (corpses.length >= MAX_CORPSES) {
    const old = corpses.shift()
    old?.destroy()
  }
}

function registerCorpse(corpse) {
  trimCorpses()
  corpses.push(corpse)
}

function trySpawnCorpseFromPlayer(world, playerId) {
  if (!playerId || !world.stage?.scene) return false

  const player = world.entities.get(playerId)
  const instance = player?.avatar?.instance
  const scene = instance?.raw?.scene
  if (!scene) return false

  instance.disableRateCheck?.()
  instance.update(1 / 30)
  scene.updateMatrixWorld(true)

  const clone = SkeletonUtils.clone(scene)
  clone.matrixAutoUpdate = false
  clone.matrixWorldAutoUpdate = false
  clone.matrix.copy(scene.matrixWorld)
  clone.matrixWorld.copy(scene.matrixWorld)

  world.stage.scene.add(clone)

  registerCorpse({
    destroy() {
      world.stage.scene.remove(clone)
      clone.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose()
      })
    },
  })

  return true
}

async function spawnPlayerCorpseFallback(world, { position, quaternion, avatar }) {
  if (!world.stage?.scene || !world.loader) return

  const avatarUrl = avatar || 'asset://avatar.vrm'
  let src
  try {
    src = await world.loader.load('avatar', avatarUrl)
  } catch (err) {
    console.error('[Corpse] failed to load avatar:', err)
    return
  }

  if (!src?.factory) return

  try {
    await Promise.all([
      world.loader.load('emote', Emotes.DEATH_FALL),
      world.loader.load('emote', Emotes.DEAD),
    ])
  } catch (err) {
    console.error('[Corpse] failed to preload death emotes:', err)
  }

  const pos = new THREE.Vector3().fromArray(position)
  const quat = new THREE.Quaternion().fromArray(quaternion)
  const matrix = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1))

  const hooks = {
    scene: world.stage.scene,
    octree: null,
    camera: world.camera,
  }

  const instance = src.factory.create(matrix, hooks, null)
  instance.disableRateCheck?.()
  instance.setDeathState(true)
  instance.setEmote(Emotes.DEATH_FALL, 1.5)

  for (let i = 0; i < 120; i++) {
    instance.update(1 / 60)
  }

  instance.setEmote(null, undefined, { immediate: true })

  for (let i = 0; i < 60; i++) {
    instance.update(1 / 60)
  }

  registerCorpse(instance)
}

export function spawnPlayerCorpse(world, { playerId, position, quaternion, avatar }) {
  if (trySpawnCorpseFromPlayer(world, playerId)) return
  spawnPlayerCorpseFallback(world, { position, quaternion, avatar })
}

export function clearPlayerCorpses() {
  for (const corpse of corpses) {
    corpse.destroy()
  }
  corpses.length = 0
}
