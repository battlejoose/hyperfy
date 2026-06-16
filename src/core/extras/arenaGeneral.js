import * as THREE from './three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BARRIZER_IDS } from './arenaFireFx.js'

export const ARENA_GENERAL_SRC = 'asset://general.glb'
const IDLE_CLIP_NAME = 'Idle_11'

const _pos1 = new THREE.Vector3()
const _pos2 = new THREE.Vector3()
const _mid = new THREE.Vector3()
const _center = new THREE.Vector3()

function getBarrizerMidpoint(arenaRoot) {
  const a = arenaRoot.get(BARRIZER_IDS[0])
  const b = arenaRoot.get(BARRIZER_IDS[1])
  if (!a || !b) return null

  a.updateTransform()
  b.updateTransform()
  a.getWorldPosition(_pos1)
  b.getWorldPosition(_pos2)
  _mid.addVectors(_pos1, _pos2).multiplyScalar(0.5)
  _mid.y = 0
  return _mid
}

function faceArenaCenter(object, position) {
  _center.set(0, position.y, 0)
  object.position.copy(position)
  object.lookAt(_center)
  object.rotateY(Math.PI)
}

export async function addArenaGeneral(world, arenaRoot) {
  if (world.network?.isServer) return

  const url = world.resolveURL(ARENA_GENERAL_SRC)
  if (url.startsWith('asset://')) {
    console.error('[Arena] general url not resolved')
    return
  }

  const midpoint = getBarrizerMidpoint(arenaRoot)
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

  const general = gltf.scene.clone(true)
  faceArenaCenter(general, midpoint)

  general.traverse(obj => {
    if (!obj.isMesh) return
    obj.castShadow = true
    obj.receiveShadow = true
  })

  world.stage.scene.add(general)
  world._arenaFireMeshes = world._arenaFireMeshes || []
  world._arenaFireMeshes.push(general)

  if (clip) {
    const mixer = new THREE.AnimationMixer(general)
    const action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopRepeat)
    action.play()
    world._arenaFireMixers = world._arenaFireMixers || []
    world._arenaFireMixers.push(mixer)
  }
}
