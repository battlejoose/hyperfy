import * as THREE from './three'

/**
 * Combat "juice" — layered impact feedback (hitstop, camera kick/shake/zoom
 * punch, directional sparks) that sells hits without changing the simulation.
 *
 * Layer stack per game-feel research:
 * - Hitstop: 90–200ms near-freeze of attacker+victim at contact (visual only)
 * - Camera kick: spring impulse along the swing direction, per-attack
 * - Camera shake: trauma-based (shake = trauma²), noise-driven, fast decay
 * - Zoom punch: brief punch-in on impact, punch-out on recoil
 * - Receiver feedback: material flash + knockback (wired in PlayerLocal/Remote)
 * - Biggest effects reserved for kills
 */

const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const CAM_FORWARD = new THREE.Vector3(0, 0, -1)

// Per-attack profiles. kick is in camera-local space (x=right, y=up, z=back),
// meters. roll is radians. zoom is a punch in meters (negative = punch IN).
// sparkDir is in attacker-local space (-z forward).
export const AttackJuiceProfiles = {
  left: {
    kick: new THREE.Vector3(0.16, 0, 0.02), // swing travels left→right
    roll: -0.042,
    shake: 0.55,
    zoom: -0.3,
    sparkDir: new THREE.Vector3(1, 0.1, -0.3),
  },
  right: {
    kick: new THREE.Vector3(-0.16, 0, 0.02), // swing travels right→left
    roll: 0.042,
    shake: 0.55,
    zoom: -0.3,
    sparkDir: new THREE.Vector3(-1, 0.1, -0.3),
  },
  high: {
    kick: new THREE.Vector3(0, -0.15, 0.025), // overhead chop follows through down
    roll: 0,
    shake: 0.62,
    zoom: -0.38,
    sparkDir: new THREE.Vector3(0, -0.7, -0.7),
  },
  low: {
    kick: new THREE.Vector3(0.03, 0.13, 0.025), // rising cut kicks up
    roll: 0.028,
    shake: 0.5,
    zoom: -0.28,
    sparkDir: new THREE.Vector3(0.2, 0.9, -0.5),
  },
}

// Non-directional feedback tiers
export const JuiceEvents = {
  hitLanded: { hitstopMs: 120 },
  hitBlocked: {
    kick: new THREE.Vector3(0, 0.03, 0.14), // clang recoil, camera pushed back
    roll: 0.02,
    shake: 0.45,
    zoom: 0.25, // punch OUT — rejected
    hitstopMs: 90,
  },
  blockAbsorbed: {
    kick: new THREE.Vector3(0, 0.02, 0.1),
    roll: 0,
    shake: 0.4,
    zoom: 0.15,
  },
  tookDamage: {
    kick: new THREE.Vector3(0, -0.06, 0.18), // hard jolt down and back
    roll: 0.05,
    shake: 0.85,
    zoom: -0.3,
    hitstopMs: 140,
  },
  kill: {
    kick: new THREE.Vector3(0, 0.04, 0.06),
    roll: 0.06,
    shake: 1.0,
    zoom: -0.7, // big punch-in to frame the kill
    hitstopMs: 200,
  },
  knockbackForce: 4.5, // m/s impulse applied to the victim capsule
}

/**
 * Trauma-based camera shake + spring kick + zoom punch. Applied additively to
 * the control camera every frame AFTER simpleCamLerp (lerp snaps position, so
 * offsets don't accumulate).
 */
export class CombatCameraFX {
  constructor() {
    this.trauma = 0
    this.kick = new THREE.Vector3()
    this.kickVel = new THREE.Vector3()
    this.roll = 0
    this.rollVel = 0
    this.zoom = 0
    this.zoomVel = 0
    this.noiseT = Math.random() * 100
    this.maxShakeAmp = 0.12 // meters at trauma 1
    this.traumaDecay = 2.2 // full shake gone in ~0.45s
  }

