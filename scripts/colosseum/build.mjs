// Builds the arena colosseum GLB procedurally.
//
//   node scripts/colosseum/build.mjs [out.glb]
//
// The layout mirrors the gameplay constants in src/core/extras (ring wall
// radii, crowd rows, general/box height) so the crowd, Proximo, spawns and
// colliders line up without touching game code.
import path from 'path'
import * as THREE from 'three'
import { GlbWriter } from './glb.mjs'
import * as G from './geo.mjs'
import * as T from './textures.mjs'
import { encodeTexture } from './image.mjs'

const OUT = process.argv[2] || 'src/world/assets/colosseum-v1.glb'
const { DEG, TAU, polar, quatY, rotYForPhi } = G

// ---------------------------------------------------------------------------
// Layout (meters, Y up, y = 0 is the sand)
// ---------------------------------------------------------------------------
const L = {
  arenaR: 12.2, // ARENA_RING_WALL_RADIUS: podium wall face
  wallTopY: 2.55, // top of the block wall (cornice above)
  podiumY: 3.0, // front platform
  boxFloorY: 3.2, // GENERAL_Y_OFFSET (Proximo's feet)
  seatR0: 13.45, // crowd rows: r = 13.7 + 0.5k, y = 3.0 + 0.45k
  seatDepth: 0.5,
  seatRise: 0.45,
  seatRows: 4,
  walkR0: 15.45,
  walkR1: 17.0, // ARENA_OUTER_RING_WALL_RADIUS
  walkY: 4.8,
  parapetTopY: 5.9,
  upperR0: 17.3,
  upperRows: 6,
  upperDepth: 0.55,
  upperRise: 0.45,
  aisleY: 8.6,
  aisleR1: 21.7,
  galleryY: 8.9,
  colR: 21.9,
  colH: 4.0,
  innerWallR: 22.8,
  entabY0: 12.9,
  entabY1: 13.7,
  wallTop: 14.6,
  outerR: 24.0,
  bays: 36,
  story: 5.4,
  atticY: 10.8,
  mastTopY: 17.0,
  awningInnerR: 18.5,
  awningInnerY: 12.0,
  boxPhi: -64,
  boxHalf: 14,
  gatePhi: 116,
  gateHalf: 12,
  minorGates: [26, 206],
  minorHalf: 5,
  stairs: [26, 71, 116, 161, 206, 251, 296, 341],
  stairHalf: 2.2,
  vomHalf: 2.4,
}
const GROUND_SCALE = 37.46 // keeps glbToNodes' sand shader noise at the old asset's world scale
const SEG = 180 // angular segments for full rings (2 degrees)

const boxArc = { a: L.boxPhi - L.boxHalf, b: L.boxPhi + L.boxHalf }
const gateArc = { a: L.gatePhi - L.gateHalf, b: L.gatePhi + L.gateHalf }
const minorArcs = L.minorGates.map(p => ({ a: p - L.minorHalf, b: p + L.minorHalf }))
const stairArcs = L.stairs.map(p => ({ a: p - L.stairHalf, b: p + L.stairHalf }))
const vomArcs = L.stairs.map(p => ({ a: p - L.vomHalf, b: p + L.vomHalf }))

const normDeg = d => ((d % 360) + 360) % 360
const inArc = (deg, arc) => {
  const d = normDeg(deg)
  const a = normDeg(arc.a)
  const b = normDeg(arc.b)
  return a <= b ? d >= a && d <= b : d >= a || d <= b
}
const inAnyArc = (deg, arcs) => arcs.some(a => inArc(deg, a))

function bayWidth(R) {
  return (R * TAU) / L.bays
}

