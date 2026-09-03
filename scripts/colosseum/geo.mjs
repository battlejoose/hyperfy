// Geometry helpers for the colosseum generator. All output is plain
// BufferGeometry with position / normal / uv attributes and an index.
//
// Conventions
//   - Units are meters, Y is up.
//   - "Gameplay angle" phi: a point at radius r sits at (r cos phi, y, r sin phi).
//     This matches arenaCrowd.js / arenaGeneral.js which use atan2(z, x).
//   - Flat modules are authored with X tangential, Y up, Z radially outward
//     and are wrapped around a radius with bend(). A bent module is placed by
//     rotating it about Y by (PI/2 - phi_center) — see rotYForPhi().
//   - UVs are authored in glTF space (v = 0 is the top of the image). For
//     tileable textures the direction is irrelevant; for the banner it isn't.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const DEG = Math.PI / 180
export const TAU = Math.PI * 2

/** Node rotation (about Y) that points a module's local +Z outward at gameplay angle phi (radians). */
export const rotYForPhi = phi => Math.PI / 2 - phi

export function quatY(angle) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle).toArray()
}

/** Position on the arena circle. */
export const polar = (r, phi, y = 0) => [r * Math.cos(phi), y, r * Math.sin(phi)]

// ---------------------------------------------------------------------------
// Attribute plumbing
// ---------------------------------------------------------------------------

export function makeGeometry(positions, normals, uvs, indices) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  return g
}

/** Merge geometries (drops groups). Null / empty entries are ignored. */
export function merge(list) {
  const geoms = list.filter(g => g && g.attributes.position && g.attributes.position.count > 0)
  if (!geoms.length) return null
  for (const g of geoms) {
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()])
    if (!g.attributes.normal) g.computeVertexNormals()
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name)
    }
  }
  if (geoms.length === 1) return geoms[0]
  const out = mergeGeometries(geoms, false)
  if (!out) throw new Error('mergeGeometries failed')
  return out
}

/** Multiply all UVs by a factor (e.g. 1 / tile size). */
export function scaleUV(g, su, sv = su) {
  const uv = g.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
  return g
}

export function offsetUV(g, du, dv) {
  const uv = g.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv)
  return g
}

/**
 * Planar "box" UVs in meters, picked per vertex from the dominant normal axis.
 * Good for boxes and any mostly axis-aligned solid.
 */
export function metricUV(g, tile = 2) {
  const pos = g.attributes.position
  const nor = g.attributes.normal
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const nx = Math.abs(nor.getX(i))
    const ny = Math.abs(nor.getY(i))
    const nz = Math.abs(nor.getZ(i))
    let u
    let v
    if (ny >= nx && ny >= nz) {
      u = x
      v = z
    } else if (nx >= nz) {
      u = z
      v = -y
    } else {
      u = x
      v = -y
    }
    uv[i * 2] = u / tile
    uv[i * 2 + 1] = v / tile
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return g
}

/**
 * Flip triangles whose geometric normal disagrees with the stored vertex
 * normals. Lets the builders focus on normals and not on winding order.
 */
export function orientFaces(g) {
  const pos = g.attributes.position
  const nor = g.attributes.normal
  const idx = g.index.array
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const vn = new THREE.Vector3()
  for (let i = 0; i < idx.length; i += 3) {
    const i0 = idx[i]
    const i1 = idx[i + 1]
    const i2 = idx[i + 2]
    a.fromBufferAttribute(pos, i0)
    b.fromBufferAttribute(pos, i1)
    c.fromBufferAttribute(pos, i2)
    n.subVectors(b, a).cross(c.clone().sub(a))
    vn.set(
      nor.getX(i0) + nor.getX(i1) + nor.getX(i2),
      nor.getY(i0) + nor.getY(i1) + nor.getY(i2),
      nor.getZ(i0) + nor.getZ(i1) + nor.getZ(i2)
    )
    if (n.dot(vn) < 0) {
      idx[i + 1] = i2
      idx[i + 2] = i1
    }
  }
  return g
}

/** Mirror a geometry in Z (front/back), keeping normals and winding valid. */
export function mirrorZ(g) {
  const pos = g.attributes.position
  const nor = g.attributes.normal
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, -pos.getZ(i))
    nor.setZ(i, -nor.getZ(i))
  }
  return orientFaces(g)
}

