import * as THREE from './three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { getBarrizerMidpointWorld } from './arenaGeneral.js'

export const ARENA_CROWD_SRC = 'asset://crowd0.glb'

// Ambient clips each member cycles through randomly while idle.
const AMBIENT_CLIPS = ['Sitting_Clap', 'Sit_Cheer_with_Left_Hand', 'Stand_Cheer_and_Sit_Down']
// Death-cheer clips — each member randomly picks one when someone dies.
const DEATH_CHEER_CLIPS = ['Cheer_with_Both_Hands', 'Cheer_with_Both_Hands_1']

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

  const ambientClips = AMBIENT_CLIPS.map(name => gltf.animations.find(a => a.name === name)).filter(Boolean)
  const cheerClips = DEATH_CHEER_CLIPS.map(name => gltf.animations.find(a => a.name === name)).filter(Boolean)
  if (!ambientClips.length) console.warn('[Arena] crowd has no ambient animations')

  const pickRandom = (list, exclude) => {
    if (list.length <= 1) return list[0]
    let item
    do {
      item = list[Math.floor(Math.random() * list.length)]
    } while (item === exclude)
    return item
  }

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

    const member = {
      mixer,
      // actions are created once per clip and reused
      ambient: ambientClips.map(clip => {
        const action = mixer.clipAction(clip)
        action.setLoop(THREE.LoopOnce)
        action.clampWhenFinished = true
        return action
      }),
      cheer: cheerClips.map(clip => {
        const action = mixer.clipAction(clip)
        action.setLoop(THREE.LoopRepeat)
        return action
      }),
      current: null,
      cheering: false,
    }

    const playAmbient = (fade = FADE_SECONDS) => {
      if (!member.ambient.length) return
      const next = pickRandom(member.ambient, member.current)
      next.reset().fadeIn(fade).play()
      member.current?.fadeOut(fade)
      member.current = next
    }

    // when an ambient clip finishes, move to another random one
    mixer.addEventListener('finished', e => {
      if (member.cheering) return
      if (!member.ambient.includes(e.action)) return
      playAmbient()
    })

    // start each member on a random clip at a random point so nothing is in sync
    if (member.ambient.length) {
      const first = member.ambient[Math.floor(Math.random() * member.ambient.length)]
      first.play()
      first.time = Math.random() * first.getClip().duration * 0.8
      member.current = first
    }

    member.playAmbient = playAmbient
    members.push(member)
  }

  let cheerTimer = null
  const startCheer = () => {
    if (!cheerClips.length) return
    if (!cheerTimer) {
      for (const m of members) {
        if (!m.cheer.length) continue
        m.cheering = true
        const cheer = m.cheer[Math.floor(Math.random() * m.cheer.length)]
        cheer.reset().fadeIn(FADE_SECONDS).play()
        m.current?.fadeOut(FADE_SECONDS)
        m.current = cheer
      }
    } else {
      clearTimeout(cheerTimer)
    }
    cheerTimer = setTimeout(() => {
      cheerTimer = null
      for (const m of members) {
        m.cheering = false
        m.playAmbient?.()
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