async function main() {
  const t0 = Date.now()
  const w = new GlbWriter()

  // ---- textures & materials -------------------------------------------------
  const img = {}
  for (const t of T.generateAll()) {
    img[t.name] = { color: w.addImage({ name: t.name, ...(await encodeTexture(t.width, t.height, t.rgb, 3, { quality: 88 })) }) }
    if (t.normal) {
      img[t.name].normal = w.addImage({
        name: `${t.name}_normal`,
        ...(await encodeTexture(t.width, t.height, t.normal, 3, { quality: 95 })),
      })
    }
  }
  console.log('textures encoded', Date.now() - t0, 'ms')
  const M = {
    blocks: w.addMaterial({ name: 'stone_blocks', texture: img.stone_blocks.color, normal: img.stone_blocks.normal, normalScale: 0.9, roughness: 0.9 }),
    stone: w.addMaterial({ name: 'stone_smooth', texture: img.stone_smooth.color, normal: img.stone_smooth.normal, normalScale: 0.6, roughness: 0.85 }),
    marble: w.addMaterial({ name: 'marble', texture: img.marble.color, roughness: 0.45 }),
    fabricRed: w.addMaterial({ name: 'fabric_red', texture: img.fabric_red.color, roughness: 0.95, doubleSided: true }),
    fabricPurple: w.addMaterial({ name: 'fabric_purple', texture: img.fabric_purple.color, roughness: 0.95, doubleSided: true }),
    awning: w.addMaterial({ name: 'awning', texture: img.awning.color, roughness: 0.95, doubleSided: true }),
    banner: w.addMaterial({ name: 'banner', texture: img.banner.color, clamp: true, roughness: 0.95, doubleSided: true }),
    wood: w.addMaterial({ name: 'wood', texture: img.wood.color, normal: img.wood.normal, normalScale: 0.7, roughness: 0.75 }),
    gold: w.addMaterial({ name: 'gold', color: [0.95, 0.7, 0.28], metallic: 1, roughness: 0.32 }),
    bronze: w.addMaterial({ name: 'bronze', color: [0.6, 0.38, 0.2], metallic: 1, roughness: 0.42 }),
    iron: w.addMaterial({ name: 'iron', color: [0.2, 0.2, 0.21], metallic: 0.9, roughness: 0.55 }),
    dark: w.addMaterial({ name: 'dark', color: [0.025, 0.02, 0.016], roughness: 1, doubleSided: true }),
    coals: w.addMaterial({ name: 'coals', color: [0.15, 0.04, 0.02], emissive: [1, 0.32, 0.06], roughness: 1 }),
    charcoal: w.addMaterial({ name: 'charcoal', color: [0.07, 0.045, 0.03], emissive: [0.45, 0.08, 0.0], roughness: 0.95 }),
    sand: w.addMaterial({ name: 'sand', color: [0.85, 0.7, 0.45], roughness: 1 }),
    collider: w.addMaterial({ name: 'collider', color: [0.2, 1, 0.2] }),
  }

  const TILE = { blocks: 2, stone: 2, marble: 1.5, wood: 1, fabric: 0.5 }

  // helpers ------------------------------------------------------------------
  const mesh = (name, prims) => w.addMesh(name, prims)
  const node = opts => w.addNode(opts)
  const ring = opts => G.sweep({ segments: SEG, tile: TILE.stone, ...opts })
  /** bent module centered at gameplay angle phi */
  const placeBent = (name, meshIdx, phi, extra = {}) => node({ name, mesh: meshIdx, rotation: quatY(rotYForPhi(phi * DEG)), ...extra })
  /** object at polar position, local -Z facing the arena center */
  const placePolar = (name, meshIdx, r, phi, y, extra = {}) =>
    node({ name, mesh: meshIdx, translation: polar(r, phi * DEG, y), rotation: quatY(rotYForPhi(phi * DEG)), ...extra })

  // ==========================================================================
  // 1. Ground (named *ground* so glbToNodes applies the desert sand shader)
  // ==========================================================================
  {
    const disc = new THREE.CircleGeometry(L.arenaR / GROUND_SCALE, 96)
    disc.rotateX(-Math.PI / 2)
    G.scaleUV(disc, 4)
    const mArena = mesh('ground_arena', [{ geometry: disc, material: M.sand }])
    node({ name: 'ground_arena', mesh: mArena, scale: [GROUND_SCALE, GROUND_SCALE, GROUND_SCALE] })

    const outer = new THREE.RingGeometry(L.arenaR / GROUND_SCALE, 420 / GROUND_SCALE, 128, 24)
    outer.rotateX(-Math.PI / 2)
    // gentle dunes beyond the plaza
    const N = (await import('./noise.mjs')).makeNoise(9)
    const pos = outer.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) * GROUND_SCALE
      const z = pos.getZ(i) * GROUND_SCALE
      const r = Math.hypot(x, z)
      const ramp = Math.min(1, Math.max(0, (r - 34) / 40))
      const h = (N.fbm(x / 90 + 50, z / 90 + 50, 64, 4) * 3.5 + N.fbm(x / 22 + 9, z / 22 + 9, 64, 3) * 0.8) * ramp
      pos.setY(i, Math.max(0, h) / GROUND_SCALE)
    }
    outer.computeVertexNormals()
    G.scaleUV(outer, 40)
    const mOuter = mesh('ground_outer', [{ geometry: outer, material: M.sand }])
    node({ name: 'ground_outer', mesh: mOuter, scale: [GROUND_SCALE, GROUND_SCALE, GROUND_SCALE] })
  }

  // ==========================================================================
  // 2. Podium wall (arena edge), plinth, cornice
  // ==========================================================================
  {
    const R = L.arenaR
    const wall = ring({
      profile: [
        { r: R, y: 0.42 },
        { r: R, y: L.wallTopY },
      ],
      tile: TILE.blocks,
      skip: [gateArc, ...minorArcs],
      vOffset: 0.21,
    })
    const plinth = ring({
      profile: [
        { r: R - 0.1, y: 0 },
        { r: R - 0.1, y: 0.34 },
        { r: R, y: 0.42 },
      ],
      skip: [{ ...gateArc, cap: true }, ...minorArcs.map(a => ({ ...a, cap: true }))],
      capBaseY: 0,
    })
    const cornice = ring({
      profile: [
        { r: R, y: L.wallTopY },
        { r: R - 0.12, y: L.wallTopY + 0.06 },
        { r: R - 0.12, y: L.wallTopY + 0.22 },
        { r: R - 0.06, y: L.wallTopY + 0.3 },
        { r: R, y: L.podiumY },
      ],
      skip: [{ ...gateArc, cap: true }],
      capBaseY: L.wallTopY - 0.05,
    })
    const m = mesh('podium_wall', [
      { geometry: wall, material: M.blocks },
      { geometry: G.merge([plinth, cornice]), material: M.stone },
    ])
    node({ name: 'podium_wall', mesh: m })
  }

  // ==========================================================================
  // 3. Lower cavea: parapet, front platform, 4 crowd rows, walkway, back parapet
  // ==========================================================================
  {
    const R = L.arenaR
    const parapet = ring({
      profile: [
        { r: R, y: L.podiumY },
        { r: R, y: L.podiumY + 0.5 },
        { r: R - 0.03, y: L.podiumY + 0.55 },
        { r: R + 0.33, y: L.podiumY + 0.55 },
        { r: R + 0.3, y: L.podiumY + 0.5 },
        { r: R + 0.3, y: L.podiumY },
      ],
      tile: TILE.marble,
      skip: [{ ...boxArc, cap: true }, gateArc],
      capBaseY: L.podiumY,
    })
    // front platform (stone) up to the first row, first row in marble
    const platform = ring({
      profile: [
        { r: R + 0.3, y: L.podiumY },
        { r: L.seatR0, y: L.podiumY },
      ],
      skip: [boxArc, gateArc],
    })
    const r1 = L.seatR0 + L.seatDepth
    const firstRow = ring({
      profile: [
        { r: L.seatR0, y: L.podiumY },
        { r: r1, y: L.podiumY },
        { r: r1, y: L.podiumY + L.seatRise - 0.04 },
        { r: r1 - 0.03, y: L.podiumY + L.seatRise },
      ],
      tile: TILE.marble,
      skip: [{ ...boxArc, cap: true }, gateArc],
      capBaseY: L.podiumY,
    })
    // remaining rows + walkway
    const prof = [{ r: r1 - 0.03, y: L.podiumY + L.seatRise }]
    for (let k = 1; k < L.seatRows; k++) {
      const rA = L.seatR0 + L.seatDepth * k
      const rB = rA + L.seatDepth
      const y = L.podiumY + L.seatRise * k
      prof.push({ r: rB, y }, { r: rB, y: y + L.seatRise - 0.04 }, { r: rB - 0.03, y: y + L.seatRise })
    }
    const rows = ring({ profile: prof, skip: [{ ...boxArc, cap: true }, gateArc], capBaseY: L.podiumY })
    const walkway = ring({
      profile: [
        { r: prof[prof.length - 1].r, y: L.walkY },
        { r: L.walkR1, y: L.walkY },
      ],
    })
    // back parapet with a handrail cap (r 17.0 .. 17.3)
    const backParapet = ring({
      profile: [
        { r: L.walkR1, y: L.walkY },
        { r: L.walkR1, y: L.parapetTopY - 0.12 },
        { r: L.walkR1 - 0.05, y: L.parapetTopY - 0.08 },
        { r: L.walkR1 - 0.05, y: L.parapetTopY },
        { r: L.upperR0 + 0.05, y: L.parapetTopY },
        { r: L.upperR0 + 0.05, y: L.parapetTopY - 0.08 },
        { r: L.upperR0, y: L.parapetTopY - 0.12 },
        { r: L.upperR0, y: L.parapetTopY },
      ],
      tile: TILE.marble,
    })
    const m = mesh('cavea_lower', [
      { geometry: G.merge([parapet, firstRow, backParapet]), material: M.marble },
      { geometry: G.merge([platform, rows, walkway]), material: M.stone },
    ])
    node({ name: 'cavea_lower', mesh: m })
  }

  // ==========================================================================
  // 4. Upper tier: 6 rows, aisle, gallery floor, gallery wall, entablature, attic
  // ==========================================================================
  {
    const prof = [{ r: L.upperR0, y: L.parapetTopY }]
    for (let k = 0; k < L.upperRows; k++) {
      const rA = L.upperR0 + L.upperDepth * k
      const rB = rA + L.upperDepth
      const y = L.parapetTopY + L.upperRise * k
      prof.push({ r: rB, y }, { r: rB, y: y + L.upperRise - 0.04 }, { r: rB - 0.03, y: y + L.upperRise })
    }
    const seats = ring({ profile: prof, skip: stairArcs })
    const rTop = L.upperR0 + L.upperDepth * L.upperRows
    const aisle = ring({
      profile: [
        { r: rTop - 0.03, y: L.aisleY },
        { r: L.aisleR1, y: L.aisleY },
        { r: L.aisleR1, y: L.galleryY },
        { r: L.innerWallR, y: L.galleryY },
      ],
    })
    const wall = ring({
      profile: [
        { r: L.innerWallR, y: L.galleryY },
        { r: L.innerWallR, y: L.entabY0 },
      ],
      tile: TILE.blocks,
      skip: vomArcs,
      vOffset: 0.35,
    })
    const R = L.innerWallR
    const entab = ring({
      profile: [
        { r: R, y: L.entabY0 },
        { r: R - 1.25, y: L.entabY0 },
        { r: R - 1.25, y: L.entabY0 + 0.22 },
        { r: R - 1.18, y: L.entabY0 + 0.26 },
        { r: R - 1.18, y: L.entabY0 + 0.5 },
        { r: R - 1.32, y: L.entabY0 + 0.56 },
        { r: R - 1.32, y: L.entabY0 + 0.64 },
        { r: R - 1.45, y: L.entabY0 + 0.72 },
        { r: R - 1.45, y: L.entabY1 },
        { r: R, y: L.entabY1 },
      ],
    })
    const attic = ring({
      profile: [
        { r: R, y: L.entabY1 },
        { r: R, y: L.wallTop },
      ],
      tile: TILE.blocks,
    })
    const m = mesh('cavea_upper', [
      { geometry: G.merge([seats, aisle, entab]), material: M.stone },
      { geometry: G.merge([wall, attic]), material: M.blocks },
    ])
    node({ name: 'cavea_upper', mesh: m })
  }

  // 4b. stairs through the upper tier (bent modules with cheek walls)
  {
    const R = L.upperR0
    const wdt = R * (L.stairHalf * 2 * DEG)
    const run = L.upperDepth * L.upperRows
    const rise = L.upperRise * L.upperRows
    const steps = 12
    const parts = []
    for (let i = 0; i < steps; i++) {
      const top = L.parapetTopY + (rise / steps) * (i + 1)
      parts.push(G.box(wdt - 0.28, top - L.parapetTopY, run / steps, { y: L.parapetTopY, z: (run / steps) * (i + 0.5) }))
    }
    // cheek walls following the slope
    for (const side of [-1, 1]) {
      const cheek = G.polygon(
        [
          [0, L.parapetTopY - 0.3],
          [run, L.parapetTopY - 0.3],
          [run, L.aisleY + 0.55],
          [0, L.parapetTopY + 0.7],
        ],
        0,
        { normalZ: 1, tile: TILE.stone }
      )
      // polygon is in XY; rotate so its plane is Y/Z at x = side * wdt/2 (thickness via a box instead)
      cheek.dispose?.()
      parts.push(G.box(0.14, 0.001, 0.001)) // placeholder removed below
      parts.pop()
      const cheekBox = cheekWall(run, L.parapetTopY - 0.3, L.parapetTopY + 0.7, L.aisleY + 0.55, 0.14)
      cheekBox.translate(side * (wdt / 2 - 0.07), 0, 0)
      parts.push(cheekBox)
    }
    const g = G.bend(G.merge(parts), R)
    const m = mesh('stairs_upper', [{ geometry: g, material: M.stone }])
    L.stairs.forEach((phi, i) => placeBent(`stairs_upper_${i}`, m, phi))
  }

  // 4c. vomitoria doorways in the gallery wall
  {
    const R = L.innerWallR
    const wdt = R * (L.vomHalf * 2 * DEG)
    const aw = G.archWall({ w: wdt, h: L.entabY0 - L.galleryY, t: 1.0, a: 0.72, s: 1.6, facing: 'in', backDepth: 0.95, tile: TILE.blocks, keystone: true, imposts: true, floor: true })
    aw.wall.translate(0, L.galleryY, 0)
    aw.back.translate(0, L.galleryY, 0)
    G.bend(aw.wall, R)
    G.bend(aw.back, R)
    const m = mesh('vomitorium', [
      { geometry: aw.wall, material: M.blocks },
      { geometry: aw.back, material: M.dark },
    ])
    L.stairs.forEach((phi, i) => placeBent(`vomitorium_${i}`, m, phi))
  }

  // 4d. gallery colonnade
  {
    const col = G.column({ r: 0.28, h: L.colH, order: 'corinthian', fluted: true, tile: TILE.marble })
    const m = mesh('gallery_column', [
      { geometry: col.shaft, material: M.marble },
      { geometry: col.capital, material: M.marble },
    ])
    for (let k = 0; k < L.bays; k++) {
      const phi = 5 + 10 * k
      placePolar(`gallery_column_${k}`, m, L.colR, phi, L.galleryY)
    }
  }

  // 4e. big crimson banners on the gallery wall between the doorways
  {
    const bannerMesh = makeBanner(1.7, 3.2)
    const m = mesh('gallery_banner', [
      { geometry: bannerMesh.cloth, material: M.banner },
      { geometry: bannerMesh.rod, material: M.bronze },
    ])
    L.stairs.forEach((phi, i) => placePolar(`gallery_banner_${i}`, m, L.innerWallR - 0.08, phi + 22.5, L.galleryY + 0.5))
  }

  // shared gold aquila (gate corners, box pediment)
  L.eagleMesh = mesh('eagle', [{ geometry: G.eagle(1.2), material: M.gold }])

  // ==========================================================================
  // 5. Royal box (pulvinar) — Proximo stands between the two braziers
  // ==========================================================================
  {
    const R = L.arenaR - 0.6 // balcony front, projects over the sand
    const phi = L.boxPhi
    const depth = L.walkR0 - R // to the walkway
    const wdt = R * (L.boxHalf * 2 * DEG)
    const backZ = L.upperR0 - 3.1 - R // back wall starts 14.2
    const y0 = L.boxFloorY
    const marble = []
    const stone = []
    // floor slab + corbels under the overhang
    marble.push(G.box(wdt, 0.2, depth, { y: y0 - 0.2, z: depth / 2, tile: TILE.marble }))
    for (let i = -2; i <= 2; i++) {
      stone.push(G.box(0.32, 0.5, 0.65, { x: i * (wdt / 5), y: y0 - 0.7, z: 0.325, tile: TILE.stone }))
    }
    // front balustrade
    marble.push(G.box(wdt, 0.3, 0.26, { y: y0, z: 0.13, tile: TILE.marble }))
    marble.push(G.box(wdt, 0.1, 0.3, { y: y0 + 0.65, z: 0.13, tile: TILE.marble }))
    const nBal = Math.floor(wdt / 0.3)
    for (let i = 0; i < nBal; i++) {
      const x = -wdt / 2 + (i + 0.5) * (wdt / nBal)
      const b = G.baluster(0.35)
      b.translate(x, y0 + 0.3, 0.13)
      marble.push(b)
    }
    // side walls
    for (const side of [-1, 1]) {
      marble.push(G.box(0.3, 0.75, backZ, { x: side * (wdt / 2 - 0.15), y: y0, z: backZ / 2, tile: TILE.marble }))
    }
    // back block with a doorway
    const backH = 3.4
    const bw = G.archWall({ w: wdt, h: backH, t: depth - backZ, a: 0.62, s: 1.7, facing: 'in', backDepth: 1.0, tile: TILE.marble, keystone: false, imposts: true })
    bw.wall.translate(0, y0, backZ)
    bw.back.translate(0, y0, backZ)
    marble.push(bw.wall)
    marble.push(G.polygon([[-wdt / 2, y0], [wdt / 2, y0], [wdt / 2, y0 + backH], [-wdt / 2, y0 + backH]], depth, { normalZ: 1, tile: TILE.marble }))
    for (const side of [-1, 1]) {
      const sideFace = G.polygon([[backZ, y0], [depth, y0], [depth, y0 + backH], [backZ, y0 + backH]], 0, { normalZ: 1, tile: TILE.marble })
      sideFace.rotateY(side * Math.PI / 2)
      sideFace.translate(side * wdt / 2, 0, 0)
      if (side < 0) sideFace.translate(0, 0, 0)
      marble.push(fixSideFace(sideFace, side, wdt, backZ, depth, y0, backH))
    }
    // roof slab + cornice + pediment
    const roofY = y0 + backH
    marble.push(G.box(wdt + 0.5, 0.45, depth + 0.2, { y: roofY, z: depth / 2 - 0.1, tile: TILE.marble }))
    marble.push(G.box(wdt + 0.8, 0.14, depth + 0.5, { y: roofY + 0.45, z: depth / 2 - 0.25, tile: TILE.marble }))
    const ped = G.pediment(wdt + 0.8, 0.95, 0.55, { tile: TILE.marble })
    G.mirrorZ(ped)
    ped.translate(0, roofY + 0.59, -0.25)
    marble.push(ped)
    // purple valance under the roof edge + curtains on the back wall
    const val = scallopedValance(wdt + 0.5, roofY - 0.42, roofY, -0.12)
    const curtains = []
    for (const side of [-1, 1]) {
      const inner = side * 0.95
      const outer = side * (wdt / 2 - 0.35)
      const c = G.polygon(
        [
          [Math.min(inner, outer), y0 + 0.1],
          [Math.max(inner, outer), y0 + 0.1],
          [Math.max(inner, outer), y0 + backH - 0.35],
          [Math.min(inner, outer), y0 + backH - 0.35],
        ],
        backZ - 0.05,
        { normalZ: -1, tile: TILE.fabric }
      )
      curtains.push(c)
    }
    const mBox = mesh('royal_box', [
      { geometry: G.bend(G.merge(marble), R), material: M.marble },
      { geometry: G.bend(G.merge(stone), R), material: M.stone },
      { geometry: G.bend(bw.back, R), material: M.dark },
      { geometry: G.bend(G.merge([val, ...curtains]), R), material: M.fabricPurple },
    ])
    placeBent('royal_box', mBox, phi)

    // columns holding the canopy
    const col = G.column({ r: 0.24, h: backH, order: 'corinthian', fluted: true, tile: TILE.marble })
    const mCol = mesh('box_column', [
      { geometry: col.shaft, material: M.marble },
      { geometry: col.capital, material: M.marble },
    ])
    let ci = 0
    for (const dphi of [-11.5, 11.5]) {
      placePolar(`box_column_${ci++}`, mCol, R + 0.55, phi + dphi, y0)
      placePolar(`box_column_${ci++}`, mCol, R + backZ - 0.5, phi + dphi, y0)
    }
    // dais + throne
    const daisR = R + 2.15
    const dais = G.merge([
      G.box(2.6, 0.15, 1.5, { y: 0, tile: TILE.marble }),
      G.box(2.15, 0.15, 1.15, { y: 0.15, tile: TILE.marble }),
    ])
    const mDais = mesh('dais', [{ geometry: dais, material: M.marble }])
    placePolar('dais', mDais, daisR, phi, y0)
    const throne = makeThrone()
    const mThrone = mesh('throne', [
      { geometry: throne.marble, material: M.marble },
      { geometry: throne.gold, material: M.gold },
      { geometry: throne.cushion, material: M.fabricPurple },
    ])
    placePolar('throne', mThrone, daisR + 0.1, phi, y0 + 0.3)
    // eagle standards
    const std = makeStandard()
    const mStd = mesh('standard', [{ geometry: std, material: M.gold }])
    placePolar('standard_0', mStd, daisR + 0.2, phi - 6.5, y0 + 0.15)
    placePolar('standard_1', mStd, daisR + 0.2, phi + 6.5, y0 + 0.15)
    // braziers — node origin is the bowl rim (fire fx spawns there)
    const brazier = makeBrazier()
    const mBraz = mesh('brazier', [
      { geometry: brazier.bronze, material: M.bronze },
      { geometry: brazier.coals, material: M.coals },
      { geometry: brazier.logs, material: M.charcoal },
    ])
    placePolar('barrizer', mBraz, R + 1.0, phi - 9, y0 + brazier.rimY)
    placePolar('barrizer_2', mBraz, R + 1.0, phi + 9, y0 + brazier.rimY)
    // statues on the roof corners
    const fig0 = G.figure(1.9, 0)
    const fig1 = G.figure(1.9, 1)
    const mFig0 = mesh('statue_a', [{ geometry: fig0, material: M.marble }])
    const mFig1 = mesh('statue_b', [{ geometry: fig1, material: M.marble }])
    placePolar('box_statue_0', mFig1, R + 0.4, phi - 13.5, roofY + 0.59)
    placePolar('box_statue_1', mFig0, R + 0.4, phi + 13.5, roofY + 0.59)
    placePolar('box_eagle', L.eagleMesh, R - 0.1, phi, roofY + 0.59 + 0.95)
    // vexilla hanging under the balcony
    const vex = makeBanner(1.0, 1.9)
    const mVex = mesh('vexillum', [
      { geometry: vex.cloth, material: M.banner },
      { geometry: vex.rod, material: M.bronze },
    ])
    placePolar('vexillum_0', mVex, L.arenaR - 0.08, phi - 8, 0.9)
    placePolar('vexillum_1', mVex, L.arenaR - 0.08, phi + 8, 0.9)

    // collider: floor, balustrade, side walls, back block
    const col1 = G.merge([
      G.box(wdt, 0.2, depth, { y: y0 - 0.2, z: depth / 2 }),
      G.box(wdt, 0.75, 0.3, { y: y0, z: 0.15 }),
      G.box(0.3, 0.75, backZ, { x: wdt / 2 - 0.15, y: y0, z: backZ / 2 }),
      G.box(0.3, 0.75, backZ, { x: -wdt / 2 + 0.15, y: y0, z: backZ / 2 }),
      G.box(wdt, backH, depth - backZ, { y: y0, z: backZ + (depth - backZ) / 2 }),
    ])
    L.colBox = { geometry: G.bend(col1, R), phi }
    L.statueMeshes = [mFig0, mFig1]
  }

  // ==========================================================================
  // 6. Main gate (Porta Triumphalis) opposite the royal box
  // ==========================================================================
  {
    const R = L.arenaR
    const phi = L.gatePhi
    const wdt = R * (L.gateHalf * 2 * DEG)
    const depth = L.walkR0 - R
    const a = 1.3
    const s = 2.4
    const blocks = []
    const stone = []
    const marble = []
    const aw = G.archWall({ w: wdt, h: L.walkY, t: depth, a, s, facing: 'in', back: false, tile: TILE.blocks, n: 22 })
    blocks.push(aw.wall)
    blocks.push(G.box(wdt, 0.06, depth, { y: L.walkY - 0.06, z: depth / 2, tile: TILE.blocks }))
    for (const side of [-1, 1]) {
      const sideFace = G.polygon([[0, 0], [depth, 0], [depth, L.walkY], [0, L.walkY]], 0, { normalZ: 1, tile: TILE.blocks })
      const pos = sideFace.attributes.position
      const nor = sideFace.attributes.normal
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, (side * wdt) / 2, pos.getY(i), pos.getX(i))
        nor.setXYZ(i, side, 0, 0)
      }
      G.orientFaces(sideFace)
      blocks.push(sideFace)
    }
    // false front + inscription + pediment
    blocks.push(G.box(wdt, 2.4, 0.8, { y: L.walkY, z: 0.4, tile: TILE.blocks }))
    stone.push(G.box(wdt + 0.3, 0.32, 1.0, { y: L.walkY - 0.25, z: 0.35, tile: TILE.stone }))
    stone.push(G.box(wdt + 0.3, 0.12, 1.1, { y: L.walkY + 2.4 - 0.12, z: 0.35, tile: TILE.stone }))
    const ped = G.pediment(wdt + 0.3, 1.1, 0.8, { tile: TILE.stone })
    G.mirrorZ(ped)
    ped.translate(0, L.walkY + 2.4, 0)
    stone.push(ped)
    marble.push(G.box(2.7, 0.95, 0.06, { y: L.walkY + 0.75, z: -0.03, tile: TILE.marble }))
    // engaged columns on pedestals flanking the arch
    for (const side of [-1, 1]) {
      marble.push(G.box(0.85, 0.9, 0.55, { x: side * 2.0, y: 0, z: -0.275, tile: TILE.marble }))
      const c = G.column({ r: 0.27, h: L.walkY - 0.25 - 0.9, order: 'corinthian', fluted: true, half: true, tile: TILE.marble })
      const cg = G.merge([c.shaft, c.capital])
      G.mirrorZ(cg)
      cg.translate(side * 2.0, 0.9, 0)
      marble.push(cg)
    }
    // wooden door at the back of the tunnel + iron bands
    const doorZ = depth - 0.25
    const doorPoly = [[-a, 0], [a, 0], [a, s], ...G.archPath(a, s, 18).slice(1, -1).reverse(), [-a, s]]
    const door = G.polygon(doorPoly, doorZ, { normalZ: -1, tile: TILE.wood })
    const bands = []
    for (const y of [0.5, 1.4, 2.3]) bands.push(G.box(2 * a - 0.1, 0.12, 0.04, { y, z: doorZ - 0.03 }))
    for (const side of [-1, 1]) bands.push(G.box(0.1, s + 0.3, 0.04, { x: side * (a - 0.2), y: 0.1, z: doorZ - 0.03 }))
    // portcullis just inside the arch (the invisible ring wall sits at r = 12.2)
    const grate = makeGrate(a, s, 0.22)
    const mGate = mesh('main_gate', [
      { geometry: G.bend(G.merge(blocks), R), material: M.blocks },
      { geometry: G.bend(G.merge(stone), R), material: M.stone },
      { geometry: G.bend(G.merge(marble), R), material: M.marble },
      { geometry: G.bend(door, R), material: M.wood },
      { geometry: G.bend(G.merge([...bands, grate]), R), material: M.iron },
    ])
    placeBent('main_gate', mGate, phi)
    // statue on the apex, eagles on the corners, banners on the false front
    placePolar('gate_statue', L.statueMeshes[1], R + 0.45, phi, L.walkY + 2.4 + 1.1, { scale: [1.15, 1.15, 1.15] })
    placePolar('gate_eagle_0', L.eagleMesh, R + 0.4, phi - 11, L.walkY + 2.4)
    placePolar('gate_eagle_1', L.eagleMesh, R + 0.4, phi + 11, L.walkY + 2.4)
    const vex = makeBanner(0.9, 1.7)
    const mVex = mesh('gate_banner', [
      { geometry: vex.cloth, material: M.banner },
      { geometry: vex.rod, material: M.bronze },
    ])
    placePolar('gate_banner_0', mVex, R - 0.06, phi - 8.5, L.walkY + 0.35)
    placePolar('gate_banner_1', mVex, R - 0.06, phi + 8.5, L.walkY + 0.35)

    const col = G.merge([
      G.box(wdt, L.walkY, depth, { y: 0, z: depth / 2 }),
      G.box(wdt, 2.4, 0.8, { y: L.walkY, z: 0.4 }),
      G.box(wdt, 1.1, 0.8, { y: L.walkY + 2.4, z: 0.4 }),
    ])
    L.colGate = { geometry: G.bend(col, R), phi }
  }

  // ==========================================================================
  // 7. Minor gates in the podium wall
  // ==========================================================================
  {
    const R = L.arenaR
    const wdt = R * (L.minorHalf * 2 * DEG)
    const aw = G.archWall({ w: wdt, h: L.wallTopY, t: 1.0, a: 0.72, s: 1.45, facing: 'in', backDepth: 0.95, tile: TILE.blocks, keystone: true, imposts: true })
    const grate = makeGrate(0.72, 1.45, 0.12)
    const m = mesh('minor_gate', [
      { geometry: G.bend(aw.wall, R), material: M.blocks },
      { geometry: G.bend(aw.back, R), material: M.dark },
      { geometry: G.bend(grate, R), material: M.iron },
    ])
    L.minorGates.forEach((phi, i) => placeBent(`minor_gate_${i}`, m, phi))
  }

  // ==========================================================================
  // 8. Podium pilasters and wall banners
  // ==========================================================================
  {
    const pil = G.merge([
      G.box(0.44, 0.1, 0.16, { y: 0.42, z: -0.08, tile: TILE.marble }),
      G.box(0.36, L.wallTopY - 0.52, 0.12, { y: 0.52, z: -0.06, tile: TILE.marble }),
      G.box(0.48, 0.12, 0.18, { y: L.wallTopY - 0.12, z: -0.09, tile: TILE.marble }),
    ])
    const mPil = mesh('pilaster', [{ geometry: pil, material: M.marble }])
    const skipArcs = [boxArc, gateArc, ...minorArcs]
    for (let k = 0; k < 36; k++) {
      const phi = 10 * k
      if (inAnyArc(phi, skipArcs)) continue
      placePolar(`pilaster_${k}`, mPil, L.arenaR, phi, 0)
    }
    const ban = makeBanner(1.1, 1.95)
    const mBan = mesh('wall_banner', [
      { geometry: ban.cloth, material: M.banner },
      { geometry: ban.rod, material: M.bronze },
    ])
    for (let k = 0; k < 18; k++) {
      const phi = 5 + 20 * k
      if (inAnyArc(phi, skipArcs) || inAnyArc(phi - 4, skipArcs) || inAnyArc(phi + 4, skipArcs)) continue
      placePolar(`wall_banner_${k}`, mBan, L.arenaR - 0.08, phi, 0.5)
    }
  }

  // ==========================================================================
  // 9. Exterior: two arcaded stories, attic, cornices, masts, velarium
  // ==========================================================================
  {
    const R = L.outerR
    const wdt = bayWidth(R)
    const t = 1.2
    const a = 1.25
    const s = 2.85
    const storyModule = (order, y) => {
      const aw = G.archWall({ w: wdt, h: L.story - 0.8, t, a, s, facing: 'out', backDepth: t, tile: TILE.blocks, n: 22, floor: y > 0 })
      const col = G.column({ r: 0.34, h: L.story - 0.8, order, half: true, tile: TILE.stone })
      const colG = G.merge([col.shaft, col.capital])
      colG.translate(-wdt / 2, 0, 0)
      aw.wall.translate(0, y, 0)
      aw.back.translate(0, y, 0)
      colG.translate(0, y, 0)
      return {
        wall: G.bend(aw.wall, R),
        back: G.bend(aw.back, R),
        column: G.bend(colG, R),
      }
    }
    const s1 = storyModule('tuscan', 0)
    const s2 = storyModule('ionic', L.story)
    const mS1 = mesh('facade_story1', [
      { geometry: s1.wall, material: M.blocks },
      { geometry: s1.column, material: M.stone },
      { geometry: s1.back, material: M.dark },
    ])
    const mS2 = mesh('facade_story2', [
      { geometry: s2.wall, material: M.blocks },
      { geometry: s2.column, material: M.stone },
      { geometry: s2.back, material: M.dark },
    ])
    // attic: two variants (window / bronze shield)
    const atticH = L.wallTop - 0.4 - L.atticY
    const atticModule = withWindow => {
      const blocks = []
      const stone = []
      const y = L.atticY
      if (withWindow) {
        const hw = 0.5
        const wy = 1.35
        const face = G.polygon([[-wdt / 2, 0], [wdt / 2, 0], [wdt / 2, atticH], [-wdt / 2, atticH]], 0, {
          normalZ: 1,
          tile: TILE.blocks,
          holes: [[[-hw, wy], [-hw, wy + 1.0], [hw, wy + 1.0], [hw, wy]]],
        })
        blocks.push(face)
        blocks.push(G.strip([[-hw, wy], [-hw, wy + 1.0], [hw, wy + 1.0], [hw, wy], [-hw, wy]], 0, -0.35, [0, wy + 0.5], TILE.blocks))
        stone.push(G.box(2 * hw + 0.3, 0.12, 0.2, { y: wy - 0.12, z: 0.1, tile: TILE.stone }))
      } else {
        blocks.push(G.polygon([[-wdt / 2, 0], [wdt / 2, 0], [wdt / 2, atticH], [-wdt / 2, atticH]], 0, { normalZ: 1, tile: TILE.blocks }))
      }
      // pilaster at the bay edge + mast corbel at the center
      stone.push(G.box(0.62, atticH - 0.4, 0.2, { x: -wdt / 2, y: 0.2, z: 0.1, tile: TILE.stone }))
      stone.push(G.box(0.76, 0.16, 0.26, { x: -wdt / 2, y: atticH - 0.36, z: 0.13, tile: TILE.stone }))
      stone.push(G.box(0.74, 0.12, 0.24, { x: -wdt / 2, y: 0.2, z: 0.12, tile: TILE.stone }))
      stone.push(G.box(0.5, 0.55, 0.62, { y: 1.35, z: 0.31, tile: TILE.stone }))
      const mast = G.cylinder(0.13, 0.16, L.mastTopY - (L.atticY + 0.7), 10, { y: 0.7, z: 0.45, tile: TILE.wood })
      const shield = withWindow ? null : shieldDisc(0.55, 2.0)
      const dark = withWindow ? G.polygon([[-0.5, 1.35], [0.5, 1.35], [0.5, 2.35], [-0.5, 2.35]], -0.35, { normalZ: 1 }) : null
      const out = {
        blocks: G.merge(blocks),
        stone: G.merge(stone),
        mast,
        shield,
        dark,
      }
      for (const k of Object.keys(out)) {
        if (!out[k]) continue
        out[k].translate(0, y, 0)
        G.bend(out[k], R)
      }
      return out
    }
    const aA = atticModule(true)
    const aB = atticModule(false)
    const mAA = mesh('facade_attic_a', [
      { geometry: aA.blocks, material: M.blocks },
      { geometry: aA.stone, material: M.stone },
      { geometry: aA.mast, material: M.wood },
      { geometry: aA.dark, material: M.dark },
    ])
    const mAB = mesh('facade_attic_b', [
      { geometry: aB.blocks, material: M.blocks },
      { geometry: aB.stone, material: M.stone },
      { geometry: aB.mast, material: M.wood },
      { geometry: aB.shield, material: M.bronze },
    ])
    // velarium panel for one bay
    const half = 5 * DEG
    const ro = R + 0.42
    const p = (r, th, y) => [r * Math.sin(th), y, r * Math.cos(th)]
    const panel = G.clothPanel(
      p(ro, -half, L.mastTopY - 0.1),
      p(ro, half, L.mastTopY - 0.1),
      p(L.awningInnerR, -half, L.awningInnerY),
      p(L.awningInnerR, half, L.awningInnerY),
      8,
      14,
      0.5,
      [1, 3]
    )
    const mPanel = mesh('velarium_panel', [{ geometry: panel, material: M.awning }])
    for (let k = 0; k < L.bays; k++) {
      const phi = 5 + 10 * k
      placeBent(`facade_story1_${k}`, mS1, phi)
      placeBent(`facade_story2_${k}`, mS2, phi)
      placeBent(`facade_attic_${k}`, k % 2 ? mAB : mAA, phi)
      placeBent(`velarium_${k}`, mPanel, phi)
      if (k % 2 === 0) {
        const fig = L.statueMeshes[(k / 2) % 2]
        placePolar(`facade_statue_${k}`, fig, R - 0.55, phi, L.story + 0.4, { rotation: quatY(rotYForPhi(phi * DEG) + Math.PI) })
      }
    }
    // statue pedestals in the second-story arches
    const ped = G.box(1.0, 0.4, 0.8, { tile: TILE.stone })
    const mPed = mesh('statue_pedestal', [{ geometry: ped, material: M.stone }])
    for (let k = 0; k < L.bays; k += 2) placePolar(`facade_pedestal_${k}`, mPed, R - 0.55, 5 + 10 * k, L.story)

    // entablature rings + top cornice (outward), plaza pavement
    const entab = y =>
      ring({
        profile: [
          { r: R, y },
          { r: R + 0.1, y },
          { r: R + 0.1, y: y + 0.3 },
          { r: R + 0.18, y: y + 0.3 },
          { r: R + 0.18, y: y + 0.52 },
          { r: R + 0.3, y: y + 0.58 },
          { r: R + 0.3, y: y + 0.66 },
          { r: R + 0.42, y: y + 0.73 },
          { r: R + 0.42, y: y + 0.8 },
          { r: R, y: y + 0.8 },
        ],
        outward: true,
      })
    const cornice = ring({
      profile: [
        { r: R, y: L.wallTop - 0.4 },
        { r: R + 0.2, y: L.wallTop - 0.4 },
        { r: R + 0.2, y: L.wallTop - 0.25 },
        { r: R + 0.45, y: L.wallTop - 0.15 },
        { r: R + 0.45, y: L.wallTop },
        { r: L.innerWallR, y: L.wallTop },
      ],
      outward: true,
    })
    const plaza = ring({
      profile: [
        { r: R, y: 0.06 },
        { r: R + 3.5, y: 0.06 },
        { r: R + 3.6, y: 0 },
      ],
      tile: TILE.stone,
    })
    const mRings = mesh('facade_rings', [{ geometry: G.merge([entab(L.story - 0.8), entab(L.atticY - 0.8), cornice, plaza]), material: M.stone }])
    node({ name: 'facade_rings', mesh: mRings })
  }

  // ==========================================================================
  // 10. Colliders (simplified) — hyperfy reads node extras
  // ==========================================================================
  {
    const rb = node({ name: 'arena_colliders', extras: { node: 'rigidbody', type: 'static' } })
    const colExtras = { node: 'collider', layer: 'environment' }
    // subdivided so PhysX doesn't complain about oversized triangles
    const groundQuad = new THREE.PlaneGeometry(800, 800, 32, 32)
    groundQuad.rotateX(-Math.PI / 2)
    const mGround = mesh('col_ground', [{ geometry: groundQuad, material: M.collider }])
    node({ name: 'col_ground', mesh: mGround, parent: rb, extras: colExtras })

    const prof = [
      { r: L.arenaR, y: L.wallTopY },
      { r: L.arenaR, y: L.podiumY + 0.55 },
      { r: L.arenaR + 0.3, y: L.podiumY + 0.55 },
      { r: L.arenaR + 0.3, y: L.podiumY },
      { r: L.seatR0, y: L.podiumY },
    ]
    for (let k = 0; k < L.seatRows; k++) {
      const rB = L.seatR0 + L.seatDepth * (k + 1)
      const y = L.podiumY + L.seatRise * k
      prof.push({ r: rB, y }, { r: rB, y: y + L.seatRise })
    }
    prof.push({ r: L.walkR1, y: L.walkY }, { r: L.walkR1, y: L.parapetTopY }, { r: L.upperR0, y: L.parapetTopY })
    for (let k = 0; k < L.upperRows; k++) {
      const rB = L.upperR0 + L.upperDepth * (k + 1)
      const y = L.parapetTopY + L.upperRise * k
      prof.push({ r: rB, y }, { r: rB, y: y + L.upperRise })
    }
    prof.push({ r: L.aisleR1, y: L.aisleY }, { r: L.aisleR1, y: L.galleryY }, { r: L.innerWallR, y: L.galleryY }, { r: L.innerWallR, y: L.wallTop })
    const cavea = G.sweep({ profile: prof, segments: SEG, skip: [boxArc, gateArc], tile: 1 })
    const mCavea = mesh('col_cavea', [{ geometry: cavea, material: M.collider }])
    node({ name: 'col_cavea', mesh: mCavea, parent: rb, extras: colExtras })

    const mBox = mesh('col_box', [{ geometry: L.colBox.geometry, material: M.collider }])
    node({ name: 'col_box', mesh: mBox, parent: rb, extras: colExtras, rotation: quatY(rotYForPhi(L.colBox.phi * DEG)) })
    const mGate = mesh('col_gate', [{ geometry: L.colGate.geometry, material: M.collider }])
    node({ name: 'col_gate', mesh: mGate, parent: rb, extras: colExtras, rotation: quatY(rotYForPhi(L.colGate.phi * DEG)) })
  }

  const bytes = w.write(OUT)
  console.log(`wrote ${OUT}: ${(bytes / 1e6).toFixed(2)} MB, ${JSON.stringify(w.stats)}, ${Date.now() - t0} ms`)
}

