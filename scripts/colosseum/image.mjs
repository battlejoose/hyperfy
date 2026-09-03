// Minimal image encoding for the colosseum generator.
// PNG is written with zero dependencies (zlib is built into Node). If `sharp`
// happens to be installed, textures are encoded as WebP instead (much smaller
// GLB, same look) — the game already supports EXT_texture_webp.
import zlib from 'zlib'

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** Encode 8-bit RGB (channels=3) or RGBA (channels=4) pixels as PNG. */
export function encodePNG(width, height, pixels, channels = 3) {
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  const src = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    src.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = channels === 4 ? 6 : 2 // color type
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let sharpModule = null
let sharpChecked = false
async function getSharp() {
  if (sharpChecked) return sharpModule
  sharpChecked = true
  try {
    sharpModule = (await import('sharp')).default
  } catch {
    sharpModule = null
  }
  return sharpModule
}

/**
 * Encode a texture. Returns { data, mimeType }.
 * quality: WebP quality (ignored for PNG). lossless: force lossless WebP (normal maps).
 */
export async function encodeTexture(width, height, pixels, channels = 3, { quality = 88, lossless = false } = {}) {
  const sharp = await getSharp()
  if (sharp) {
    const data = await sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), {
      raw: { width, height, channels },
    })
      .webp(lossless ? { lossless: true, effort: 6 } : { quality, effort: 6 })
      .toBuffer()
    return { data, mimeType: 'image/webp' }
  }
  return { data: encodePNG(width, height, pixels, channels), mimeType: 'image/png' }
}
