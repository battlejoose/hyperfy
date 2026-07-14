import * as THREE from './three'
import { createNode } from './createNode'
import { addArenaFireFx, clearArenaFireFx } from './arenaFireFx.js'
import { addArenaGeneral } from './arenaGeneral.js'
import { addArenaCrowd, clearArenaCrowd } from './arenaCrowd.js'

// meshopt + WebP, textures capped at 1024 (was 34MB raw / 13MB v1 with 2K
// textures that OOM'd WebGL). New filename busts the immutable asset cache.
export const ARENA_SRC = 'asset://arena-rome-v2.glb'

/** Separates gladiator floor (inside) from spectator ring (outside). */
export const ARENA_RING_WALL_RADIUS = 12.2
/** Outer edge of the spectator ring. */
export const ARENA_OUTER_RING_WALL_RADIUS = 17
export const ARENA_RING_WALL_HEIGHT = 10
export const ARENA_RING_WALL_THICKNESS = 0.2
export const ARENA_RING_WALL_SEGMENTS = 64

const ARENA_RING_WALL_RADII = [ARENA_RING_WALL_RADIUS, ARENA_OUTER_RING_WALL_RADIUS]

let arenaPromise = null

const _matrix = new THREE.Matrix4()
const _bodyMatrixInverse = new THREE.Matrix4()
const _segmentAngle = (Math.PI * 2) / ARENA_RING_WALL_SEGMENTS
const _segmentHalfHeight = ARENA_RING_WALL_HEIGHT / 2

function forEachRingWallSegment(radius, callback) {
  const segmentWidth = 2 * radius * Math.sin(_segmentAngle / 2)

  for (let i = 0; i < ARENA_RING_WALL_SEGMENTS; i++) {
    const angle = i * _segmentAngle
    callback({
      x: Math.cos(angle) * radius,
      y: _segmentHalfHeight,
      z: Math.sin(angle) * radius,
      rotY: Math.PI / 2 - angle,
      width: segmentWidth,
      height: ARENA_RING_WALL_HEIGHT,
      depth: ARENA_RING_WALL_THICKNESS,
    })
  }
}

function addRingWallColliders(root, radius) {
  const body = createNode('rigidbody', { type: 'static' })
  root.add(body)

  forEachRingWallSegment(radius, segment => {
    const collider = createNode('collider', {
      type: 'box',
      width: segment.width,
      height: segment.height,
      depth: segment.depth,
      layer: 'environment',
    })
    collider.position.set(segment.x, segment.y, segment.z)
    collider.rotation.y = segment.rotY
    body.add(collider)
  })
}

function createRingWallDebugMeshes(world, radius) {
  if (!world.stage?.scene) return []

  const segmentWidth = 2 * radius * Math.sin(_segmentAngle / 2)
  const geometry = new THREE.BoxGeometry(segmentWidth, ARENA_RING_WALL_HEIGHT, ARENA_RING_WALL_THICKNESS)
  const material = new THREE.MeshBasicMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.25,
    wireframe: false,
    depthTest: true,
  })

  const meshes = []
  forEachRingWallSegment(radius, segment => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(segment.x, segment.y, segment.z)
    mesh.rotation.y = segment.rotY
    mesh.visible = false
    world.stage.scene.add(mesh)
    meshes.push(mesh)
  })

  return meshes
}

function createArenaRingWallDebugMeshes(world) {
  const meshes = []
  for (const radius of ARENA_RING_WALL_RADII) {
    meshes.push(...createRingWallDebugMeshes(world, radius))
  }
  return meshes
}

function setArenaRingWallDebugVisible(world, show) {
  if (world.network?.isServer || !world.stage?.scene) return

  if (!world._arenaRingWallDebugMeshes?.length) {
    world._arenaRingWallDebugMeshes = createArenaRingWallDebugMeshes(world)
  }

  if (!world._arenaRingWallDebugMeshes.length) return

  for (const mesh of world._arenaRingWallDebugMeshes) {
    mesh.visible = show
  }
}

function setupArenaRingWallColliderDebug(world) {
  if (world.network?.isServer || world._arenaRingWallDebugReady) return
  world._arenaRingWallDebugReady = true

  world.on('showColliders', show => {
    setArenaRingWallDebugVisible(world, show)
  })

  if (world.showColliders) {
    setArenaRingWallDebugVisible(world, true)
  }
}

function centerNodeTree(root) {
  root.updateTransform()
  root.traverse(node => node.updateTransform())

  const box = new THREE.Box3()
  root.traverse(node => {
    if (node.name !== 'mesh' || !node._geometry) return
    const geometry = node._geometry
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    const meshBox = geometry.boundingBox.clone()
    meshBox.applyMatrix4(node.matrixWorld)
    box.union(meshBox)
  })

  if (box.isEmpty()) return

  const center = box.getCenter(new THREE.Vector3())
  root.position.x -= center.x
  root.position.y -= box.min.y
  root.position.z -= center.z
  root.setTransformed()
}

function addStaticColliders(root) {
  let hasCollider = false
  root.traverse(node => {
    if (node.name === 'collider') hasCollider = true
  })
  if (hasCollider) return

  const meshes = []
  root.traverse(node => {
    if (node.name === 'mesh' && node._geometry) meshes.push(node)
  })
  if (!meshes.length) return

  const body = createNode('rigidbody', { type: 'static' })
  root.add(body)

  for (const mesh of meshes) {
    mesh.updateTransform()
    body.updateTransform()
    _bodyMatrixInverse.copy(body.matrixWorld).invert()
    _matrix.multiplyMatrices(_bodyMatrixInverse, mesh.matrixWorld)

    const collider = createNode('collider', {
      type: 'geometry',
      geometry: mesh._geometry,
      layer: 'environment',
    })
    _matrix.decompose(collider.position, collider.quaternion, collider.scale)
    body.add(collider)
  }
}

function addArenaRingWalls(root) {
  for (const radius of ARENA_RING_WALL_RADII) {
    addRingWallColliders(root, radius)
  }
}

export function loadArenaEnvironment(world) {
  if (arenaPromise) return arenaPromise

  arenaPromise = (async () => {
    let src = world.loader.get('model', ARENA_SRC)
    if (!src) src = await world.loader.load('model', ARENA_SRC)

    const root = src.toNodes()
    centerNodeTree(root)
    addStaticColliders(root)
    addArenaRingWalls(root)
    root.activate({ world })
    setupArenaRingWallColliderDebug(world)
    if (!world.network?.isServer) {
      await addArenaFireFx(world, root)
      await addArenaGeneral(world, root)
      await addArenaCrowd(world, root)
    }
    root.setDirty()
    world.stage?.clean()
    return root
  })().catch(err => {
    arenaPromise = null
    console.error('[Arena] failed to load:', err)
    throw err
  })

  return arenaPromise
}

export function clearArenaEnvironment(world) {
  arenaPromise = null
  if (world) {
    clearArenaFireFx(world)
    clearArenaCrowd(world)
  }
}

export function clearArenaRingWallColliderDebug(world) {
  if (!world?._arenaRingWallDebugMeshes) return

  for (const mesh of world._arenaRingWallDebugMeshes) {
    world.stage?.scene?.remove(mesh)
  }

  world._arenaRingWallDebugMeshes = null
  world._arenaRingWallDebugReady = false
}