// ---------------------------------------------------------------------------
// Sub-assemblies
// ---------------------------------------------------------------------------

/** Sloped cheek wall beside a stair: box-like prism along Z from z=0..run. */
function cheekWall(run, yBottom, yTop0, yTop1, thick) {
  // build as a polygon in the (z, y) plane extruded in x
  const prof = [
    [0, yBottom],
    [run, yBottom],
    [run, yTop1],
    [0, yTop0],
  ]
  const faces = []
  for (const side of [-1, 1]) {
    const f = G.polygon(prof, 0, { normalZ: 1, tile: 2 })
    // map polygon x->z, keep y; place at x = side*thick/2 with normal +-x
    const pos = f.attributes.position
    const nor = f.attributes.normal
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getX(i)
      pos.setXYZ(i, (side * thick) / 2, pos.getY(i), z)
      nor.setXYZ(i, side, 0, 0)
    }
    G.orientFaces(f)
    faces.push(f)
  }
  // top (sloped) and end faces
  const top = G.strip([[0, yTop0], [run, yTop1]], thick / 2, -thick / 2, [run / 2, yTop1 + 5], 2)
  {
    // strip is built in XY with z extrusion; remap x->z, z->x
    const pos = top.attributes.position
    const nor = top.attributes.normal
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      pos.setXYZ(i, z, pos.getY(i), x)
      const nx = nor.getX(i)
      const nz = nor.getZ(i)
      nor.setXYZ(i, nz, nor.getY(i), nx)
    }
    G.orientFaces(top)
  }
  const front = G.box(thick, yTop0 - yBottom, 0.01, { y: yBottom, z: 0.005 })
  const back = G.box(thick, yTop1 - yBottom, 0.01, { y: yBottom, z: run - 0.005 })
  return G.merge([...faces, top, front, back])
}

