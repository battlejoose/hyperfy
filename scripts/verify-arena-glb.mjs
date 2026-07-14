// One-off check: the meshopt+WebP compressed arena GLB must parse with the
// same loader setup the server uses (custom lib + Node mocks + MeshoptDecoder).
import fs from 'fs'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

globalThis.self = { URL }
globalThis.window = {}
globalThis.document = {
  createElementNS: () => ({ style: {} }),
}

const { GLTFLoader } = await import('../src/core/libs/gltfloader/GLTFLoader.js')

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)

const buf = fs.readFileSync('src/world/assets/arena-rome.glb')
const glb = await new Promise((resolve, reject) => {
  loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject)
})

let meshes = 0
let vertices = 0
glb.scene.traverse(obj => {
  if (obj.isMesh) {
    meshes++
    vertices += obj.geometry.attributes.position?.count || 0
  }
})
console.log(`OK: parsed arena-rome.glb — ${meshes} meshes, ${vertices} vertices`)