  addShake(amount) {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  /** kick: Vector3 in camera-local space, roll radians, zoom meters (neg = in) */
  addKick(kick, roll = 0, zoom = 0) {
    this.kickVel.addScaledVector(kick, 30) // impulse into the spring
    this.rollVel += roll * 30
    this.zoomVel += zoom * 30
  }

  /** Call after simpleCamLerp. Mutates camera position/quaternion/zoom additively. */
  update(delta, camera) {
    if (delta > 0.1) delta = 0.1

    // under-damped spring back to zero — sharp hit, quick ring-down
    const stiffness = 320
    const damping = 16
    this.kickVel.addScaledVector(this.kick, -stiffness * delta)
    this.kickVel.multiplyScalar(Math.exp(-damping * delta))
    this.kick.addScaledVector(this.kickVel, delta)

    this.rollVel += -this.roll * stiffness * delta
    this.rollVel *= Math.exp(-damping * delta)
    this.roll += this.rollVel * delta

    this.zoomVel += -this.zoom * stiffness * delta
    this.zoomVel *= Math.exp(-damping * delta)
    this.zoom += this.zoomVel * delta

    this.trauma = Math.max(0, this.trauma - this.traumaDecay * delta)
    const shake = this.trauma * this.trauma

    const hasKick = this.kick.lengthSq() > 1e-10
    const hasZoom = Math.abs(this.zoom) > 0.0005
    if (shake <= 0.0001 && !hasKick && !hasZoom && Math.abs(this.roll) < 0.0001) return

    // smooth layered-sine noise (~20Hz feel), reads as impact not jitter
    this.noiseT += delta
    const t = this.noiseT * 20
    const nx = Math.sin(t * 6.3) * 0.6 + Math.sin(t * 11.7 + 1.7) * 0.4
    const ny = Math.sin(t * 7.9 + 4.2) * 0.6 + Math.sin(t * 13.3 + 2.3) * 0.4

    _v.set(nx * shake * this.maxShakeAmp, ny * shake * this.maxShakeAmp, 0)
    _v.add(this.kick)
    _v.applyQuaternion(camera.quaternion)
    camera.position.add(_v)

    const rollAngle = this.roll + nx * shake * 0.03
    if (Math.abs(rollAngle) > 0.00005) {
      _q.setFromAxisAngle(CAM_FORWARD, rollAngle)
      camera.quaternion.multiply(_q)
    }

    if (hasZoom) {
      camera.zoom = Math.max(0, camera.zoom + this.zoom)
    }
  }
}

/**
 * Hitstop: near-freeze the entity's animation mixer for a few frames of real
 * time. Visual only — uses a tiny timescale (not 0) so combat-pause detection
 * (`timeScale === 0`) and effect timers are unaffected.
 */
export function applyHitstop(entity, durationMs = 120, scale = 0.04) {
  const mixer = entity?.avatar?.instance?.mixer
  if (!mixer) return
  if (mixer.timeScale === 0) return // respect real charge/block pauses
  mixer.timeScale = scale
  if (entity._hitstopTimeout) clearTimeout(entity._hitstopTimeout)
  entity._hitstopTimeout = setTimeout(() => {
    entity._hitstopTimeout = null
    const m = entity?.avatar?.instance?.mixer
    if (!m) return
    // don't clobber a legit pause or another system's change
    if (entity.attackAnimationPaused || entity.blockAnimationPaused) return
    if (m.timeScale === scale) m.timeScale = 1
  }, durationMs)
}

/** Flash an entity's avatar materials (receiver hit confirm). */
export function flashAvatar(entity, color = 0xff3020, durationMs = 90) {
  entity?.avatar?.instance?.flash?.(color, durationMs)
}

/**
 * Directional impact sparks — hot white/orange chips that fly along the swing
 * path. Pushes particle data compatible with PlayerLocal's particle updater.
 */
export function spawnImpactSparks(world, activeParticles, position, worldDir) {
  const count = 14
  const geometry = new THREE.BoxGeometry(0.03, 0.03, 0.03)
  for (let i = 0; i < count; i++) {
    const hot = Math.random() > 0.4
    const material = new THREE.MeshStandardMaterial({
      color: hot ? 0xfff6e0 : 0xffa030,
      emissive: hot ? 0xfff6e0 : 0xff8020,
      emissiveIntensity: 8,
      opacity: 1,
      transparent: true,
    })
    const particle = new THREE.Mesh(geometry, material)
    particle.position.copy(position)
    world.stage.scene.add(particle)

    const velocity = new THREE.Vector3(
      worldDir.x * (4 + Math.random() * 4) + (Math.random() - 0.5) * 2.5,
      worldDir.y * (4 + Math.random() * 4) + Math.random() * 2,
      worldDir.z * (4 + Math.random() * 4) + (Math.random() - 0.5) * 2.5
    )

    activeParticles.push({
      mesh: particle,
      material,
      velocity,
      lifetime: 0.35 + Math.random() * 0.2,
      elapsed: 0,
      initialEmissive: 8,
      gravity: 9.8,
    })
  }
}