/** Marble side face for the box's back block (built in place). */
function fixSideFace(face, side, wdt, backZ, depth, y0, backH) {
  // rebuild explicitly: vertical quad at x = side*wdt/2 spanning z backZ..depth, y y0..y0+backH
  const positions = []
  const normals = []
  const uvs = []
  const x = (side * wdt) / 2
  const pts = [
    [backZ, y0],
    [depth, y0],
    [depth, y0 + backH],
    [backZ, y0 + backH],
  ]
  for (const [z, y] of pts) {
    positions.push(x, y, z)
    normals.push(side, 0, 0)
    uvs.push(z / 1.5, -y / 1.5)
  }
  return G.orientFaces(G.makeGeometry(positions, normals, uvs, [0, 1, 2, 0, 2, 3]))
}

/** Purple valance with a scalloped bottom edge, in the XY plane at depth z. */
function scallopedValance(width, yBottom, yTop, z) {
  const n = Math.round(width / 0.35)
  const contour = [[-width / 2, yTop]]
  for (let i = 0; i <= n * 4; i++) {
    const x = -width / 2 + (i / (n * 4)) * width
    const y = yBottom + 0.09 * Math.abs(Math.sin((i / 4) * Math.PI))
    contour.push([x, y])
  }
  contour.push([width / 2, yTop])
  const g = G.polygon(contour, z, { normalZ: -1, tile: 0.5 })
  return g
}

