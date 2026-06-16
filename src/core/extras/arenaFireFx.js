import * as THREE from './three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const ARENA_FIRE_SRC = 'asset://animated_fire.glb'

const BARRIZER_IDS = ['barrizer', 'barrizer_2']
const FIRE_Y_OFFSET = 0.75

const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _scale = new THREE.Vector3()

export async function addArenaFireFx(world, arenaRoot) {
  if (world.network?.isServer) return

  const url = world.resolveURL(ARENA_FIRE_SRC)
  if (url.startsWith('asset://')) {
    console.error('[Arena] fire fx url not resolved')
    return
  }

  let buffer
  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`status ${resp.status}`)
    buffer = await resp.arrayBuffer()
  } catch (err) {
    console.error('[Arena] failed to load fire fx:', err)
    return
  }

  let gltf
  try {
    gltf = await new GLTFLoader().parseAsync(buffer)
  } catch (err) {
    console.error('[Arena] failed to parse fire fx:', err)
    return
  }

  const clip = gltf.animations[0]
  if (!clip) {
    console.warn('[Arena] fire fx has no animations')
  }

  arenaRoot.updateTransform()
  world._arenaFireMeshes = world._arenaFireMeshes || []
  world._arenaFireMixers = world._arenaFireMixers || []

  for (const id of BARRIZER_IDS) {
    const anchor = arenaRoot.get(id)
    if (!anchor) {
      console.warn('[Arena] barrizer not found:', id)
      continue
    }

    anchor.updateTransform()
    anchor.matrixWorld.decompose(_pos, _quat, _scale)

    const fire = gltf.scene.clone(true)
    fire.position.copy(_pos)
    fire.position.y += FIRE_Y_OFFSET
    fire.quaternion.copy(_quat)

    fire.traverse(obj => {
      if (!obj.isMesh) return
      obj.castShadow = false
      obj.receiveShadow = false
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const material of materials) {
        if (!material) continue
        material.side = THREE.DoubleSide
        material.transparent = true
        material.depthWrite = false
      }
    })

    world.stage.scene.add(fire)
    world._arenaFireMeshes.push(fire)

    if (clip) {
      const mixer = new THREE.AnimationMixer(fire)
      mixer.clipAction(clip).play()
      world._arenaFireMixers.push(mixer)
    }
  }
}

export function updateArenaFireFx(world, delta) {
  const mixers = world._arenaFireMixers
  if (!mixers?.length) return
  for (const mixer of mixers) {
    mixer.update(delta)
  }
}

export function clearArenaFireFx(world) {
  if (world._arenaFireMeshes?.length) {
    for (const fire of world._arenaFireMeshes) {
      world.stage?.scene?.remove(fire)
    }
  }
  world._arenaFireMeshes = null
  world._arenaFireMixers = null
}
