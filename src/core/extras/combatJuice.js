import * as THREE from './three'

/**
 * Combat "juice" — layered impact feedback (hitstop, camera kick/shake,
 * directional sparks) that sells hits without changing the simulation.
 *
 * References (game-feel best practice):
 * - Hitstop: 40–120ms micro-freeze of attacker+victim at contact (visual only)
 * - Camera shake: trauma-based (shake = trauma²), fast decay (~0.2–0.4s),
 *   noise-driven, small amplitude, biased along the impact vector
 * - Camera kick: single spring impulse along the swing direction, distinct
 *   per attack so each of the 4 directions reads differently
 */

const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const CAM_FORWARD = new THREE.Vector3(0, 0, -1)

// Per-attack profiles. kick is in camera-local space (x=right, y=up, z=back),
// meters. roll is radians. sparkDir is in attacker-local space (-z forward).
export const AttackJuiceProfiles = {
  left: {
    kick: new THREE.Vector3(0.06, 0, 0.01), // swing travels left→right
    roll: -0.022,
    shake: 0.28,
    sparkDir: new THREE.Vector3(1, 0.1, -0.3),
  },
  right: {
    kick: new THREE.Vector3(-0.06, 0, 0.01), // swing travels right→left
    roll: 0.022,
    shake: 0.28,
    sparkDir: new THREE.Vector3(-1, 0.1, -0.3),
  },
  high: {
    kick: new THREE.Vector3(0, -0.055, 0.012), // overhead chop follows through down
    roll: 0,
    shake: 0.34,
    sparkDir: new THREE.Vector3(0, -0.7, -0.7),
  },
  low: {
    kick: new THREE.Vector3(0, 0.05, 0.012), // rising cut kicks up
    roll: 0.014,
    shake: 0.26,
    sparkDir: new THREE.Vector3(0.2, 0.9, -0.5),
  },
}

// Generic (non-directional) events
export const JuiceEvents = {
  hitLanded: { hitstopMs: 75 },
  hitBlocked: { kick: new THREE.Vector3(0, 0.015, 0.05), roll: 0, shake: 0.2, hitstopMs: 55 },
  tookDamage: { kick: new THREE.Vector3(0, -0.02, 0.055), roll: 0.018, shake: 0.45, hitstopMs: 90 },
}

/**
 * Trauma-based camera shake + spring kick. Applied additively to the control
 * camera every frame AFTER simpleCamLerp (lerp snaps position, so offsets
 * don't accumulate).
 */
export class CombatCameraFX {
  constructor() {
    this.trauma = 0
    this.kick = new THREE.Vector3()
    this.kickVel = new THREE.Vector3()
    this.roll = 0
    this.rollVel = 0
    this.noiseT = Math.random() * 100
    this.maxShakeAmp = 0.045 // meters at trauma 1
    this.traumaDecay = 3.0 // full shake gone in ~0.33s
  }

  addShake(amount) {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  /** kick: Vector3 in camera-local space, roll in radians */
  addKick(kick, roll = 0) {
    this.kickVel.addScaledVector(kick, 30) // impulse into the spring
    this.rollVel += roll * 30
  }

  /** Call after simpleCamLerp. Mutates camera.position/quaternion additively. */
  update(delta, camera) {
    if (delta > 0.1) delta = 0.1

    // critically-damped-ish spring back to zero
    const stiffness = 320
    const damping = 16
    this.kickVel.addScaledVector(this.kick, -stiffness * delta)
    this.kickVel.multiplyScalar(Math.exp(-damping * delta))
    this.kick.addScaledVector(this.kickVel, delta)

    this.rollVel += -this.roll * stiffness * delta
    this.rollVel *= Math.exp(-damping * delta)
    this.roll += this.rollVel * delta

    this.trauma = Math.max(0, this.trauma - this.traumaDecay * delta)
    const shake = this.trauma * this.trauma

    const hasKick = this.kick.lengthSq() > 1e-10
    if (shake <= 0.0001 && !hasKick && Math.abs(this.roll) < 0.0001) return

    // smooth layered-sine noise (~20Hz feel), reads as impact not jitter
    this.noiseT += delta
    const t = this.noiseT * 20
    const nx = Math.sin(t * 6.3) * 0.6 + Math.sin(t * 11.7 + 1.7) * 0.4
    const ny = Math.sin(t * 7.9 + 4.2) * 0.6 + Math.sin(t * 13.3 + 2.3) * 0.4

    _v.set(nx * shake * this.maxShakeAmp, ny * shake * this.maxShakeAmp, 0)
    _v.add(this.kick)
    _v.applyQuaternion(camera.quaternion)
    camera.position.add(_v)

    const rollAngle = this.roll + nx * shake * 0.01
    if (Math.abs(rollAngle) > 0.00005) {
      _q.setFromAxisAngle(CAM_FORWARD, rollAngle)
      camera.quaternion.multiply(_q)
    }
  }
}

/**
 * Hitstop: near-freeze the entity's animation mixer for a few frames of real
 * time. Visual only — uses a tiny timescale (not 0) so combat-pause detection
 * (`timeScale === 0`) and effect timers are unaffected.
 */
export function applyHitstop(entity, durationMs = 75, scale = 0.05) {
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

/**
 * Directional impact sparks — hot white/orange chips that fly along the swing
 * path. Pushes particle data compatible with PlayerLocal's particle updater.
 */
export function spawnImpactSparks(world, activeParticles, position, worldDir) {
  const count = 8
  const geometry = new THREE.BoxGeometry(0.025, 0.025, 0.025)
  for (let i = 0; i < count; i++) {
    const hot = Math.random() > 0.4
    const material = new THREE.MeshStandardMaterial({
      color: hot ? 0xfff6e0 : 0xffa030,
      emissive: hot ? 0xfff6e0 : 0xff8020,
      emissiveIntensity: 6,
      opacity: 1,
      transparent: true,
    })
    const particle = new THREE.Mesh(geometry, material)
    particle.position.copy(position)
    world.stage.scene.add(particle)

    const velocity = new THREE.Vector3(
      worldDir.x * (3 + Math.random() * 3) + (Math.random() - 0.5) * 2,
      worldDir.y * (3 + Math.random() * 3) + Math.random() * 1.5,
      worldDir.z * (3 + Math.random() * 3) + (Math.random() - 0.5) * 2
    )

    activeParticles.push({
      mesh: particle,
      material,
      velocity,
      lifetime: 0.3 + Math.random() * 0.15,
      elapsed: 0,
      initialEmissive: 6,
      gravity: 9.8,
    })
  }
}