/** Hanging cloth banner (facing -Z) with a bronze rod and brackets. Origin: bottom center. */
function makeBanner(wdt, hgt) {
  const cloth = G.polygon([[-wdt / 2, 0], [wdt / 2, 0], [wdt / 2, hgt], [-wdt / 2, hgt]], 0, { normalZ: -1 })
  const uv = cloth.attributes.uv
  const pos = cloth.attributes.position
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (pos.getX(i) + wdt / 2) / wdt, 1 - pos.getY(i) / hgt)
  }
  // slight billow
  for (let i = 0; i < pos.count; i++) pos.setZ(i, -0.02)
  const rod = new THREE.CylinderGeometry(0.03, 0.03, wdt + 0.3, 10)
  rod.rotateZ(Math.PI / 2)
  rod.translate(0, hgt + 0.02, -0.02)
  const brackets = G.merge([
    G.box(0.06, 0.06, 0.16, { x: -wdt / 2 - 0.05, y: hgt - 0.01, z: 0.08 }),
    G.box(0.06, 0.06, 0.16, { x: wdt / 2 + 0.05, y: hgt - 0.01, z: 0.08 }),
  ])
  return { cloth, rod: G.merge([rod, brackets]) }
}

/** Iron portcullis filling an arch opening (a = half width, s = springing), at depth z. */
function makeGrate(a, s, z) {
  const parts = []
  const nBars = Math.max(3, Math.round((2 * a) / 0.36))
  for (let i = 0; i < nBars; i++) {
    const x = -a + ((i + 0.5) / nBars) * 2 * a
    const h = s + Math.sqrt(Math.max(0, a * a - x * x)) - 0.03
    const bar = new THREE.CylinderGeometry(0.03, 0.03, h, 8)
    bar.translate(x, h / 2, z)
    parts.push(bar)
  }
  const rows = Math.max(2, Math.round((s + a) / 0.7))
  for (let j = 0; j < rows; j++) {
    const y = ((j + 0.5) / rows) * (s + a * 0.6)
    const halfW = y < s ? a : Math.sqrt(Math.max(0, a * a - (y - s) * (y - s)))
    parts.push(G.box(2 * halfW - 0.02, 0.05, 0.05, { y: y - 0.025, z }))
  }
  return G.merge(parts)
}

