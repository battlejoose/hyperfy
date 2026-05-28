import fs from 'fs'
import path from 'path'

function inspect(file) {
  const buf = fs.readFileSync(file)
  const magic = buf.readUInt32LE(0)
  if (magic !== 0x46546c67) {
    console.log(file, 'not glb')
    return
  }
  let offset = 12
  let json
  let binOffset = 0
  while (offset < buf.length) {
    const chunkLength = buf.readUInt32LE(offset)
    const chunkType = buf.readUInt32LE(offset + 4)
    const chunkData = buf.slice(offset + 8, offset + 8 + chunkLength)
    if (chunkType === 0x4e4f534a) json = JSON.parse(chunkData.toString('utf8'))
    if (chunkType === 0x004e4942) binOffset = offset + 8
    offset += 8 + chunkLength
  }
  console.log('\n===', path.basename(file), '===')
  console.log('scene root children:')
  for (const i of json.scenes[0].nodes) {
    const n = json.nodes[i]
    console.log(' ', n.name, 'translation:', n.translation, 'scale:', n.scale)
  }
  const anim = json.animations[0]
  if (!anim) {
    console.log('no animation')
    return
  }
  console.log('anim:', anim.name)
  for (const ch of anim.channels) {
    const node = json.nodes[ch.target.node]?.name || `node${ch.target.node}`
    const sampler = anim.samplers[ch.sampler]
    const output = json.accessors[sampler.output]
    console.log(' ', `${node}.${ch.target.path}`, 'keys:', json.accessors[sampler.input].count)
    if (ch.target.path === 'translation') {
      const bv = json.bufferViews[output.bufferView]
      const data = buf.slice(binOffset + bv.byteOffset, binOffset + bv.byteOffset + bv.byteLength)
      const first = [0, 1, 2].map(i => data.readFloatLE(i * 4))
      const lastOff = (output.count - 1) * 3 * 4
      const last = [0, 1, 2].map(i => data.readFloatLE(lastOff + i * 4))
      const delta = last.map((v, i) => v - first[i])
      console.log(
        '    first:',
        first.map(v => v.toFixed(3)),
        'last:',
        last.map(v => v.toFixed(3)),
        'delta:',
        delta.map(v => v.toFixed(3))
      )
    }
  }
}

const assets = 'src/world/assets'
for (const f of ['kick.glb', 'attackleft.glb', 'blockhigh.glb']) {
  inspect(path.join(assets, f))
}