export function mirrorX(g) {
  const pos = g.attributes.position
  const nor = g.attributes.normal
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, -pos.getX(i))
    nor.setX(i, -nor.getX(i))
  }
  return orientFaces(g)
}

/**
 * Wrap a flat module around the cylinder of radius R. Local X becomes the
 * angle (x / R), local Z the radial offset. Output is centered on +Z.
 */
export function bend(g, R) {
  const pos = g.attributes.position
  const nor = g.attributes.normal
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const theta = x / R
    const rho = R + z
    const s = Math.sin(theta)
    const c = Math.cos(theta)
    pos.setXYZ(i, rho * s, y, rho * c)
    const nx = nor.getX(i)
    const ny = nor.getY(i)
    const nz = nor.getZ(i)
    nor.setXYZ(i, nx * c + nz * s, ny, -nx * s + nz * c)
  }
  g.computeBoundingBox()
  return g
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Axis-aligned box; origin at the bottom center unless `center` is set. */
export function box(w, h, d, { x = 0, y = 0, z = 0, tile = 2, center = false } = {}) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, center ? y : y + h / 2, z)
  metricUV(g, tile)
  return g
}

/**
 * Surface of revolution with hard or auto-smoothed edges between profile
 * segments. Profile points are { r, y }. Normals face "inward" (toward the
 * axis / up) for interior surfaces, or outward when `outward` is true.
 *
 * arc: [startDeg, endDeg] in gameplay degrees. skip: [{ a, b, cap }] arcs
 * (degrees) where no quads are emitted; with cap=true a vertical wall is
 * added closing the profile at both ends of the gap (down to `capBaseY`).
 */
export function sweep({
  profile,
  segments = 180,
  arc = [0, 360],
  skip = [],
  tile = 2,
  outward = false,
  smoothAngle = 40,
  capBaseY = null,
  uOffset = 0,
  vOffset = 0,
  closeProfile = false,
}) {
  const pts = profile.map(p => ({ r: p.r, y: p.y }))
  if (closeProfile) pts.push({ ...pts[0] })
  const nSeg = pts.length - 1
  // per profile segment normals (2D, in the r/y plane)
  const segN = []
  for (let j = 0; j < nSeg; j++) {
    const dr = pts[j + 1].r - pts[j].r
    const dy = pts[j + 1].y - pts[j].y
    const len = Math.hypot(dr, dy) || 1
    let nr = -dy / len
    let ny = dr / len
    if (outward) {
      nr = -nr
      ny = -ny
    }
    segN.push({ nr, ny })
  }
  // vertex normals at profile points: smooth across small angle changes
  const cosT = Math.cos(smoothAngle * DEG)
  const startN = [] // normal used at the start point of segment j
  const endN = [] // normal used at the end point of segment j
  for (let j = 0; j < nSeg; j++) {
    const prev = j > 0 ? segN[j - 1] : null
    const next = j < nSeg - 1 ? segN[j + 1] : null
    const cur = segN[j]
    const avg = (a, b) => {
      const nr = a.nr + b.nr
      const ny = a.ny + b.ny
      const l = Math.hypot(nr, ny) || 1
      return { nr: nr / l, ny: ny / l }
    }
    startN.push(prev && prev.nr * cur.nr + prev.ny * cur.ny > cosT ? avg(prev, cur) : cur)
    endN.push(next && next.nr * cur.nr + next.ny * cur.ny > cosT ? avg(next, cur) : cur)
  }
  // cumulative profile length for V
  const vAt = [0]
  for (let j = 0; j < nSeg; j++) {
    vAt.push(vAt[j] + Math.hypot(pts[j + 1].r - pts[j].r, pts[j + 1].y - pts[j].y))
  }
  const a0 = arc[0] * DEG
  const a1 = arc[1] * DEG
  const step = (a1 - a0) / segments
  const norm = d => ((d % 360) + 360) % 360
  const inSkip = deg => {
    const d = norm(deg)
    for (const s of skip) {
      const a = norm(s.a)
      const b = norm(s.b)
      if (a <= b ? d > a && d < b : d > a || d < b) return s
    }
    return null
  }
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  for (let j = 0; j < nSeg; j++) {
    const p0 = pts[j]
    const p1 = pts[j + 1]
    const rMid = (p0.r + p1.r) / 2
    const base = positions.length / 3
    for (let i = 0; i <= segments; i++) {
      const ang = a0 + i * step
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      const u = (ang * rMid) / tile + uOffset
      positions.push(p0.r * c, p0.y, p0.r * s, p1.r * c, p1.y, p1.r * s)
      normals.push(startN[j].nr * c, startN[j].ny, startN[j].nr * s, endN[j].nr * c, endN[j].ny, endN[j].nr * s)
      uvs.push(u, vAt[j] / tile + vOffset, u, vAt[j + 1] / tile + vOffset)
    }
    for (let i = 0; i < segments; i++) {
      const mid = (a0 + (i + 0.5) * step) / DEG
      if (inSkip(mid)) continue
      const k = base + i * 2
      indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
    }
  }
  const g = makeGeometry(positions, normals, uvs, indices)
  orientFaces(g)
  // end caps for skipped arcs
  const caps = []
  for (const s of skip) {
    if (!s.cap) continue
    const baseY = capBaseY ?? Math.min(...pts.map(p => p.y))
    for (const [deg, facing] of [
      [s.a, 1],
      [s.b, -1],
    ]) {
      caps.push(radialCap(pts, deg, baseY, facing, tile))
    }
  }
  return caps.length ? merge([g, ...caps]) : g
}