/** Bronze tripod brazier. Origin at the bowl rim center; legs extend downward. */
function makeBrazier() {
  const parts = []
  const rimY = 1.1
  const bowl = G.lathe(
    [
      { r: 0.0, y: -0.42 },
      { r: 0.22, y: -0.4 },
      { r: 0.4, y: -0.28 },
      { r: 0.48, y: -0.1 },
      { r: 0.52, y: 0 },
      { r: 0.5, y: 0.04 },
      { r: 0.45, y: 0.02 },
      { r: 0.36, y: -0.2 },
      { r: 0.0, y: -0.3 },
    ],
    24,
    { tile: 1, smoothAngle: 50 }
  )
  parts.push(bowl)
  parts.push(G.torus(0.5, 0.035, 24, 8, { y: 0.03 }))
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * TAU
    const leg = new THREE.CylinderGeometry(0.035, 0.05, 1.05, 8)
    leg.translate(0, -0.5, 0)
    leg.rotateX(0.2)
    leg.rotateY(ang)
    leg.translate(Math.sin(ang) * 0.32, -0.12, Math.cos(ang) * 0.32)
    parts.push(leg)
    const foot = G.sphere(0.07, 8, { x: Math.sin(ang) * 0.5, y: -rimY + 0.05, z: Math.cos(ang) * 0.5 })
    parts.push(foot)
  }
  parts.push(G.torus(0.3, 0.025, 16, 6, { y: -0.75 }))
  const coals = G.lathe(
    [
      { r: 0, y: -0.16 },
      { r: 0.3, y: -0.12 },
      { r: 0.42, y: -0.06 },
    ],
    16,
    { tile: 1 }
  )
  // charred logs stacked over the coals
  const logs = []
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * TAU + 0.4
    const log = new THREE.CylinderGeometry(0.05, 0.06, 0.72, 8)
    log.rotateZ(Math.PI / 2)
    log.rotateX(0.12 * (i % 2 ? 1 : -1))
    log.rotateY(ang)
    log.translate(0, -0.11 + i * 0.045, 0)
    logs.push(log)
  }
  return { bronze: G.merge(parts), coals, logs: G.merge(logs), rimY }
}

