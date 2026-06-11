import * as THREE from './three'

export const AVATAR_CRUSADER = 'asset://avatar.vrm'
export const AVATAR_SARACEN = 'asset://romansenator.vrm'

/** Gladiator spawn offset from base spawn (meters, opposite senators). */
export const TEAM_SPAWN_SEPARATION = 5
const TEAM_SPAWN_HALF = TEAM_SPAWN_SEPARATION / 2
/** Senators spawn this many times farther forward than the old team offset. */
const SARACEN_SPAWN_FORWARD_MULTIPLIER = 5
const SARACEN_SPAWN_HEIGHT = 5

export function getTeamFromAvatar(sessionAvatar) {
  return sessionAvatar === AVATAR_SARACEN ? 'saracen' : 'crusader'
}

const FORWARD = new THREE.Vector3(0, 0, -1)
const UP = new THREE.Vector3(0, 1, 0)
const flipY = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI)
const spawnQuat = new THREE.Quaternion()
const offset = new THREE.Vector3()

export function getPlayerSpawn(baseSpawn, sessionAvatar) {
  const position = baseSpawn.position.slice()
  const quaternion = baseSpawn.quaternion.slice()

  spawnQuat.fromArray(quaternion)

  if (sessionAvatar === AVATAR_SARACEN) {
    offset.copy(FORWARD).applyQuaternion(spawnQuat).multiplyScalar(TEAM_SPAWN_HALF * SARACEN_SPAWN_FORWARD_MULTIPLIER)
    position[0] += offset.x
    position[1] += offset.y + SARACEN_SPAWN_HEIGHT
    position[2] += offset.z
    spawnQuat.fromArray(quaternion)
    spawnQuat.multiply(flipY)
    return { position, quaternion: spawnQuat.toArray() }
  }

  offset.copy(FORWARD).applyQuaternion(spawnQuat).multiplyScalar(TEAM_SPAWN_HALF)
  position[0] -= offset.x
  position[1] -= offset.y
  position[2] -= offset.z
  return { position, quaternion }
}

const rotationQuat = new THREE.Quaternion()
const rotationEuler = new THREE.Euler()

export function getRotationYFromQuaternion(quaternion) {
  rotationQuat.fromArray(quaternion)
  rotationEuler.setFromQuaternion(rotationQuat, 'YXZ')
  return rotationEuler.y
}
