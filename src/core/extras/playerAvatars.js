import * as THREE from './three'

export const AVATAR_CRUSADER = 'asset://avatar.vrm'
export const AVATAR_SARACEN = 'asset://romansenator.vrm'

/** Gladiator spawn: random point on this radius (meters) around map center. */
export const CRUSADER_SPAWN_RADIUS = 10
/** Saracen spawn: random point on this radius (meters) around map center. */
export const SARACEN_SPAWN_RADIUS = 16
/** Saracen spawn height above map center (meters). */
export const SARACEN_SPAWN_HEIGHT = 6

export function getTeamFromAvatar(sessionAvatar) {
  return sessionAvatar === AVATAR_SARACEN ? 'saracen' : 'crusader'
}

export function isSpectatorSessionAvatar(sessionAvatar) {
  return sessionAvatar === AVATAR_SARACEN
}

export const TEST_FIGHTER_TINT = 0x4488ff

export function isTestFighter(data) {
  return !!data?.testFighter
}

export function applyTestFighterTint(avatar, testFighter) {
  avatar?.instance?.setTint?.(!!testFighter)
}

const UP = new THREE.Vector3(0, 1, 0)
const spawnQuat = new THREE.Quaternion()
const offset = new THREE.Vector3()
const center = new THREE.Vector3()
const spawnPosition = new THREE.Vector3()
const faceQuat = new THREE.Quaternion()
const lookAtMat = new THREE.Matrix4()

function getCircularSpawn(baseSpawn, radius, heightOffset = 0) {
  const position = baseSpawn.position.slice()

  spawnQuat.fromArray(baseSpawn.quaternion)

  const angle = Math.random() * Math.PI * 2
  offset.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
  offset.applyQuaternion(spawnQuat)
  position[0] += offset.x
  position[1] += offset.y + heightOffset
  position[2] += offset.z

  center.set(baseSpawn.position[0], position[1], baseSpawn.position[2])
  spawnPosition.set(position[0], position[1], position[2])
  lookAtMat.lookAt(spawnPosition, center, UP)
  faceQuat.setFromRotationMatrix(lookAtMat)
  return { position, quaternion: faceQuat.toArray() }
}

export function getPlayerSpawn(baseSpawn, sessionAvatar) {
  if (sessionAvatar === AVATAR_SARACEN) {
    return getCircularSpawn(baseSpawn, SARACEN_SPAWN_RADIUS, SARACEN_SPAWN_HEIGHT)
  }
  return getCircularSpawn(baseSpawn, CRUSADER_SPAWN_RADIUS)
}

const rotationQuat = new THREE.Quaternion()
const rotationEuler = new THREE.Euler()

export function getRotationYFromQuaternion(quaternion) {
  rotationQuat.fromArray(quaternion)
  rotationEuler.setFromQuaternion(rotationQuat, 'YXZ')
  return rotationEuler.y
}