/** Marble throne with gold trim and a purple cushion. Faces -Z. Origin at the base. */
function makeThrone() {
  const marble = []
  const gold = []
  marble.push(G.box(0.9, 0.5, 0.75, { y: 0, tile: 1.5 }))
  marble.push(G.box(0.9, 1.25, 0.14, { y: 0.5, z: 0.3, tile: 1.5 }))
  const topper = new THREE.CylinderGeometry(0.45, 0.45, 0.14, 24, 1, false, 0, Math.PI)
  topper.rotateX(Math.PI / 2)
  topper.rotateY(Math.PI)
  topper.translate(0, 1.75, 0.3)
  marble.push(topper)
  for (const side of [-1, 1]) {
    marble.push(G.box(0.12, 0.3, 0.7, { x: side * 0.39, y: 0.5, z: 0.0, tile: 1.5 }))
    gold.push(G.sphere(0.07, 10, { x: side * 0.39, y: 0.82, z: -0.3 }))
    gold.push(G.box(0.03, 1.25, 0.03, { x: side * 0.46, y: 0.5, z: 0.3 }))
  }
  gold.push(G.torus(0.12, 0.03, 16, 8, { y: 1.62, z: 0.23 }))
  gold.push(G.box(0.9, 0.04, 0.75, { y: 0.48, z: 0 }))
  const cushion = G.box(0.74, 0.12, 0.6, { y: 0.52, z: -0.02 })
  return { marble: G.merge(marble), gold: G.merge(gold), cushion }
}

/** Gold aquila standard on a pole. Origin at the pole base. */
function makeStandard() {
  const pole = new THREE.CylinderGeometry(0.025, 0.03, 2.7, 8)
  pole.translate(0, 1.35, 0)
  const bar = G.box(0.5, 0.05, 0.05, { y: 2.55 })
  const eagle = G.eagle(0.9)
  eagle.translate(0, 2.72, 0)
  const disc = new THREE.CylinderGeometry(0.16, 0.16, 0.03, 16)
  disc.rotateX(Math.PI / 2)
  disc.translate(0, 2.2, 0)
  return G.merge([pole, bar, eagle, disc])
}

/** Bronze clipeus (round shield) facing +Z at height y, hung on the attic wall. */
function shieldDisc(r, y) {
  const disc = new THREE.CylinderGeometry(r, r * 0.92, 0.1, 28)
  disc.rotateX(Math.PI / 2)
  disc.translate(0, y, 0.05)
  const boss = G.sphere(r * 0.28, 12, { y, z: 0.1, sz: 0.6 })
  const rim = G.torus(r, 0.03, 28, 8)
  rim.rotateX(Math.PI / 2)
  rim.translate(0, y, 0.1)
  return G.merge([disc, boss, rim])
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
