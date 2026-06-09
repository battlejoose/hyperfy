import * as THREE from './three'
import { createNode } from './createNode'

export const ARENA_SRC = 'asset://smallarenarome.glb'

let arenaPromise = null

const _matrix = new THREE.Matrix4()
const _bodyMatrixInverse = new THREE.Matrix4()

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

export function loadArenaEnvironment(world) {
  if (arenaPromise) return arenaPromise

  arenaPromise = (async () => {
    let src = world.loader.get('model', ARENA_SRC)
    if (!src) src = await world.loader.load('model', ARENA_SRC)

    const root = src.toNodes()
    centerNodeTree(root)
    addStaticColliders(root)
    root.activate({ world })
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

export function clearArenaEnvironment() {
  arenaPromise = null
}
