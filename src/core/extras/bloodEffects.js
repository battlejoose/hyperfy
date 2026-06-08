import * as THREE from './three'
import { Layers } from './Layers'

const BLOOD_SPLATTER_SRC = 'asset://bloodsplatter.png'
const MAX_SPLATTERS = 200
const UP = new THREE.Vector3(0, 1, 0)
const DOWN = new THREE.Vector3(0, -1, 0)

const v1 = new THREE.Vector3()

let splatterTexturePromise = null
let splatterGeometry = null
let splatterMaterial = null
const splatterMeshes = []

function getSplatterTexture(world) {
  if (!splatterTexturePromise) {
    splatterTexturePromise = world.loader.load('texture', BLOOD_SPLATTER_SRC)
  }
  return splatterTexturePromise
}

function getGroundPoint(world, hitPosition) {
  const origin = v1.set(hitPosition.x, hitPosition.y + 0.5, hitPosition.z)
  const hitMask = Layers.environment.group | Layers.prop.group
  const hit = world.physics?.raycast(origin, DOWN, 10, hitMask)
  if (hit) {
    return { point: hit.point.clone(), normal: hit.normal.clone() }
  }
  return {
    point: new THREE.Vector3(hitPosition.x, hitPosition.y - 1.5, hitPosition.z),
    normal: UP.clone(),
  }
}

function trimSplatters(world) {
  while (splatterMeshes.length >= MAX_SPLATTERS) {
    const mesh = splatterMeshes.shift()
    world.stage.scene.remove(mesh)
  }
}

export function spawnBloodEffect(world, activeParticles, hitPosition) {
  spawnBloodParticles(world, activeParticles, hitPosition)
  spawnBloodSplatters(world, hitPosition)
}

export function spawnBloodParticles(world, activeParticles, position) {
  const particleCount = 50
  const geometry = new THREE.BoxGeometry(0.03, 0.03, 0.03)

  for (let i = 0; i < particleCount; i++) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xaa0000,
      emissive: 0xcc0000,
      emissiveIntensity: 2,
      opacity: 0.9,
      transparent: true,
    })

    const particle = new THREE.Mesh(geometry, material)
    particle.position.set(position.x, position.y, position.z)
    world.stage.scene.add(particle)

    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 4,
      Math.random() * 3 + 1,
      (Math.random() - 0.5) * 4
    )

    activeParticles.push({
      mesh: particle,
      material,
      velocity,
      lifetime: 0.6,
      elapsed: 0,
      initialEmissive: 2,
      gravity: 9.8,
    })
  }
}

export async function spawnBloodSplatters(world, hitPosition) {
  if (!world.stage?.scene || !world.loader) return

  let texture
  try {
    texture = await getSplatterTexture(world)
  } catch (err) {
    console.error('[Blood] failed to load splatter texture:', err)
    return
  }

  if (!splatterGeometry) {
    splatterGeometry = new THREE.PlaneGeometry(1, 1)
    // Bake horizontal orientation into geometry so rotation.y spins flat on the ground
    splatterGeometry.rotateX(-Math.PI / 2)
  }
  if (!splatterMaterial || splatterMaterial.map !== texture) {
    splatterMaterial?.dispose()
    splatterMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      alphaTest: 0.15,
    })
  }

  const { point } = getGroundPoint(world, hitPosition)
  const count = 3 + Math.floor(Math.random() * 3)

  for (let i = 0; i < count; i++) {
    trimSplatters(world)

    const mesh = new THREE.Mesh(splatterGeometry, splatterMaterial)
    const scale = 0.5 + Math.random() * 0.7
    const stretchX = 0.85 + Math.random() * 0.3
    const stretchZ = 0.85 + Math.random() * 0.3
    mesh.scale.set(scale * stretchX, 1, scale * stretchZ)

    const offsetX = (Math.random() - 0.5) * 0.8
    const offsetZ = (Math.random() - 0.5) * 0.8
    mesh.position.set(point.x + offsetX, point.y + 0.02, point.z + offsetZ)

    // Spin around vertical axis only — geometry is already flat on XZ
    mesh.rotation.set(0, Math.random() * Math.PI * 2, 0)

    world.stage.scene.add(mesh)
    splatterMeshes.push(mesh)
  }
}