/**
 * Vertical planar polygon in the radial plane at `deg`, bounded by the profile
 * on top and y = baseY below. `facing` +1 => normal points toward increasing
 * angle, -1 => decreasing.
 */
function radialCap(pts, deg, baseY, facing, tile) {
  const ang = deg * DEG
  const contour = pts.map(p => new THREE.Vector2(p.r, p.y))
  const last = pts[pts.length - 1]
  const first = pts[0]
  contour.push(new THREE.Vector2(last.r, baseY))
  contour.push(new THREE.Vector2(first.r, baseY))
  const tris = THREE.ShapeUtils.triangulateShape(contour, [])
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  // tangential direction (increasing angle)
  const tx = -s
  const tz = c
  const positions = []
  const normals = []
  const uvs = []
  for (const p of contour) {
    positions.push(p.x * c, p.y, p.x * s)
    normals.push(tx * facing, 0, tz * facing)
    uvs.push(p.x / tile, -p.y / tile)
  }
  const indices = []
  for (const t of tris) indices.push(t[0], t[1], t[2])
  return orientFaces(makeGeometry(positions, normals, uvs, indices))
}

/** Lathe around a local vertical axis at the origin (uses sweep). */
export function lathe(profile, segments = 24, opts = {}) {
  return sweep({ profile, segments, outward: true, smoothAngle: 60, tile: opts.tile ?? 1, ...opts })
}

/** Planar polygon in the XY plane at depth z. Contour is [[x, y], ...]. */
export function polygon(contour, z = 0, { normalZ = 1, tile = 2, holes = [] } = {}) {
  const pts = contour.map(p => new THREE.Vector2(p[0], p[1]))
  const holePts = holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])))
  const tris = THREE.ShapeUtils.triangulateShape(pts, holePts)
  const all = [...pts, ...holePts.flat()]
  const positions = []
  const normals = []
  const uvs = []
  for (const p of all) {
    positions.push(p.x, p.y, z)
    normals.push(0, 0, normalZ)
    uvs.push(p.x / tile, -p.y / tile)
  }
  const indices = []
  for (const t of tris) indices.push(t[0], t[1], t[2])
  return orientFaces(makeGeometry(positions, normals, uvs, indices))
}

/**
 * Quads extruded along Z between z0 and z1 following a 2D path [[x, y], ...].
 * Normals point toward `toward` ([x, y]) — e.g. the center of an opening.
 */
