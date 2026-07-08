import * as THREE from './three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const ARENA_CROWD_SRC = 'asset://crowd0.glb'

const SIT_CLAP_CLIP = 'Sitting_Clap'
const CHEER_CLIP = 'Cheer_with_Both_Hands'

const CROWD_COUNT = 5
// Spectators spawn at radius 16 / +6m — crowd sits 3m closer in and 3m lower.
const CROWD_RADIUS = 13
const CROWD_Y_OFFSET = 3
const CROWD_SCALE = 1
const CHEER_DURATION_MS = 5000
const FADE_SECONDS = 0.35

const _center = new THREE.Vector3()
const _pos = new THREE.Vector3()

function getCrowdPlacements(arenaRoot) {
  arenaRoot.updateTransform()
  _center.setFromMatrixPosition(arenaRoot.matrixWorld)

  const placements = []
  for (let i = 0; i < CROWD_COUNT; i++) {
    const angle = (i / CROWD_COUNT) * Math.PI * 2
    _pos.set(
      _center.x + Math.cos(angle) * CROWD_RADIUS,
      _center.y + CROWD_Y_OFFSET,
      _center.z + Math.sin(angle) * CROWD_RADIUS
    )
    placements.push({
      position: _pos.clone(),
      rotationY: Math.atan2(_center.x - _pos.x, _center.z - _pos.z),
    })
  }
  return placements
}

export async function addArenaCrowd(world, arenaRoot) {
  if (world.network?.isServer) return

  const url = world.resolveURL(ARENA_CROWD_SRC)
  if (url.startsWith('asset://')) {
    console.error('[Arena] crowd url not resolved')
    return
  }

  let buffer
  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`status ${resp.status}`)
    buffer = await resp.arrayBuffer()
  } catch (err) {
    console.error('[Arena] failed to load crowd:', err)
    return
  }

  let gltf
  try {
    gltf = await new GLTFLoader().parseAsync(buffer)
  } catch (err) {
    console.error('[Arena] failed to parse crowd:', err)
    return
  }

  const sitClip = gltf.animations.find(a => a.name === SIT_CLAP_CLIP)
  const cheerClip = gltf.animations.find(a => a.name === CHEER_CLIP)
  if (!sitClip) console.warn('[Arena] crowd has no sitting clap animation')

  const members = []
  const placements = getCrowdPlacements(arenaRoot)

  world._arenaFireMeshes = world._arenaFireMeshes || []
  world._arenaFireMixers = world._arenaFireMixers || []

  for (let i = 0; i < placements.length; i++) {
    const { position, rotationY } = placements[i]
    const npc = SkeletonUtils.clone(gltf.scene)
    npc.position.copy(position)
    npc.rotation.y = rotationY
    npc.scale.setScalar(CROWD_SCALE)

    npc.traverse(obj => {
      if (obj.isSkinnedMesh) {
        obj.frustumCulled = false
        obj.castShadow = true
        obj.receiveShadow = true
      }
    })

    world.stage.scene.add(npc)
    world._arenaFireMeshes.push(npc)

    const mixer = new THREE.AnimationMixer(npc)
    world._arenaFireMixers.push(mixer)

    let sit = null
    let cheer = null
    if (sitClip) {
      sit = mixer.clipAction(sitClip)
      sit.setLoop(THREE.LoopRepeat)
      sit.play()
      // stagger clap phase so members aren't perfectly in sync
      sit.time = (i * 0.37) % sitClip.duration
    }
    if (cheerClip) {
      cheer = mixer.clipAction(cheerClip)
      cheer.setLoop(THREE.LoopRepeat)
    }

    members.push({ sit, cheer })
  }

  let cheerTimer = null
  const startCheer = () => {
    if (!cheerClip) return
    if (!cheerTimer) {
      for (const m of members) {
        if (!m.cheer) continue
        m.cheer.reset().fadeIn(FADE_SECONDS).play()
        m.sit?.fadeOut(FADE_SECONDS)
      }
    } else {
      clearTimeout(cheerTimer)
    }
    cheerTimer = setTimeout(() => {
      cheerTimer = null
      for (const m of members) {
        if (!m.sit) continue
        m.sit.reset().fadeIn(FADE_SECONDS).play()
        m.cheer?.fadeOut(FADE_SECONDS)
      }
    }, CHEER_DURATION_MS)
  }

  world.on('arenaDeath', startCheer)
  world._arenaCrowdCleanup = () => {
    world.off('arenaDeath', startCheer)
    if (cheerTimer) clearTimeout(cheerTimer)
    cheerTimer = null
  }
}

export function clearArenaCrowd(world) {
  world?._arenaCrowdCleanup?.()
  if (world) world._arenaCrowdCleanup = null
}
