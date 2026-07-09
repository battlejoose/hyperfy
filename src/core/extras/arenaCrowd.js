import * as THREE from './three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createNode } from './createNode'
import { getBarrizerMidpointWorld } from './arenaGeneral.js'

export const ARENA_CROWD_SOURCES = [
  'asset://crowd0.glb',
  'asset://crowd1.glb',
  'asset://crowd2.glb',
  'asset://crowd3.glb',
]

// Ambient clips each member cycles through randomly while idle.
const AMBIENT_CLIPS = ['Sitting_Clap', 'Sit_Cheer_with_Left_Hand', 'Stand_Cheer_and_Sit_Down']
// Death-cheer clips — each member randomly picks one when someone dies.
const DEATH_CHEER_CLIPS = ['Cheer_with_Both_Hands', 'Cheer_with_Both_Hands_1']

// Spectators spawn at radius 16 / +6m — front crowd row sits 2.3m closer in and 3m lower.
// Each ring behind is 0.5m further out and 0.45m up. Every ring seats 5 of each model
// (20 seats), but which model occupies which seat is shuffled per ring so no pattern
// repeats. Adjacent rings are offset by half a seat so members face gaps, not each other.
const MEMBERS_PER_MODEL = 5
const CROWD_RINGS = [
  { radius: 13.7, yOffset: 3, stagger: 0 },
  { radius: 14.2, yOffset: 3.45, stagger: 0.025 },
  { radius: 14.7, yOffset: 3.9, stagger: 0.05 },
  { radius: 15.2, yOffset: 4.35, stagger: 0.075 },
]
const CROWD_SCALE = 1
const CHEER_DURATION_MS = 5000
const FADE_SECONDS = 0.35
/** Ambient crowd noise, loops the whole time in the arena. */
const CROWD_YELL_SRC = 'asset://crowdyell.mp3'
const CROWD_YELL_VOLUME = 0.1
/** Only the middle of the yell track loops — the ends fade and don't blend. */
const CROWD_YELL_LOOP_SECONDS = 30
/** One-shot crowd roar when everyone stands up after a death. */
const CROWD_CHEER_SRC = 'asset://crowdcheer.mp3'
const CROWD_CHEER_VOLUME = 1
/** Keep crowd members at least this far (horizontally) from the general and the door. */
const MIN_CLEAR_DISTANCE = 5
/** Random angular jitter per member, as a fraction of the whole arc. Kept small enough
 * that members can never drift into the half-seat offset of neighboring rings. */
const SPACING_JITTER = 0.008
/** Random radial jitter per member (meters). */
const RADIUS_JITTER = 0.15

// Seeded PRNG (mulberry32) — placements look irregular but are identical every load.
function createSeededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

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

// Fisher–Yates shuffle with the seeded rng, keeps layout deterministic.
function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

