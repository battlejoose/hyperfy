// Minimal glTF 2.0 binary (.glb) writer — enough for static meshes with PBR
// materials, embedded textures, node instancing and hyperfy `extras`.
import fs from 'fs'

const COMPONENT = { Float32Array: 5126, Uint16Array: 5123, Uint32Array: 5125, Uint8Array: 5121 }
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963

function pad4(n) {
  return (n + 3) & ~3
}

export class GlbWriter {
  constructor(generator = 'hyperfy colosseum generator') {
    this.json = {
      asset: { version: '2.0', generator },
      scene: 0,
      scenes: [{ name: 'Scene', nodes: [] }],
      nodes: [],
      meshes: [],
      materials: [],
      textures: [],
      images: [],
      samplers: [
        { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }, // repeat
        { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }, // clamp
      ],
      accessors: [],
      bufferViews: [],
      buffers: [{ byteLength: 0 }],
    }
    this.chunks = []
    this.byteLength = 0
    this.extensionsUsed = new Set()
    this.extensionsRequired = new Set()
    this.geometryCache = new Map()
    this.stats = { triangles: 0, uniqueTriangles: 0, vertices: 0, nodes: 0 }
  }

  addBufferView(bytes, target) {
    const offset = this.byteLength
    const len = bytes.byteLength
    const padded = pad4(len)
    const buf = Buffer.alloc(padded)
    Buffer.from(bytes.buffer, bytes.byteOffset, len).copy(buf)
    this.chunks.push(buf)
    this.byteLength += padded
    const view = { buffer: 0, byteOffset: offset, byteLength: len }
    if (target) view.target = target
    this.json.bufferViews.push(view)
    return this.json.bufferViews.length - 1
  }