export function strip(path, z0, z1, toward, tile = 2, { away = false } = {}) {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  let u = 0
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, y0] = path[i]
    const [x1, y1] = path[i + 1]
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy) || 1
    let nx = -dy / len
    let ny = dx / len
    const mx = (x0 + x1) / 2
    const my = (y0 + y1) / 2
    const dot = nx * (toward[0] - mx) + ny * (toward[1] - my)
    if ((dot < 0) !== away) {
      nx = -nx
      ny = -ny
    }
    const base = positions.length / 3
    positions.push(x0, y0, z0, x1, y1, z0, x0, y0, z1, x1, y1, z1)
    for (let k = 0; k < 4; k++) normals.push(nx, ny, 0)
    uvs.push(u / tile, z0 / tile, (u + len) / tile, z0 / tile, u / tile, z1 / tile, (u + len) / tile, z1 / tile)
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
    u += len
  }
  return orientFaces(makeGeometry(positions, normals, uvs, indices))
}

/** Points along a semicircular arch from left jamb top to right jamb top (over the top). */
export function archPath(a, s, n = 16, extraJamb = 0) {
  const path = []
  if (extraJamb > 0) path.push([-a, s - extraJamb])
  for (let i = 0; i <= n; i++) {
    const t = Math.PI - (i / n) * Math.PI
    path.push([a * Math.cos(t), s + a * Math.sin(t)])
  }
  if (extraJamb > 0) path.push([a, s - extraJamb])
  return path
}

/**
 * Wall slab with an arched opening. Authored with the front face at z = 0 and
 * the wall extending to z = -t (front normal +Z). Returns { wall, back } where
 * `back` is a dark plane closing the opening at depth `backDepth`.
 *
 *  w, h   slab width / height     a, s   half arch width, springing height
 *  t      slab thickness          facing 'out' (default) or 'in' (mirrored in Z)
 */
export function archWall({
  w,
  h,
  t,
  a,
  s,
  n = 18,
  tile = 2,
  facing = 'out',
  back = true,
  backDepth = null,
  top = false,
  bottom = false,
  keystone = true,
  imposts = true,
  floor = false,
  uvOffset = [0, 0],
}) {
  const parts = []
  const arch = archPath(a, s, n)
  if (floor) parts.push(box(2 * a + 0.1, 0.001, t, { x: 0, y: -0.0005, z: -t / 2, tile }))
  // front face: simple polygon (opening touches the bottom edge)
  const contour = [[-w / 2, 0], [-a, 0], [-a, s], ...arch.slice(1, -1), [a, s], [a, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]]
  const face = polygon(contour, 0, { normalZ: 1, tile })
  offsetUV(face, uvOffset[0], uvOffset[1])
  parts.push(face)
  // soffit / reveals
  const reveal = [[-a, 0], [-a, s], ...arch.slice(1, -1), [a, s], [a, 0]]
  parts.push(strip(reveal, 0, -t, [0, s * 0.5], tile))
  if (top) parts.push(box(w, 0.001, t, { x: 0, y: h - 0.0005, z: -t / 2, tile }))
  if (keystone) {
    const kw = a * 0.32
    const kh = a * 0.55
    parts.push(box(kw, kh, 0.14, { x: 0, y: s + a - kh * 0.45, z: 0.07 - 0.001, tile }))
  }
  if (imposts) {
    const iw = a * 0.42
    for (const side of [-1, 1]) {
      parts.push(box(iw, 0.14, 0.16, { x: side * (a + iw / 2 - 0.02), y: s - 0.14, z: 0.08 - 0.001, tile }))
    }
  }
  let wall = merge(parts)
  let backPlane = null
  if (back) {
    const depth = backDepth ?? t
    const bc = [[-a - 0.05, 0], [a + 0.05, 0], [a + 0.05, s + a + 0.05], [-a - 0.05, s + a + 0.05]]
    backPlane = polygon(bc, -depth, { normalZ: 1, tile })
  }
  if (facing === 'in') {
    wall = mirrorZ(wall)
    if (backPlane) backPlane = mirrorZ(backPlane)
  }
  return { wall, back: backPlane }
}

/** Triangular gable prism: base width w, rise, depth d (z from 0 to -d). Origin at the base center. */
export function pediment(w, rise, d, { x = 0, y = 0, z = 0, tile = 2, overhang = 0.12 } = {}) {
  const hw = w / 2
  const tri = [[-hw, 0], [hw, 0], [0, rise]]
  const front = polygon(tri, 0, { normalZ: 1, tile })
  const backF = polygon(tri, -d, { normalZ: -1, tile })
  // sloped roof faces
  const slopes = strip([[-hw - overhang, -overhang * (rise / hw)], [0, rise + 0.02], [hw + overhang, -overhang * (rise / hw)]], 0.05, -d - 0.05, [0, -1], tile, { away: true })
  const g = merge([front, backF, slopes])
  g.translate(x, y, z)
  return g
}

