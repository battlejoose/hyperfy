import * as THREE from './three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { createNode } from './createNode'

export const ARENA_SRC = 'asset://arenasmall.obj'

let arenaPromise = null

async function fetchObjText(world) {
  const url = world.resolveURL(ARENA_SRC, !!world.network?.isServer)
  if (world.loader?.fetchText) {
    return world.loader.fetchText(url)
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`[Arena] failed to fetch ${url}`)
  return response.text()
}

function centerArena(object) {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  object.position.sub(center)
  box.setFromObject(object)
  object.position.y -= box.min.y
  object.updateMatrixWorld(true)
}

function buildArenaNodes(world, object) {
  const root = createNode('group', { id: 'arena' })
  const body = createNode('rigidbody', { type: 'static' })
  root.add(body)

  object.traverse(child => {
    if (!child.isMesh) return

    const geometry = child.geometry
    if (!geometry) return

    if (Array.isArray(child.material)) {
      child.material = child.material.map(mat => mat?.clone?.() ?? mat)
    } else if (child.material?.clone) {
      child.material = child.material.clone()
    } else {
      child.material = new THREE.MeshStandardMaterial({ color: 0xc4a574 })
    }

    const mesh = createNode('mesh', {
      type: 'geometry',
      geometry,
      material: child.material,
      castShadow: true,
      receiveShadow: true,
    })
    mesh.position.copy(child.position)
    mesh.quaternion.copy(child.quaternion)
    mesh.scale.copy(child.scale)

    const collider = createNode('collider', {
      type: 'geometry',
      geometry,
      layer: 'environment',
    })
    collider.position.copy(child.position)
    collider.quaternion.copy(child.quaternion)
    collider.scale.copy(child.scale)

    body.add(mesh)
    body.add(collider)
  })

  root.activate({ world })
  root.setDirty()
  world.stage?.clean()
  return root
}

export function loadArenaEnvironment(world) {
  if (arenaPromise) return arenaPromise

  arenaPromise = (async () => {
    const text = await fetchObjText(world)
    const object = new OBJLoader().parse(text)
    centerArena(object)
    return buildArenaNodes(world, object)
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