  addAccessor(array, type, target, extra = {}) {
    const compCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type]
    const view = this.addBufferView(array, target)
    const acc = {
      bufferView: view,
      componentType: COMPONENT[array.constructor.name],
      count: array.length / compCount,
      type,
      ...extra,
    }
    this.json.accessors.push(acc)
    return this.json.accessors.length - 1
  }

  addImage({ name, data, mimeType }) {
    const view = this.addBufferView(data)
    this.json.images.push({ name, mimeType, bufferView: view })
    if (mimeType === 'image/webp') {
      this.extensionsUsed.add('EXT_texture_webp')
      this.extensionsRequired.add('EXT_texture_webp')
    }
    return this.json.images.length - 1
  }

  addTexture(image, { clamp = false } = {}) {
    const img = this.json.images[image]
    const tex = { sampler: clamp ? 1 : 0 }
    if (img.mimeType === 'image/webp') {
      tex.extensions = { EXT_texture_webp: { source: image } }
    } else {
      tex.source = image
    }
    this.json.textures.push(tex)
    return this.json.textures.length - 1
  }

  /**
   * opts: { name, color:[r,g,b], alpha, texture, normal, normalScale, metallic, roughness,
   *         emissive:[r,g,b], emissiveTexture, doubleSided, alphaMode, clamp }
   * texture / normal are image indices.
   */
  addMaterial(opts) {
    const pbr = {
      baseColorFactor: [...(opts.color ?? [1, 1, 1]), opts.alpha ?? 1],
      metallicFactor: opts.metallic ?? 0,
      roughnessFactor: opts.roughness ?? 0.9,
    }
    if (opts.texture !== undefined) pbr.baseColorTexture = { index: this.addTexture(opts.texture, { clamp: opts.clamp }) }
    const mat = { name: opts.name, pbrMetallicRoughness: pbr }
    if (opts.normal !== undefined) {
      mat.normalTexture = { index: this.addTexture(opts.normal, { clamp: opts.clamp }) }
      if (opts.normalScale !== undefined) mat.normalTexture.scale = opts.normalScale
    }
    if (opts.emissive) mat.emissiveFactor = opts.emissive
    if (opts.doubleSided) mat.doubleSided = true
    if (opts.alphaMode) mat.alphaMode = opts.alphaMode
    this.json.materials.push(mat)
    return this.json.materials.length - 1
  }

  addGeometry(geometry) {
    if (this.geometryCache.has(geometry)) return this.geometryCache.get(geometry)
    const pos = geometry.attributes.position
    const nor = geometry.attributes.normal
    const uv = geometry.attributes.uv
    if (!geometry.index) geometry.setIndex([...Array(pos.count).keys()])
    const posArr = pos.array instanceof Float32Array ? pos.array : new Float32Array(pos.array)
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < pos.count; i++) {
      for (let c = 0; c < 3; c++) {
        const v = posArr[i * 3 + c]
        if (v < min[c]) min[c] = v
        if (v > max[c]) max[c] = v
      }
    }
    const attributes = {
      POSITION: this.addAccessor(posArr, 'VEC3', ARRAY_BUFFER, { min, max }),
      NORMAL: this.addAccessor(new Float32Array(nor.array), 'VEC3', ARRAY_BUFFER),
    }
    if (uv) attributes.TEXCOORD_0 = this.addAccessor(new Float32Array(uv.array), 'VEC2', ARRAY_BUFFER)
    if (geometry.attributes.color) {
      attributes.COLOR_0 = this.addAccessor(new Float32Array(geometry.attributes.color.array), 'VEC3', ARRAY_BUFFER)
    }
    const idxSrc = geometry.index.array
    const indexArr = pos.count <= 65535 ? new Uint16Array(idxSrc) : new Uint32Array(idxSrc)
    const indices = this.addAccessor(indexArr, 'SCALAR', ELEMENT_ARRAY_BUFFER)
    this.stats.uniqueTriangles += idxSrc.length / 3
    this.stats.vertices += pos.count
    const entry = { attributes, indices, triangles: idxSrc.length / 3 }
    this.geometryCache.set(geometry, entry)
    return entry
  }

  /** primitives: [{ geometry, material }] */
  addMesh(name, primitives) {
    const prims = []
    let tris = 0
    for (const p of primitives) {
      if (!p.geometry) continue
      const g = this.addGeometry(p.geometry)
      prims.push({ attributes: g.attributes, indices: g.indices, material: p.material, mode: 4 })
      tris += g.triangles
    }
    if (!prims.length) throw new Error(`mesh ${name} has no primitives`)
    this.json.meshes.push({ name, primitives: prims })
    const idx = this.json.meshes.length - 1
    this.meshTris = this.meshTris || []
    this.meshTris[idx] = tris
    return idx
  }

  /**
   * Add a node. translation [x,y,z], rotation quaternion [x,y,z,w], scale [x,y,z].
   * `parent` (node index) nests it; otherwise it's a scene root.
   */
  addNode({ name, mesh, translation, rotation, scale, extras, parent } = {}) {
    const node = { name }
    if (mesh !== undefined) {
      node.mesh = mesh
      this.stats.triangles += this.meshTris[mesh] || 0
    }
    if (translation && translation.some(v => v !== 0)) node.translation = translation
    if (rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0 || rotation[3] !== 1)) node.rotation = rotation
    if (scale && scale.some(v => v !== 1)) node.scale = scale
    if (extras) node.extras = extras
    this.json.nodes.push(node)
    const idx = this.json.nodes.length - 1
    if (parent !== undefined) {
      const p = this.json.nodes[parent]
      p.children = p.children || []
      p.children.push(idx)
    } else {
      this.json.scenes[0].nodes.push(idx)
    }
    this.stats.nodes++
    return idx
  }

  write(file) {
    if (this.extensionsUsed.size) this.json.extensionsUsed = [...this.extensionsUsed]
    if (this.extensionsRequired.size) this.json.extensionsRequired = [...this.extensionsRequired]
    this.json.buffers[0].byteLength = this.byteLength
    let jsonStr = JSON.stringify(this.json)
    while (jsonStr.length % 4) jsonStr += ' '
    const jsonBuf = Buffer.from(jsonStr, 'utf8')
    const bin = Buffer.concat(this.chunks)
    const total = 12 + 8 + jsonBuf.length + 8 + bin.length
    const header = Buffer.alloc(12)
    header.write('glTF', 0, 'ascii')
    header.writeUInt32LE(2, 4)
    header.writeUInt32LE(total, 8)
    const jsonHeader = Buffer.alloc(8)
    jsonHeader.writeUInt32LE(jsonBuf.length, 0)
    jsonHeader.writeUInt32LE(0x4e4f534a, 4) // JSON
    const binHeader = Buffer.alloc(8)
    binHeader.writeUInt32LE(bin.length, 0)
    binHeader.writeUInt32LE(0x004e4942, 4) // BIN
    fs.writeFileSync(file, Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin]))
    return total
  }
}
