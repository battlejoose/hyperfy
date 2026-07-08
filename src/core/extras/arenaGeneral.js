import * as THREE from './three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BARRIZER_IDS } from './arenaFireFx.js'

export const ARENA_GENERAL_SRC = 'asset://general.glb'
const IDLE_CLIP_NAME = 'Idle_11'
const GENERAL_Y_OFFSET = 3.2
const GENERAL_SCALE = 1.4

const _mid = new THREE.Vector3()
const _center = new THREE.Vector3()

export function getBarrizerMidpointWorld(arenaRoot) {
  const a = arenaRoot.get(BARRIZER_IDS[0])
  const b = arenaRoot.get(BARRIZER_IDS[1])
  if (!a || !b) return null

  arenaRoot.updateTransform()
  _mid.set(
    (a.position.x + b.position.x) * 0.5,
    0,
    (a.position.z + b.position.z) * 0.5
  )
  _mid.applyMatrix4(arenaRoot.matrixWorld)
  _mid.y += GENERAL_Y_OFFSET
  return _mid
}

function faceArenaCenter(object, position, arenaRoot) {
  arenaRoot.updateTransform()
  _center.setFromMatrixPosition(arenaRoot.matrixWorld)
  _center.y = position.y

  object.position.copy(position)
  object.rotation.y = Math.atan2(_center.x - position.x, _center.z - position.z)
  object.scale.setScalar(GENERAL_SCALE)
}

export async function addArenaGeneral(world, arenaRoot) {
  if (world.network?.isServer) return

  const url = world.resolveURL(ARENA_GENERAL_SRC)
  if (url.startsWith('asset://')) {
    console.error('[Arena] general url not resolved')
    return
  }

  const midpoint = getBarrizerMidpointWorld(arenaRoot)
  if (!midpoint) {
    console.warn('[Arena] could not place general — barrizers not found')
    return
  }

  let buffer
  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`status ${resp.status}`)
    buffer = await resp.arrayBuffer()
  } catch (err) {
    console.error('[Arena] failed to load general:', err)
    return
  }

  let gltf
  try {
    gltf = await new GLTFLoader().parseAsync(buffer)
  } catch (err) {
    console.error('[Arena] failed to parse general:', err)
    return
  }

  const clip =
    gltf.animations.find(a => a.name === IDLE_CLIP_NAME) ||
    gltf.animations.find(a => /idle/i.test(a.name))
  if (!clip) {
    console.warn('[Arena] general has no idle animation')
  }

  const general = SkeletonUtils.clone(gltf.scene)
  faceArenaCenter(general, midpoint, arenaRoot)

  general.traverse(obj => {
    if (obj.isSkinnedMesh) {
      obj.frustumCulled = false
      obj.castShadow = true
      obj.receiveShadow = true
    }
  })

  world.stage.scene.add(general)
  world._arenaFireMeshes = world._arenaFireMeshes || []
  world._arenaFireMeshes.push(general)

  if (clip) {
    const mixer = new THREE.AnimationMixer(general)
    const action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopRepeat)
    action.reset().play()
    world._arenaFireMixers = world._arenaFireMixers || []
    world._arenaFireMixers.push(mixer)
  }
}
