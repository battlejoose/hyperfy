import * as THREE from './three'
import { Emotes } from './playerEmotes'

const MAX_CORPSES = 50
const corpses = []

export async function spawnPlayerCorpse(world, { position, quaternion, avatar }) {
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

  const pos = new THREE.Vector3().fromArray(position)
  const quat = new THREE.Quaternion().fromArray(quaternion)
  const matrix = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1))

  const hooks = {
    scene: world.stage.scene,
    octree: null,
    camera: world.camera,
  }

  const instance = src.factory.create(matrix, hooks, null)
  instance.setDeathState(true)
  instance.setLocomotion(0, new THREE.Vector3(), new THREE.Vector3(0, 0, -1))

  for (let i = 0; i < 30; i++) {
    instance.update(1 / 60)
  }

  while (corpses.length >= MAX_CORPSES) {
    const old = corpses.shift()
    old?.destroy()
  }

  corpses.push(instance)
}

export function clearPlayerCorpses() {
  for (const corpse of corpses) {
    corpse.destroy()
  }
  corpses.length = 0
}
