import * as THREE from './three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { getBarrizerMidpointWorld } from './arenaGeneral.js'

export const ARENA_CROWD_SRC = 'asset://crowd0.glb'

const SIT_CLAP_CLIP = 'Sitting_Clap'
const CHEER_CLIP = 'Cheer_with_Both_Hands'

// Spectators spawn at radius 16 / +6m — front crowd row sits 2.3m closer in and 3m lower.
// Back row is 0.5m further out and 0.5m up, staggered so it doesn't sit directly behind.
const CROWD_ROWS = [
  { count: 5, radius: 13.7, yOffset: 3, stagger: 0 },
  { count: 5, radius: 14.2, yOffset: 3.5, stagger: 0.09 },
]
const CROWD_SCALE = 1
const CHEER_DURATION_MS = 5000
const FADE_SECONDS = 0.35
/** Keep crowd members at least this far (horizontally) from the general and the door. */
const MIN_CLEAR_DISTANCE = 5

const _center = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _door = new THREE.Vector3()

function horizontalDistance(ax, az, b) {
  const dx = ax - b.x
  const dz = az - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

// Half-width (radians) of the arc around `point` where crowd members
// on a ring of `radius` would land within MIN_CLEAR_DISTANCE of it.
function getForbiddenHalfAngle(point, pointAngle, radius) {
  const step = Math.PI / 180
  for (let half = 0; half < Math.PI; half += step) {
    const x = _center.x + Math.cos(pointAngle + half) * radius
    const z = _center.z + Math.sin(pointAngle + half) * radius
    if (horizontalDistance(x, z, point) >= MIN_CLEAR_DISTANCE) return half
  }
  return 0
}

function getRowAngles(row, generalPos) {
  const angles = []
  if (!generalPos) {
    for (let i = 0; i < row.count; i++) {
      angles.push((i / row.count) * Math.PI * 2)
    }
    return angles
  }

  const generalAngle = Math.atan2(generalPos.z - _center.z, generalPos.x - _center.x)
  const doorAngle = generalAngle + Math.PI
  // The arena door sits directly opposite the general on the crowd ring.
  _door.set(
    _center.x + Math.cos(doorAngle) * row.radius,
    _center.y + row.yOffset,
    _center.z + Math.sin(doorAngle) * row.radius
  )
  const generalHalf = getForbiddenHalfAngle(generalPos, generalAngle, row.radius)
  const doorHalf = getForbiddenHalfAngle(_door, doorAngle, row.radius)

  // Two clear arcs: general side → door side, and door side → general side.
  const arcA = { start: generalAngle + generalHalf, length: Math.PI - generalHalf - doorHalf }
  const arcB = { start: doorAngle + doorHalf, length: Math.PI - doorHalf - generalHalf }
  const total = arcA.length + arcB.length

  for (let i = 0; i < row.count; i++) {
    // stagger shifts the row along the clear arcs (wrapping) so rows interleave
    const t = ((((i + 0.5) / row.count + row.stagger) % 1) + 1) % 1 * total
    if (t < arcA.length) {
      angles.push(arcA.start + t)
    } else {
      angles.push(arcB.start + (t - arcA.length))
    }
  }
  return angles
}

function getCrowdPlacements(arenaRoot) {
  arenaRoot.updateTransform()
  _center.setFromMatrixPosition(arenaRoot.matrixWorld)

  const generalPos = getBarrizerMidpointWorld(arenaRoot)?.clone()

  const placements = []
  for (const row of CROWD_ROWS) {
    for (const angle of getRowAngles(row, generalPos)) {
      _pos.set(
        _center.x + Math.cos(angle) * row.radius,
        _center.y + row.yOffset,
        _center.z + Math.sin(angle) * row.radius
      )
      placements.push({
        position: _pos.clone(),
        rotationY: Math.atan2(_center.x - _pos.x, _center.z - _pos.z),
      })
    }
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