function getRingAngles(ring, seatCount, generalPos, rng) {
  const angles = []
  if (!generalPos) {
    for (let i = 0; i < seatCount; i++) {
      angles.push((i / seatCount) * Math.PI * 2)
    }
    return angles
  }

  const generalAngle = Math.atan2(generalPos.z - _center.z, generalPos.x - _center.x)
  const doorAngle = generalAngle + Math.PI
  // The arena door sits directly opposite the general on the crowd ring.
  _door.set(
    _center.x + Math.cos(doorAngle) * ring.radius,
    _center.y + ring.yOffset,
    _center.z + Math.sin(doorAngle) * ring.radius
  )
  const generalHalf = getForbiddenHalfAngle(generalPos, generalAngle, ring.radius)
  const doorHalf = getForbiddenHalfAngle(_door, doorAngle, ring.radius)

  // Two clear arcs: general side → door side, and door side → general side.
  const arcA = { start: generalAngle + generalHalf, length: Math.PI - generalHalf - doorHalf }
  const arcB = { start: doorAngle + doorHalf, length: Math.PI - doorHalf - generalHalf }
  const total = arcA.length + arcB.length

  for (let i = 0; i < seatCount; i++) {
    // stagger shifts the ring along the clear arcs (wrapping) so rings interleave;
    // jitter offsets each member within its seat so spacing looks natural
    const jitter = (rng() - 0.5) * SPACING_JITTER
    const t = ((((i + 0.5) / seatCount + ring.stagger + jitter) % 1) + 1) % 1 * total
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

  const rng = createSeededRandom(1337)
  const seatCount = ARENA_CROWD_SOURCES.length * MEMBERS_PER_MODEL

  const placements = []
  for (const ring of CROWD_RINGS) {
    // 5 of each model per ring, but seat order is shuffled so no model pattern repeats
    const seatModels = []
    for (let src = 0; src < ARENA_CROWD_SOURCES.length; src++) {
      for (let n = 0; n < MEMBERS_PER_MODEL; n++) seatModels.push(src)
    }
    shuffle(seatModels, rng)

    const angles = getRingAngles(ring, seatCount, generalPos, rng)
    for (let i = 0; i < angles.length; i++) {
      const radius = ring.radius + (rng() - 0.5) * 2 * RADIUS_JITTER
      _pos.set(
        _center.x + Math.cos(angles[i]) * radius,
        _center.y + ring.yOffset,
        _center.z + Math.sin(angles[i]) * radius
      )
      placements.push({
        src: seatModels[i],
        position: _pos.clone(),
        rotationY: Math.atan2(_center.x - _pos.x, _center.z - _pos.z),
      })
    }
  }
  return placements
}

async function loadCrowdSource(world, src) {
  const url = world.resolveURL(src)
  if (url.startsWith('asset://')) {
    console.error('[Arena] crowd url not resolved:', src)
    return null
  }

  let buffer
  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`status ${resp.status}`)
    buffer = await resp.arrayBuffer()
  } catch (err) {
    console.error('[Arena] failed to load crowd:', src, err)
    return null
  }

  let gltf
  try {
    gltf = await new GLTFLoader().parseAsync(buffer)
  } catch (err) {
    console.error('[Arena] failed to parse crowd:', src, err)
    return null
  }

  const ambientClips = AMBIENT_CLIPS.map(name => gltf.animations.find(a => a.name === name)).filter(Boolean)
  const cheerClips = DEATH_CHEER_CLIPS.map(name => gltf.animations.find(a => a.name === name)).filter(Boolean)
  if (!ambientClips.length) console.warn('[Arena] crowd has no ambient animations:', src)
  return { gltf, ambientClips, cheerClips }
}

export async function addArenaCrowd(world, arenaRoot) {
  if (world.network?.isServer) return

  const sources = await Promise.all(ARENA_CROWD_SOURCES.map(src => loadCrowdSource(world, src)))
  if (!sources.some(Boolean)) return

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
    const { src, position, rotationY } = placements[i]
    const source = sources[src]
    if (!source) continue
    const { gltf, ambientClips, cheerClips } = source
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

  // ambient crowd noise — loops only the middle of the track (the ends fade out
  // and don't blend), so it plays through a raw buffer source with loop points
  let yellSource = null
  let yellGain = null
  if (world.audio) {
    try {
      const audio = world.audio
      let buffer = world.loader.get('audio', CROWD_YELL_SRC)
      if (!buffer) buffer = await world.loader.load('audio', CROWD_YELL_SRC)

      const mid = buffer.duration / 2
      const half = Math.min(CROWD_YELL_LOOP_SECONDS, buffer.duration) / 2
      yellSource = audio.ctx.createBufferSource()
      yellSource.buffer = buffer
      yellSource.loop = true
      yellSource.loopStart = mid - half
      yellSource.loopEnd = mid + half

      yellGain = audio.ctx.createGain()
      yellGain.gain.value = CROWD_YELL_VOLUME
      yellSource.connect(yellGain)
      yellGain.connect(audio.groupGains.sfx)

      const source = yellSource
      audio.ready(() => {
        if (yellSource === source) source.start(0, source.loopStart)
      })
    } catch (err) {
      console.error('[Arena] failed to start crowd yell:', err)
      yellSource = null
      yellGain = null
    }
  }

  const playCheerSound = () => {
    if (!world.audio) return
    const audio = createNode('audio', {
      src: CROWD_CHEER_SRC,
      volume: CROWD_CHEER_VOLUME,
      loop: false,
      group: 'sfx',
      spatial: false,
    })
    audio.activate({ world })
    audio.play()
    setTimeout(() => {
      if (audio.isPlaying) audio.stop()
      if (audio.active) audio.deactivate()
    }, CHEER_DURATION_MS + 5000)
  }

  let cheerTimer = null
  const startCheer = () => {
    if (!members.length) return
    if (!cheerTimer) {
      playCheerSound()
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
    if (yellSource) {
      try {
        yellSource.stop()
      } catch (err) {
        // already stopped
      }
      yellGain?.disconnect()
      yellSource = null
      yellGain = null
    }
  }
}

export function clearArenaCrowd(world) {
  world?._arenaCrowdCleanup?.()
  if (world) world._arenaCrowdCleanup = null
}
