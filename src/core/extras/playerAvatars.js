import * as THREE from './three'

export const AVATAR_CRUSADER = 'asset://avatar.vrm'
export const AVATAR_SARACEN = 'asset://saladin.vrm'

/** Distance between crusader and saracen spawn points (meters). */
export const TEAM_SPAWN_SEPARATION = 5
const TEAM_SPAWN_HALF = TEAM_SPAWN_SEPARATION / 2

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
  offset.copy(FORWARD).applyQuaternion(spawnQuat).multiplyScalar(TEAM_SPAWN_HALF)

  if (sessionAvatar === AVATAR_SARACEN) {
    position[0] += offset.x
    position[1] += offset.y
    position[2] += offset.z
    spawnQuat.fromArray(quaternion)
    spawnQuat.multiply(flipY)
    return { position, quaternion: spawnQuat.toArray() }
  }

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
