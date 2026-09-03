// Seeded, tileable noise primitives for procedural textures.

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fade = t => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a, b, t) => a + (b - a) * t
export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/**
 * Perlin-style gradient noise on an integer lattice. `period` (integer) makes
 * the field tile: noise(x + period, y) === noise(x, y).
 */
export function makeNoise(seed) {
  const rng = mulberry32(seed)
  const perm = new Uint16Array(512)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const gx = new Float32Array(256)
  const gy = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const a = rng() * Math.PI * 2
    gx[i] = Math.cos(a)
    gy[i] = Math.sin(a)
  }
  const hash = (i, j, periodX, periodY) => {
    i = ((i % periodX) + periodX) % periodX
    j = ((j % periodY) + periodY) % periodY
    return perm[(perm[i & 255] + j) & 255]
  }
  /** periodY defaults to periodX. Periods are in lattice cells. */
  function noise(x, y, period = 256, periodY = period) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = fade(xf)
    const v = fade(yf)
    const h00 = hash(xi, yi, period, periodY)
    const h10 = hash(xi + 1, yi, period, periodY)
    const h01 = hash(xi, yi + 1, period, periodY)
    const h11 = hash(xi + 1, yi + 1, period, periodY)
    const n00 = gx[h00] * xf + gy[h00] * yf
    const n10 = gx[h10] * (xf - 1) + gy[h10] * yf
    const n01 = gx[h01] * xf + gy[h01] * (yf - 1)
    const n11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1)
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.41 // ~[-1, 1]
  }
  /** Fractal sum, tileable when `period` is an integer. Returns ~[-1, 1]. */
  function fbm(x, y, period, octaves = 5, lacunarity = 2, gain = 0.5, periodY = period) {
    let amp = 1
    let sum = 0
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x, y, period, periodY)
      norm += amp
      x *= lacunarity
      y *= lacunarity
      period *= lacunarity
      periodY *= lacunarity
      amp *= gain
    }
    return sum / norm
  }
  /** Ridged variant (creases), [0, 1]. */
  function ridged(x, y, period, octaves = 4) {
    let amp = 0.5
    let sum = 0
    for (let o = 0; o < octaves; o++) {
      sum += amp * (1 - Math.abs(noise(x, y, period)))
      x *= 2
      y *= 2
      period *= 2
      amp *= 0.5
    }
    return sum
  }
  /**
   * Tileable cellular (Worley) noise. Returns the distance to the nearest
   * feature point (in lattice units). `period` cells per tile.
   */
  function worley(x, y, period, periodY = period) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    let best = 9
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = xi + i
        const cy = yi + j
        const h = hash(cx, cy, period, periodY)
        const h2 = hash(cx + 37, cy + 91, period, periodY)
        const px = cx + h / 255
        const py = cy + h2 / 255
        const dx = px - x
        const dy = py - y
        const d = dx * dx + dy * dy
        if (d < best) best = d
      }
    }
    return Math.sqrt(best)
  }
  return { noise, fbm, ridged, worley, rng }
}
