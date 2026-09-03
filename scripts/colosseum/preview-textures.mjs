// Dumps every generated texture (and normal map) as PNG for eyeballing.
//   node scripts/colosseum/preview-textures.mjs <outDir>
import fs from 'fs'
import path from 'path'
import { encodePNG } from './image.mjs'
import { generateAll } from './textures.mjs'

const outDir = process.argv[2] || 'texture-preview'
fs.mkdirSync(outDir, { recursive: true })
const t0 = Date.now()
for (const tex of generateAll()) {
  fs.writeFileSync(path.join(outDir, `${tex.name}.png`), encodePNG(tex.width, tex.height, tex.rgb, 3))
  if (tex.normal) {
    fs.writeFileSync(path.join(outDir, `${tex.name}_normal.png`), encodePNG(tex.width, tex.height, tex.normal, 3))
  }
  console.log('wrote', tex.name, `${tex.width}x${tex.height}`)
}
console.log('done in', Date.now() - t0, 'ms')
