// Procedural, tileable textures for the colosseum. Everything is generated
// from seeded noise so the asset is fully reproducible from source.
import { makeNoise, smoothstep, clamp01 } from './noise.mjs'

function canvas(w, h) {
  return { w, h, rgb: new Float32Array(w * h * 3), height: new Float32Array(w * h) }
}

/** Fill a canvas by calling fn(u, v, x, y, out) per pixel; out = { r, g, b, h }. */
function paint(c, fn) {
  const { w, h, rgb, height } = c
  const out = { r: 0, g: 0, b: 0, h: 0.5 }
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      out.h = 0.5
      fn(u, v, x, y, out)
      const i = y * w + x
      rgb[i * 3] = out.r
      rgb[i * 3 + 1] = out.g
      rgb[i * 3 + 2] = out.b
      height[i] = out.h
    }
  }
  return c
}

function toRGB8(c) {
  const px = new Uint8Array(c.w * c.h * 3)
  for (let i = 0; i < px.length; i++) px[i] = Math.round(clamp01(c.rgb[i]) * 255)
  return px
}

/**
 * Tangent-space normal map from the height channel (glTF / OpenGL convention:
 * green points toward the top of the image). Height is in tile units so
 * `strength` is a plain slope multiplier.
 */
function heightToNormal(c, strength = 1, tile = true) {
  const { w, h, height } = c
  const px = new Uint8Array(w * h * 3)
  const at = (x, y) => {
    if (tile) {
      x = (x + w) % w
      y = (y + h) % h
    } else {
      x = Math.max(0, Math.min(w - 1, x))
      y = Math.max(0, Math.min(h - 1, y))
    }
    return height[y * w + x]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * w * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * h * strength
      let nx = -dx
      let ny = dy // image rows grow downward; +Y (green) is "up" in the image
      let nz = 1
      const len = Math.hypot(nx, ny, nz)
      nx /= len
      ny /= len
      nz /= len
      const i = (y * w + x) * 3
      px[i] = Math.round((nx * 0.5 + 0.5) * 255)
      px[i + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      px[i + 2] = Math.round((nz * 0.5 + 0.5) * 255)
    }
  }
  return px
}

