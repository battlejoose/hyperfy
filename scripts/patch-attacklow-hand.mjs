import fs from 'fs'
import path from 'path'

const ATTACK_LOW_PATH = path.join('src/world/assets/attacklow.glb')
const HAND_BONE = 'mixamorig:RightHand'
const HAND_FORWARD_DEGREES = 75 // local +X: extend wrist so sword points out more
const HAND_TWIST_DEGREES = 70 // local +Z: roll hand (replaces Y-axis tweaks)

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

function quatFromAxisAngle(axis, angleRad) {
  const half = angleRad / 2
  const s = Math.sin(half)
  return normalizeQuat([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)])
}

function multiplyQuat(a, b) {
  return normalizeQuat([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ])
}

function patchRotationChannel({ buf, json, binStart, anim, boneName, transform }) {
  const channel = anim.channels.find(ch => {
    const node = json.nodes[ch.target.node]
    return node?.name === boneName && ch.target.path === 'rotation'
  })

  if (!channel) throw new Error(`No rotation channel found for ${boneName}`)

  const sampler = anim.samplers[channel.sampler]
  const outputAccessor = json.accessors[sampler.output]
  const outputView = json.bufferViews[outputAccessor.bufferView]
  const byteOffset = binStart + outputView.byteOffset + (outputAccessor.byteOffset || 0)
  const keyCount = outputAccessor.count

  for (let i = 0; i < keyCount; i++) {
    const q = readVec4(buf, byteOffset + i * 16)
    writeVec4(buf, byteOffset + i * 16, transform(q))
  }

  return keyCount
}

function patchAttackLowHand() {
  const { buf, json, binStart } = readGlb(ATTACK_LOW_PATH)
  const anim = json.animations[0]
  if (!anim) throw new Error('No animation found in attacklow.glb')

  const forwardOffset = quatFromAxisAngle([1, 0, 0], (HAND_FORWARD_DEGREES * Math.PI) / 180)
  const twistOffset = quatFromAxisAngle([0, 0, 1], (-HAND_TWIST_DEGREES * Math.PI) / 180)
  const handOffset = multiplyQuat(twistOffset, forwardOffset)

  const handKeys = patchRotationChannel({
    buf,
    json,
    binStart,
    anim,
    boneName: HAND_BONE,
    transform: q => multiplyQuat(handOffset, q),
  })

  fs.writeFileSync(ATTACK_LOW_PATH, buf)

  console.log(`Patched ${ATTACK_LOW_PATH}`)
  console.log(`  ${HAND_BONE}: ${handKeys} keys, +${HAND_FORWARD_DEGREES}° local X forward`)
  console.log(`  ${HAND_BONE}: ${handKeys} keys, -${HAND_TWIST_DEGREES}° local +Z`)
}

patchAttackLowHand()
