import fs from 'fs'
import path from 'path'

const KICK_PATH = path.join('src/world/assets/kick.glb')
const BONE_NAME = 'mixamorig:RightForeArm'
const STRAIGHTEN_DEGREES = 10 // reduce local bend angle by this many degrees

function readGlb(file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file')

  let offset = 12
  let json
  let binStart = 0

  while (offset < buf.length) {
    const chunkLength = buf.readUInt32LE(offset)
    const chunkType = buf.readUInt32LE(offset + 4)
    const chunkStart = offset + 8

    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(buf.slice(chunkStart, chunkStart + chunkLength).toString('utf8'))
    } else if (chunkType === 0x004e4942) {
      binStart = chunkStart
    }

    offset = chunkStart + chunkLength
  }

  if (!json || !binStart) throw new Error('Invalid GLB structure')
  return { buf, json, binStart }
}

function readVec4(buffer, byteOffset) {
  return [
    buffer.readFloatLE(byteOffset),
    buffer.readFloatLE(byteOffset + 4),
    buffer.readFloatLE(byteOffset + 8),
    buffer.readFloatLE(byteOffset + 12),
  ]
}

function writeVec4(buffer, byteOffset, q) {
  buffer.writeFloatLE(q[0], byteOffset)
  buffer.writeFloatLE(q[1], byteOffset + 4)
  buffer.writeFloatLE(q[2], byteOffset + 8)
  buffer.writeFloatLE(q[3], byteOffset + 12)
}

function normalizeQuat(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return q.map(v => v / len)
}

function straightenQuatByDegrees(q, degrees) {
  const [x, y, z, w] = q
  const absW = Math.min(1, Math.abs(w))
  const angle = 2 * Math.acos(absW)
  if (angle < 1e-6) return q

  const sinHalf = Math.sin(angle / 2)
  const axis = [x / sinHalf, y / sinHalf, z / sinHalf]
  const newAngle = Math.max(0, angle - (degrees * Math.PI) / 180)
  const newSinHalf = Math.sin(newAngle / 2)
  const newCosHalf = Math.cos(newAngle / 2)
  const sign = w < 0 ? -1 : 1

  return normalizeQuat([
    axis[0] * newSinHalf,
    axis[1] * newSinHalf,
    axis[2] * newSinHalf,
    sign * newCosHalf,
  ])
}

function quatAngleDegrees(q) {
  return (2 * Math.acos(Math.min(1, Math.abs(q[3])))) * (180 / Math.PI)
}

function patchKickForearm() {
  const { buf, json, binStart } = readGlb(KICK_PATH)
  const anim = json.animations[0]
  if (!anim) throw new Error('No animation found in kick.glb')

  const channel = anim.channels.find(ch => {
    const node = json.nodes[ch.target.node]
    return node?.name === BONE_NAME && ch.target.path === 'rotation'
  })

  if (!channel) throw new Error(`No rotation channel found for ${BONE_NAME}`)

  const sampler = anim.samplers[channel.sampler]
  const outputAccessor = json.accessors[sampler.output]
  const outputView = json.bufferViews[outputAccessor.bufferView]
  const byteOffset = binStart + outputView.byteOffset + (outputAccessor.byteOffset || 0)
  const keyCount = outputAccessor.count

  const before = readVec4(buf, byteOffset)
  for (let i = 0; i < keyCount; i++) {
    const q = readVec4(buf, byteOffset + i * 16)
    writeVec4(buf, byteOffset + i * 16, straightenQuatByDegrees(q, STRAIGHTEN_DEGREES))
  }
  const after = readVec4(buf, byteOffset)

  fs.writeFileSync(KICK_PATH, buf)

  console.log(`Patched ${keyCount} ${BONE_NAME} rotation keys in ${KICK_PATH}`)
  console.log(`Straightened by ${STRAIGHTEN_DEGREES}° on each keyframe`)
  console.log('Sample before:', before.map(v => v.toFixed(4)).join(', '), `(${quatAngleDegrees(before).toFixed(1)}°)`)
  console.log('Sample after:', after.map(v => v.toFixed(4)).join(', '), `(${quatAngleDegrees(after).toFixed(1)}°)`)
}

patchKickForearm()
