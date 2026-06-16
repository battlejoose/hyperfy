import * as THREE from './three'
import { createNode } from './createNode'

const BARRIZER_IDS = ['barrizer', 'barrizer_2']
const FIRE_HEIGHT_OFFSET = 0.2

let fireTextureUrl = null

function drawFireFrame(ctx, x, y, w, h, t) {
  const cx = x + w * (0.48 + Math.sin(t * Math.PI * 2) * 0.04)
  const cy = y + h * (0.72 + Math.cos(t * Math.PI * 2) * 0.03)
  const radius = w * (0.34 + Math.sin(t * Math.PI * 4) * 0.04)

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
  gradient.addColorStop(0, `rgba(255, 255, 180, ${0.95 - t * 0.15})`)
  gradient.addColorStop(0.35, `rgba(255, 170, 40, ${0.85 - t * 0.2})`)
  gradient.addColorStop(0.7, `rgba(255, 70, 0, ${0.45 - t * 0.15})`)
  gradient.addColorStop(1, 'rgba(120, 20, 0, 0)')

  ctx.fillStyle = gradient
  ctx.fillRect(x, y, w, h)
}

function getFireTextureUrl() {
  if (fireTextureUrl) return fireTextureUrl
  if (typeof document === 'undefined') return '/particle.png'

  const cols = 4
  const rows = 4
  const frameSize = 64
  const canvas = document.createElement('canvas')
  canvas.width = frameSize * cols
  canvas.height = frameSize * rows
  const ctx = canvas.getContext('2d')

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const frame = row * cols + col
      drawFireFrame(ctx, col * frameSize, row * frameSize, frameSize, frameSize, frame / (cols * rows))
    }
  }

  fireTextureUrl = canvas.toDataURL('image/png')
  return fireTextureUrl
}

const _boxCorner = new THREE.Vector3()
const _worldCorner = new THREE.Vector3()
const _rootLocal = new THREE.Vector3()
const _invRootMatrix = new THREE.Matrix4()

function getWorldFirePosition(anchorNode) {
  anchorNode.updateTransform()

  const geometry = anchorNode._geometry
  if (!geometry) {
    const pos = new THREE.Vector3()
    anchorNode.getWorldPosition(pos)
    pos.y += 0.5
    return pos
  }

  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const { min, max } = geometry.boundingBox

  let topY = -Infinity
  let cx = 0
  let cz = 0
  let count = 0

  for (let xi = 0; xi <= 1; xi++) {
    for (let yi = 0; yi <= 1; yi++) {
      for (let zi = 0; zi <= 1; zi++) {
        _boxCorner.set(xi ? max.x : min.x, yi ? max.y : min.y, zi ? max.z : min.z)
        _worldCorner.copy(_boxCorner).applyMatrix4(anchorNode.matrixWorld)
        topY = Math.max(topY, _worldCorner.y)
        cx += _worldCorner.x
        cz += _worldCorner.z
        count++
      }
    }
  }

  return new THREE.Vector3(cx / count, topY + FIRE_HEIGHT_OFFSET, cz / count)
}

function worldToRootLocal(root, worldPos) {
  root.updateTransform()
  _invRootMatrix.copy(root.matrixWorld).invert()
  return _rootLocal.copy(worldPos).applyMatrix4(_invRootMatrix)
}

function createFireEmitter() {
  return createNode('particles', {
    emitting: true,
    shape: ['cone', 0.28, 0.7, 24],
    direction: 0.3,
    rate: 45,
    duration: 9999,
    loop: true,
    max: 220,
    life: '0.4~1',
    speed: '0.8~1.6',
    size: '0.35~0.9',
    rotate: '0~360',
    color: '#ffaa33',
    alpha: '0.9~1',
    emissive: '3~6',
    image: getFireTextureUrl(),
    spritesheet: [4, 4, 14, true],
    blending: 'additive',
    lit: false,
    billboard: 'full',
    space: 'world',
    force: new THREE.Vector3(0, 1.8, 0),
    sizeOverLife: '0,0.35|0.25,1|1,0.15',
    alphaOverLife: '0,0.95|0.6,0.85|1,0',
    colorOverLife: '0,#fff4aa|0.35,#ff9900|1,#aa2200',
    emissiveOverLife: '0,4|0.4,3|1,0',
  })
}

function findBarrizerNodes(root) {
  const nodes = []
  for (const id of BARRIZER_IDS) {
    const node = root.get(id)
    if (node) nodes.push(node)
  }
  if (nodes.length) return nodes

  root.traverse(node => {
    if (typeof node.id === 'string' && /barrizer/i.test(node.id)) {
      nodes.push(node)
    }
  })
  return nodes
}

export function addArenaFireEffects(world, root) {
  if (typeof window === 'undefined') return
  if (!world.particles) {
    console.warn('[Arena] Particles system unavailable — skipping fire effects')
    return
  }

  const barrizers = findBarrizerNodes(root)
  if (!barrizers.length) {
    console.warn('[Arena] No barrizer meshes found for fire effects')
    return
  }

  for (const barrizer of barrizers) {
    const worldPos = getWorldFirePosition(barrizer)
    const localPos = worldToRootLocal(root, worldPos)

    const fire = createFireEmitter()
    fire.position.copy(localPos)
    fire.setTransformed()
    root.add(fire)
    fire.setDirty()
  }

  root.setDirty()
  world.stage?.clean()
}
