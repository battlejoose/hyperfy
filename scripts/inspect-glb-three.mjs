import fs from 'fs'
import path from 'path'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const loader = new GLTFLoader()

async function inspect(file) {
  const buf = fs.readFileSync(file)
  const glb = await loader.parseAsync(buf.buffer, '')
  const clip = glb.animations[0]
  console.log('\n===', path.basename(file), '===')
  if (!clip) return console.log('no clip')
  for (const track of clip.tracks) {
    if (track.name.includes('position') || track.name.includes('Hips') || track.name.includes('Root') || track.name.includes('Bone')) {
      const vals = track.values
      const first = [vals[0], vals[1], vals[2]]
      const last = [vals[vals.length - 3], vals[vals.length - 2], vals[vals.length - 1]]
      console.log(track.name, 'keys:', track.times.length, 'first:', first.map(v => v.toFixed(3)), 'last:', last.map(v => v.toFixed(3)))
    }
  }
  console.log('position tracks after emote filter:')
  clip.tracks.filter(t => {
    if (t instanceof THREE.VectorKeyframeTrack) {
      const [name, type] = t.name.split('.')
      if (type !== 'position') return false
      return name === 'Root' || name === 'mixamorigHips'
    }
    return false
  }).forEach(t => console.log(' ', t.name))
}

for (const f of ['kick.glb', 'attackleft.glb', 'blockhigh.glb']) {
  await inspect(path.join('src/world/assets', f))
}