const mix = (a, b, t) => a + (b - a) * t
const hash2 = (a, b, s) => {
  let x = Math.imul((a | 0) * 374761393 + (b | 0) * 668265263 + s * 2246822519, 1)
  x = Math.imul(x ^ (x >>> 13), 1274126177)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

// ---------------------------------------------------------------------------
// Ashlar block masonry (travertine). Tile = 2 m: blocks are 1.0 x 0.5 m.
// ---------------------------------------------------------------------------
export function stoneBlocks(size = 1024) {
  const N = makeNoise(101)
  const c = canvas(size, size)
  const BLOCK_W = 0.5 // in tile units (1.0 m)
  const BLOCK_H = 0.25 // (0.5 m)
  const JOINT = 0.006 // half joint width, tile units (1.2 cm)
  const BEVEL = 0.014
  paint(c, (u, v, x, y, o) => {
    const row = Math.floor(v / BLOCK_H)
    const off = (row % 2) * (BLOCK_W / 2)
    const col = Math.floor((u + off) / BLOCK_W)
    const bu = ((u + off) % BLOCK_W) / BLOCK_W
    const bv = (v % BLOCK_H) / BLOCK_H
    // distance (tile units) to nearest block edge
    const du = Math.min(bu, 1 - bu) * BLOCK_W
    const dv = Math.min(bv, 1 - bv) * BLOCK_H
    const d = Math.min(du, dv)
    const id = hash2(col, row, 7)
    const id2 = hash2(col, row, 13)
    // base travertine with per-block tint
    let r = 0.8
    let g = 0.66
    let b = 0.46
    const tint = 1 + (id - 0.5) * 0.14
    r *= tint * (1 + (id2 - 0.5) * 0.06)
    g *= tint
    b *= tint * (1 - (id2 - 0.5) * 0.08)
    // grain and layered banding
    const grain = N.fbm(u * 16, v * 16, 16, 5)
    const band = N.fbm(u * 3 + id * 5, v * 48, 3, 3, 2, 0.5, 48)
    const mottle = N.fbm(u * 4, v * 4, 4, 3)
    let shade = 1 + grain * 0.08 + band * 0.05 + mottle * 0.05
    // pitting (travertine holes)
    const pit = N.worley(u * 72, v * 72, 72)
    const pitBig = N.worley(u * 22 + 3, v * 22, 22)
    let hgt = 1 + grain * 0.06 + band * 0.02
    if (pit < 0.13) {
      const t = 1 - pit / 0.13
      shade *= 1 - 0.45 * t
      hgt -= 0.5 * t
    }
    if (pitBig < 0.07) {
      const t = 1 - pitBig / 0.07
      shade *= 1 - 0.5 * t
      hgt -= 0.8 * t
    }
    // dirt streaks running down the wall
    const streak = N.fbm(u * 40, v * 2, 40, 3, 2, 0.5, 2)
    shade *= 1 - 0.07 * Math.max(0, streak)
    // joints + bevel
    const bevel = smoothstep(JOINT, JOINT + BEVEL, d)
    hgt *= bevel
    const edgeDark = 0.82 + 0.18 * smoothstep(JOINT, JOINT + BEVEL * 3, d)
    shade *= edgeDark
    if (d < JOINT) {
      const mn = N.fbm(u * 64, v * 64, 64, 3)
      const m = 0.9 + mn * 0.15
      o.r = 0.47 * m
      o.g = 0.37 * m
      o.b = 0.25 * m
      o.h = 0.02 + mn * 0.02
      return
    }
    o.r = r * shade
    o.g = g * shade
    o.b = b * shade
    o.h = hgt * 0.06 // ~6 cm relief across the tile
  })
  return { name: 'stone_blocks', width: size, height: size, rgb: toRGB8(c), normal: heightToNormal(c, 1.0) }
}

// ---------------------------------------------------------------------------
// Smooth travertine slabs (no joints) for arches, cornices, seating, columns.
// ---------------------------------------------------------------------------
export function stoneSmooth(size = 1024) {
  const N = makeNoise(202)
  const c = canvas(size, size)
  paint(c, (u, v, x, y, o) => {
    const r = 0.84
    const g = 0.7
    const b = 0.5
    const grain = N.fbm(u * 24, v * 24, 24, 5)
    const warp = N.fbm(u * 6, v * 6, 6, 3)
    const band = N.fbm(u * 3 + warp * 0.4, v * 40 + warp * 0.8, 3, 4, 2, 0.5, 40)
    const mottle = N.fbm(u * 5 + 2, v * 5, 5, 3)
    let shade = 1 + grain * 0.07 + band * 0.07 + mottle * 0.06
    let hgt = 1 + grain * 0.05 + band * 0.02
    const pit = N.worley(u * 48, v * 96, 48, 96)
    if (pit < 0.16) {
      const t = 1 - pit / 0.16
      shade *= 1 - 0.4 * t * t
      hgt -= 0.45 * t
    }
    const pit2 = N.worley(u * 18 + 5, v * 30, 18, 30)
    if (pit2 < 0.06) {
      const t = 1 - pit2 / 0.06
      shade *= 1 - 0.5 * t
      hgt -= 0.7 * t
    }
    const warmth = N.fbm(u * 2, v * 2, 2, 2)
    o.r = r * shade * (1 + warmth * 0.04)
    o.g = g * shade
    o.b = b * shade * (1 - warmth * 0.05)
    o.h = hgt * 0.03
  })
  return { name: 'stone_smooth', width: size, height: size, rgb: toRGB8(c), normal: heightToNormal(c, 1.0) }
}

// ---------------------------------------------------------------------------
// White marble with grey / warm veins. Tile = 1.5 m.
// ---------------------------------------------------------------------------
export function marble(size = 1024) {
  const N = makeNoise(303)
  const c = canvas(size, size)
  const TAU = Math.PI * 2
  paint(c, (u, v, x, y, o) => {
    const wx = u + 0.12 * N.fbm(u * 3, v * 3, 3, 4)
    const wy = v + 0.12 * N.fbm(u * 3 + 11, v * 3 + 7, 3, 4)
    const f1 = Math.sin(TAU * (wx * 2 + wy * 1) + 2.5 * N.fbm(u * 5 + 3, v * 5 + 9, 5, 3))
    const f2 = Math.sin(TAU * (wx * 1 - wy * 3) + 2.0 * N.fbm(u * 7 + 21, v * 7 + 4, 7, 3))
    const fade1 = smoothstep(-0.35, 0.35, N.fbm(u * 4 + 17, v * 4 + 5, 4, 3))
    const fade2 = smoothstep(-0.2, 0.5, N.fbm(u * 6 + 31, v * 6 + 2, 6, 3))
    const vein1 = (1 - smoothstep(0.008, 0.05, Math.abs(f1))) * (0.35 + 0.65 * fade1)
    const vein2 = (1 - smoothstep(0.006, 0.03, Math.abs(f2))) * fade2
    const cloud = N.fbm(u * 6, v * 6, 6, 4)
    const fine = N.fbm(u * 40, v * 40, 40, 3)
    let r = 0.88 + cloud * 0.03 + fine * 0.015
    let g = 0.79 + cloud * 0.03 + fine * 0.015
    let b = 0.63 + cloud * 0.02 + fine * 0.015
    // warm brown veins
    r = mix(r, 0.56, vein1 * 0.8)
    g = mix(g, 0.45, vein1 * 0.8)
    b = mix(b, 0.33, vein1 * 0.8)
    // lighter secondary veins
    r = mix(r, 0.74, vein2 * 0.6)
    g = mix(g, 0.62, vein2 * 0.6)
    b = mix(b, 0.46, vein2 * 0.6)
    const speck = N.worley(u * 90, v * 90, 90)
    if (speck < 0.05) {
      const t = 1 - speck / 0.05
      r *= 1 - 0.25 * t
      g *= 1 - 0.25 * t
      b *= 1 - 0.22 * t
    }
    o.r = r
    o.g = g
    o.b = b
  })
  return { name: 'marble', width: size, height: size, rgb: toRGB8(c) }
}

// ---------------------------------------------------------------------------
// Woven cloth. Tile = 0.5 m.
// ---------------------------------------------------------------------------
function cloth(size, seed, base, name) {
  const N = makeNoise(seed)
  const c = canvas(size, size)
  const TAU = Math.PI * 2
  paint(c, (u, v, x, y, o) => {
    const weave = Math.sin(TAU * u * 128) * Math.sin(TAU * v * 128)
    const thread = N.fbm(u * 64, v * 64, 64, 3)
    const fold = N.fbm(u * 5, v * 5, 5, 4)
    const shade = 1 + weave * 0.045 + thread * 0.05 + fold * 0.09
    o.r = base[0] * shade
    o.g = base[1] * shade
    o.b = base[2] * shade
  })
  return { name, width: size, height: size, rgb: toRGB8(c) }
}
export const fabricRed = (size = 512) => cloth(size, 404, [0.4, 0.05, 0.07], 'fabric_red')
export const fabricPurple = (size = 512) => cloth(size, 405, [0.34, 0.07, 0.24], 'fabric_purple')

// ---------------------------------------------------------------------------
// Velarium sail cloth: 8 red / cream stripes across U.
// ---------------------------------------------------------------------------
export function awning(size = 512) {
  const N = makeNoise(505)
  const c = canvas(size, size)
  const TAU = Math.PI * 2
  paint(c, (u, v, x, y, o) => {
    const s = u * 8
    const idx = Math.floor(s)
    const fs = s - idx
    const edge = smoothstep(0, 0.02, fs) * (1 - smoothstep(0.98, 1, fs))
    const isRed = idx % 2 === 0
    const t = isRed ? edge : 1 - edge
    const r = mix(0.86, 0.44, t)
    const g = mix(0.76, 0.07, t)
    const b = mix(0.56, 0.09, t)
    const weave = Math.sin(TAU * u * 128) * Math.sin(TAU * v * 128)
    const thread = N.fbm(u * 64, v * 64, 64, 3)
    const fold = N.fbm(u * 3, v * 8, 3, 4, 2, 0.5, 8)
    const shade = 1 + weave * 0.04 + thread * 0.05 + fold * 0.1
    o.r = r * shade
    o.g = g * shade
    o.b = b * shade
  })
  return { name: 'awning', width: size, height: size, rgb: toRGB8(c) }
}

// ---------------------------------------------------------------------------
// Dark oak planks. Tile = 1 m (4 planks).
// ---------------------------------------------------------------------------
export function wood(size = 512) {
  const N = makeNoise(606)
  const c = canvas(size, size)
  const TAU = Math.PI * 2
  paint(c, (u, v, x, y, o) => {
    const plank = Math.floor(u * 4)
    const pu = u * 4 - plank
    const ph = hash2(plank, 0, 3)
    const seam = 1 - smoothstep(0.0, 0.025, Math.min(pu, 1 - pu))
    const n = N.fbm(u * 6 + ph * 9, v * 6, 6, 4, 2, 0.5, 6)
    const rings = 0.5 + 0.5 * Math.sin(TAU * (u * 14 * (1 + ph * 0.3) + 0.35 * n + ph * 7))
    const fine = N.fbm(u * 96, v * 24, 96, 3, 2, 0.5, 24)
    const tint = 0.9 + ph * 0.2
    const r = 0.36 * tint
    const g = 0.22 * tint
    const b = 0.12 * tint
    const shade = (0.78 + 0.3 * rings + fine * 0.08) * (1 - seam * 0.6)
    o.r = r * shade
    o.g = g * shade
    o.b = b * shade
    o.h = (0.5 + 0.35 * rings + fine * 0.1) * (1 - seam) * 0.02
  })
  return { name: 'wood', width: size, height: size, rgb: toRGB8(c), normal: heightToNormal(c, 1.0) }
}

// ---------------------------------------------------------------------------
// Hanging banner (512 x 1024, not tiled): crimson field, gold border, laurel
// wreath around a gold eagle, tasselled fringe.
// ---------------------------------------------------------------------------
export function banner(w = 512, h = 1024) {
  const N = makeNoise(707)
  const c = canvas(w, h)
  const TAU = Math.PI * 2
  const GOLD = [0.88, 0.7, 0.26]
  const GOLD_DARK = [0.62, 0.46, 0.14]
  // shapes are evaluated as signed distances in pixel space (y grows downward)
  const shapes = []
  const ellipse = (cx, cy, rx, ry, rot = 0) => shapes.push({ cx, cy, rx, ry, cos: Math.cos(rot), sin: Math.sin(rot) })
  const cx = w / 2
  const cy = h * 0.44
  // laurel wreath: two branches rising from the bottom knot
  const R = w * 0.31
  for (const side of [-1, 1]) {
    for (let k = 0; k < 11; k++) {
      const a = Math.PI / 2 + side * (0.2 + ((k + 0.5) * (Math.PI * 0.85)) / 11)
      const px = cx + R * Math.cos(a)
      const py = cy + R * Math.sin(a)
      const tangent = a + (side * Math.PI) / 2
      ellipse(px + 7 * Math.cos(a), py + 7 * Math.sin(a), 21, 7.5, tangent + side * 0.45)
      ellipse(px - 8 * Math.cos(a), py - 8 * Math.sin(a), 19, 7, tangent - side * 0.5)
    }
  }
  // ribbon knot at the bottom
  ellipse(cx, cy + R + 4, 18, 9, 0)
  // eagle: body, head, beak, wings, legs, tail
  ellipse(cx, cy + 6, 22, 46, 0)
  ellipse(cx - 12, cy - 44, 13, 12, 0)
  ellipse(cx - 24, cy - 42, 9, 4, -0.3)
  for (const side of [-1, 1]) {
    ellipse(cx + side * 42, cy - 8, 44, 15, side * -0.55)
    ellipse(cx + side * 66, cy - 34, 30, 11, side * -0.95)
    ellipse(cx + side * 30, cy + 10, 30, 12, side * -0.25)
    ellipse(cx + side * 9, cy + 60, 6, 16, side * 0.35)
  }
  ellipse(cx, cy + 62, 16, 22, 0)
  ellipse(cx - 12, cy + 74, 9, 16, -0.4)
  ellipse(cx + 12, cy + 74, 9, 16, 0.4)

  const coverage = (x, y) => {
    let best = -1e9
    for (const s of shapes) {
      const dx = x - s.cx
      const dy = y - s.cy
      const lx = dx * s.cos + dy * s.sin
      const ly = -dx * s.sin + dy * s.cos
      const d = 1 - Math.sqrt((lx * lx) / (s.rx * s.rx) + (ly * ly) / (s.ry * s.ry))
      const dist = d * Math.min(s.rx, s.ry) // approx signed distance in px
      if (dist > best) best = dist
    }
    return clamp01(best + 0.5)
  }

  paint(c, (u, v, x, y, o) => {
    const weave = Math.sin(TAU * u * 96) * Math.sin(TAU * v * 192)
    const thread = N.fbm(u * 48, v * 96, 48, 3, 2, 0.5, 96)
    const fold = N.fbm(u * 3, v * 6, 3, 4, 2, 0.5, 6)
    const shade = 1 + weave * 0.04 + thread * 0.05 + fold * 0.1
    let r = 0.4 * shade
    let g = 0.05 * shade
    let b = 0.07 * shade
    // gold border band + thin inner line
    const inset = Math.min(x, w - 1 - x, y, h - 1 - y)
    const border = smoothstep(27, 29, inset) * (1 - smoothstep(39, 41, inset))
    const line2 = smoothstep(52, 54, inset) * (1 - smoothstep(58, 60, inset))
    const gold = Math.max(border, line2 * 0.9)
    // emblem
    const em = coverage(x, y)
    const emblemShade = 0.85 + 0.3 * N.fbm(u * 24, v * 48, 24, 3, 2, 0.5, 48)
    // fringe at the bottom
    const fringeTop = h * 0.9
    let fringe = 0
    if (y > fringeTop) {
      const tassel = Math.abs(((x + 6) % 14) - 7) < 3.2 ? 1 : 0
      const sag = 1 - smoothstep(h - 6, h - 1, y + 5 * Math.sin(x * 0.4))
      fringe = tassel * sag
      if (!tassel) {
        r = 0.05
        g = 0.03
        b = 0.03
      }
    }
    const goldAmt = clamp01(gold + em + fringe)
    const gr = mix(GOLD_DARK[0], GOLD[0], emblemShade - 0.3)
    const gg = mix(GOLD_DARK[1], GOLD[1], emblemShade - 0.3)
    const gb = mix(GOLD_DARK[2], GOLD[2], emblemShade - 0.3)
    o.r = mix(r, gr, goldAmt)
    o.g = mix(g, gg, goldAmt)
    o.b = mix(b, gb, goldAmt)
  })
  return { name: 'banner', width: w, height: h, rgb: toRGB8(c) }
}

export function generateAll() {
  return [stoneBlocks(), stoneSmooth(), marble(), fabricRed(), fabricPurple(), awning(), wood(), banner()]
}