export function cylinder(rTop, rBottom, h, segments = 24, { x = 0, y = 0, z = 0, tile = 1, open = false } = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, open)
  g.translate(x, y + h / 2, z)
  const uv = g.attributes.uv
  const circ = Math.PI * (rTop + rBottom)
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * h) / tile)
  return g
}

export function sphere(r, segs = 16, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const g = new THREE.SphereGeometry(r, segs, Math.max(8, segs / 2))
  g.scale(sx, sy, sz)
  g.translate(x, y, z)
  return g
}

/** Horizontal torus (ring lying flat), center at the origin. */
export function torus(R, r, segs = 24, tube = 10, { x = 0, y = 0, z = 0 } = {}) {
  const g = new THREE.TorusGeometry(R, r, tube, segs)
  g.rotateX(Math.PI / 2)
  g.translate(x, y, z)
  return g
}

/** Simple sagging cloth panel between four corners (grid nu x nv). Double-sided material expected. */
export function clothPanel(corner00, corner10, corner01, corner11, nu, nv, sag, uvScale = [1, 1]) {
  const positions = []
  const uvs = []
  const indices = []
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  for (let j = 0; j <= nv; j++) {
    const v = j / nv
    const left = lerp3(corner00, corner01, v)
    const right = lerp3(corner10, corner11, v)
    for (let i = 0; i <= nu; i++) {
      const u = i / nu
      const p = lerp3(left, right, u)
      const droop = sag * Math.sin(Math.PI * v) * Math.sqrt(Math.sin(Math.PI * u))
      positions.push(p[0], p[1] - droop, p[2])
      uvs.push(u * uvScale[0], v * uvScale[1])
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const k = j * (nu + 1) + i
      indices.push(k, k + 1, k + nu + 1, k + 1, k + nu + 2, k + nu + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

// ---------------------------------------------------------------------------
// Architectural parts
// ---------------------------------------------------------------------------

/**
 * Classical column, origin at the bottom center. Returns { shaft, capital }
 * geometries (both stone/marble, split so capitals can be simpler meshes).
 *  order: 'tuscan' | 'ionic' | 'corinthian'
 *  half: true builds an engaged half column (front half, +Z), for facades.
 */
export function column({ r, h, order = 'tuscan', fluted = false, half = false, segments = 24, tile = 1.5 }) {
  const parts = []
  const baseH = r * 0.5
  const capH = order === 'corinthian' ? r * 2.2 : order === 'ionic' ? r * 1.2 : r * 0.9
  const shaftH = h - baseH - capH
  const rTop = r * 0.84
  // base: plinth + torus
  parts.push(box(r * 2.5, baseH * 0.45, r * 2.5, { y: 0, tile }))
  parts.push(
    lathe(
      [
        { r: r * 1.22, y: baseH * 0.45 },
        { r: r * 1.32, y: baseH * 0.62 },
        { r: r * 1.22, y: baseH * 0.82 },
        { r: r * 1.03, y: baseH * 0.95 },
        { r: r * 1.0, y: baseH },
      ],
      segments,
      { tile }
    )
  )
  // shaft (with optional flutes)
  const shaft = new THREE.CylinderGeometry(rTop, r, shaftH, fluted ? 48 : segments, fluted ? 6 : 1, true)
  shaft.translate(0, baseH + shaftH / 2, 0)
  if (fluted) {
    const pos = shaft.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const y = pos.getY(i)
      const ang = Math.atan2(x, z)
      const rr = Math.hypot(x, z)
      // 24 flutes, deepest at the flute centers
      const flute = 0.5 + 0.5 * Math.cos(ang * 24)
      // keep the top / bottom of the shaft plain
      const tt = (y - baseH) / shaftH
      const fade = Math.min(1, Math.min(tt, 1 - tt) * 12)
      const nr = rr - rr * 0.06 * flute * fade
      pos.setX(i, (x / rr) * nr)
      pos.setZ(i, (z / rr) * nr)
    }
    shaft.computeVertexNormals()
  }
  {
    const uv = shaft.attributes.uv
    const circ = TAU * r
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * shaftH) / tile)
  }
  parts.push(shaft)
  // astragal (small ring) under the capital
  parts.push(torus(rTop * 1.02, r * 0.06, segments, 6, { y: baseH + shaftH - r * 0.05 }))
  // capital
  const capY = baseH + shaftH
  const cap = []
  if (order === 'tuscan') {
    cap.push(
      lathe(
        [
          { r: rTop, y: capY },
          { r: rTop * 1.05, y: capY + capH * 0.3 },
          { r: rTop * 1.35, y: capY + capH * 0.55 },
          { r: rTop * 1.38, y: capY + capH * 0.62 },
        ],
        segments,
        { tile }
      )
    )
    cap.push(box(rTop * 2.9, capH * 0.38, rTop * 2.9, { y: capY + capH * 0.62, tile }))
  } else if (order === 'ionic') {
    cap.push(
      lathe(
        [
          { r: rTop, y: capY },
          { r: rTop * 1.15, y: capY + capH * 0.25 },
          { r: rTop * 1.2, y: capY + capH * 0.4 },
        ],
        segments,
        { tile }
      )
    )
    cap.push(box(rTop * 2.6, capH * 0.28, rTop * 1.6, { y: capY + capH * 0.4, tile }))
    // volutes: a scroll on each side
    for (const side of [-1, 1]) {
      const vol = new THREE.TorusGeometry(rTop * 0.42, rTop * 0.2, 8, 16)
      vol.translate(side * rTop * 1.3, capY + capH * 0.5, 0)
      cap.push(vol)
    }
    cap.push(box(rTop * 2.9, capH * 0.28, rTop * 2.4, { y: capY + capH * 0.72, tile }))
  } else {
    // corinthian: bell + two rows of leaves + abacus
    cap.push(
      lathe(
        [
          { r: rTop, y: capY },
          { r: rTop * 1.05, y: capY + capH * 0.35 },
          { r: rTop * 1.3, y: capY + capH * 0.7 },
          { r: rTop * 1.55, y: capY + capH * 0.86 },
          { r: rTop * 1.45, y: capY + capH * 0.88 },
        ],
        segments,
        { tile }
      )
    )
    for (let row = 0; row < 2; row++) {
      const count = 8
      const ly = capY + capH * (row === 0 ? 0.28 : 0.55)
      const lr = rTop * (row === 0 ? 1.12 : 1.28)
      for (let k = 0; k < count; k++) {
        const ang = ((k + row * 0.5) / count) * TAU
        const leaf = new THREE.SphereGeometry(rTop * 0.38, 8, 6)
        leaf.scale(1, 1.7, 0.45)
        leaf.rotateX(-0.55)
        leaf.rotateY(ang)
        leaf.translate(Math.sin(ang) * lr, ly, Math.cos(ang) * lr)
        cap.push(leaf)
      }
    }
    cap.push(box(rTop * 3.1, capH * 0.12, rTop * 3.1, { y: capY + capH * 0.88, tile }))
  }
  let shaftG = merge(parts)
  let capG = merge(cap)
  if (half) {
    shaftG = clipHalf(shaftG)
    capG = clipHalf(capG)
  }
  return { shaft: shaftG, capital: capG, capH, baseH }
}

/** Drop every triangle that lies entirely behind z <= 0 (keeps the front half of an engaged column). */
function clipHalf(g) {
  const pos = g.attributes.position
  const idx = g.index.array
  const keep = []
  for (let i = 0; i < idx.length; i += 3) {
    let behind = 0
    for (let k = 0; k < 3; k++) if (pos.getZ(idx[i + k]) < -0.02) behind++
    if (behind < 3) keep.push(idx[i], idx[i + 1], idx[i + 2])
  }
  g.setIndex(keep)
  return g
}

/** Marble baluster, origin at the bottom center. */
export function baluster(h, r = 0.055) {
  return lathe(
    [
      { r: r * 1.6, y: 0 },
      { r: r * 1.6, y: h * 0.06 },
      { r: r * 0.9, y: h * 0.1 },
      { r: r * 1.5, y: h * 0.28 },
      { r: r * 1.0, y: h * 0.5 },
      { r: r * 0.75, y: h * 0.72 },
      { r: r * 0.85, y: h * 0.86 },
      { r: r * 1.5, y: h * 0.92 },
      { r: r * 1.5, y: h },
    ],
    12,
    { tile: 0.5, smoothAngle: 70 }
  )
}

/**
 * Stylized statue, origin at the plinth bottom, faces -Z. ~h meters tall.
 *  variant 0: toga-clad orator with a raised arm
 *  variant 1: legionary with helmet crest, scutum shield and spear
 */
export function figure(h = 1.9, variant = 0) {
  const s = h / 1.9
  const parts = []
  parts.push(box(0.8 * s, 0.14 * s, 0.8 * s, { tile: 1 }))
  const y0 = 0.14 * s
  const limb = (x, y, z, rx, rz, len, r0 = 0.05, r1 = 0.06) => {
    const g = new THREE.CylinderGeometry(r0 * s, r1 * s, len, 10)
    g.translate(0, -len / 2, 0)
    g.rotateX(rx)
    g.rotateZ(rz)
    g.translate(x, y, z)
    return g
  }
  if (variant === 0) {
    const robe = [
      { r: 0.36, y: 0 },
      { r: 0.35, y: 0.05 },
      { r: 0.24, y: 0.55 },
      { r: 0.2, y: 1.0 },
      { r: 0.22, y: 1.2 },
      { r: 0.27, y: 1.38 },
      { r: 0.3, y: 1.47 },
      { r: 0.24, y: 1.53 },
      { r: 0.09, y: 1.56 },
      { r: 0.07, y: 1.62 },
    ].map(p => ({ r: p.r * s, y: p.y * s + y0 }))
    const robeG = lathe(robe, 18, { tile: 1, smoothAngle: 75 })
    robeG.scale(1, 1, 0.8)
    parts.push(robeG)
    parts.push(sphere(0.105 * s, 14, { y: y0 + 1.72 * s, sy: 1.15 }))
    // hair cap
    parts.push(sphere(0.11 * s, 12, { y: y0 + 1.76 * s, z: 0.01 * s, sy: 0.7 }))
    // raised right arm, left arm holding a scroll
    parts.push(limb(0.22 * s, y0 + 1.48 * s, -0.02 * s, -0.4, -2.2, 0.36 * s))
    parts.push(limb(0.5 * s, y0 + 1.72 * s, -0.12 * s, -0.9, -0.6, 0.32 * s, 0.04, 0.045))
    parts.push(limb(-0.25 * s, y0 + 1.46 * s, -0.04 * s, -1.3, 0.5, 0.4 * s))
    const scroll = new THREE.CylinderGeometry(0.035 * s, 0.035 * s, 0.3 * s, 8)
    scroll.rotateX(Math.PI / 2)
    scroll.translate(-0.12 * s, y0 + 1.2 * s, -0.24 * s)
    parts.push(scroll)
  } else {
    // legs + boots
    for (const side of [-1, 1]) {
      parts.push(limb(side * 0.11 * s, y0 + 0.78 * s, 0, 0.05 * side, 0.03 * side, 0.78 * s, 0.075, 0.085))
      parts.push(box(0.16 * s, 0.1 * s, 0.28 * s, { x: side * 0.12 * s, y: y0, z: -0.04 * s, tile: 1 }))
    }
    // tunic (pleated skirt) + cuirass torso
    const tunic = lathe(
      [
        { r: 0.24, y: 0.62 },
        { r: 0.22, y: 0.7 },
        { r: 0.2, y: 0.88 },
        { r: 0.2, y: 0.95 },
      ].map(p => ({ r: p.r * s, y: p.y * s + y0 })),
      16,
      { tile: 1, smoothAngle: 75 }
    )
    parts.push(tunic)
    const torso = lathe(
      [
        { r: 0.19, y: 0.92 },
        { r: 0.22, y: 1.1 },
        { r: 0.25, y: 1.32 },
        { r: 0.27, y: 1.44 },
        { r: 0.29, y: 1.5 },
        { r: 0.2, y: 1.56 },
        { r: 0.085, y: 1.58 },
        { r: 0.075, y: 1.66 },
      ].map(p => ({ r: p.r * s, y: p.y * s + y0 })),
      16,
      { tile: 1, smoothAngle: 75 }
    )
    torso.scale(1, 1, 0.72)
    parts.push(torso)
    // head + helmet + crest
    parts.push(sphere(0.105 * s, 14, { y: y0 + 1.75 * s, sy: 1.1 }))
    parts.push(sphere(0.125 * s, 14, { y: y0 + 1.8 * s, sy: 0.85 }))
    const crest = box(0.05 * s, 0.14 * s, 0.34 * s, { y: y0 + 1.86 * s, z: 0.02 * s, tile: 1 })
    parts.push(crest)
    // cheek guards
    parts.push(box(0.24 * s, 0.12 * s, 0.04 * s, { y: y0 + 1.68 * s, z: -0.1 * s, tile: 1 }))
    // right arm with spear, left arm behind the shield
    parts.push(limb(0.27 * s, y0 + 1.5 * s, 0, -0.3, -0.35, 0.42 * s))
    parts.push(limb(0.4 * s, y0 + 1.15 * s, -0.12 * s, -1.1, 0.2, 0.3 * s, 0.045, 0.05))
    const spear = new THREE.CylinderGeometry(0.018 * s, 0.018 * s, 2.3 * s, 8)
    spear.translate(0.45 * s, y0 + 1.15 * s, -0.3 * s)
    parts.push(spear)
    const tip = new THREE.ConeGeometry(0.04 * s, 0.22 * s, 8)
    tip.translate(0.45 * s, y0 + 2.4 * s, -0.3 * s)
    parts.push(tip)
    parts.push(limb(-0.27 * s, y0 + 1.5 * s, 0, -0.9, 0.4, 0.4 * s))
    // curved scutum shield
    const shield = new THREE.CylinderGeometry(0.42 * s, 0.42 * s, 0.95 * s, 12, 1, true, -0.55, 1.1)
    shield.translate(-0.3 * s, y0 + 1.05 * s, 0.1 * s)
    parts.push(shield)
    const boss = sphere(0.07 * s, 10, { x: -0.3 * s, y: y0 + 1.05 * s, z: -0.34 * s, sz: 0.6 })
    parts.push(boss)
    // cloak down the back
    const cloak = lathe(
      [
        { r: 0.26, y: 0.9 },
        { r: 0.3, y: 1.2 },
        { r: 0.28, y: 1.5 },
      ].map(p => ({ r: p.r * s, y: p.y * s + y0 })),
      12,
      { tile: 1, arc: [20, 160], smoothAngle: 75 }
    )
    cloak.scale(1, 1, 1)
    parts.push(cloak)
  }
  return merge(parts)
}

/** Gold aquila (eagle) with spread wings, origin at the base of the body. */
export function eagle(scale = 1) {
  const s = scale
  const parts = []
  parts.push(sphere(0.12 * s, 12, { y: 0.22 * s, sx: 0.8, sy: 1.6, sz: 0.7 }))
  parts.push(sphere(0.075 * s, 10, { y: 0.48 * s, z: -0.05 * s }))
  const beak = new THREE.ConeGeometry(0.03 * s, 0.09 * s, 6)
  beak.rotateX(-Math.PI / 2)
  beak.translate(0, 0.47 * s, -0.13 * s)
  parts.push(beak)
  for (const side of [-1, 1]) {
    const wing = new THREE.BoxGeometry(0.5 * s, 0.03 * s, 0.22 * s)
    wing.translate(side * 0.3 * s, 0, 0)
    wing.rotateZ(side * 0.55)
    wing.translate(side * 0.06 * s, 0.3 * s, 0.02 * s)
    parts.push(wing)
    const tip = new THREE.BoxGeometry(0.28 * s, 0.025 * s, 0.16 * s)
    tip.translate(side * 0.14 * s, 0, 0)
    tip.rotateZ(side * 1.1)
    tip.translate(side * 0.5 * s, 0.56 * s, 0.03 * s)
    parts.push(tip)
  }
  const tail = new THREE.BoxGeometry(0.16 * s, 0.02 * s, 0.2 * s)
  tail.translate(0, 0.04 * s, 0.1 * s)
  parts.push(tail)
  return merge(parts)
}
