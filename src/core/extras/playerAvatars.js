import * as THREE from './three'

export const AVATAR_CRUSADER = 'asset://avatar.vrm'
export const AVATAR_SARACEN = 'asset://saladin.vrm'

/** Saracen spawns this many meters in front of the crusader spawn, facing back toward it. */
export const SARACEN_SPAWN_FORWARD_OFFSET = 20

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

  if (sessionAvatar !== AVATAR_SARACEN) {
    return { position, quaternion }
  }

  spawnQuat.fromArray(quaternion)
  offset.copy(FORWARD).applyQuaternion(spawnQuat).multiplyScalar(SARACEN_SPAWN_FORWARD_OFFSET)
  position[0] += offset.x
  position[1] += offset.y
  position[2] += offset.z

  spawnQuat.multiply(flipY)
  return { position, quaternion: spawnQuat.toArray() }
}

const rotationQuat = new THREE.Quaternion()
const rotationEuler = new THREE.Euler()

export function getRotationYFromQuaternion(quaternion) {
  rotationQuat.fromArray(quaternion)
  rotationEuler.setFromQuaternion(rotationQuat, 'YXZ')
  return rotationEuler.y
}
