import * as THREE from './three'
import { createNode } from './createNode'

const BARRIZER_IDS = ['barrizer', 'barrizer_2']
const FIRE_Y_OFFSET = 0.05

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

function getLocalTopY(node) {
  const geometry = node._geometry
  if (!geometry) return 1
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  return geometry.boundingBox.max.y + FIRE_Y_OFFSET
}

function createFireEmitter() {
  const fire = createNode('particles', {
    emitting: true,
    shape: ['cone', 0.22, 0.65, 22],
    direction: 0.25,
    rate: 36,
    duration: 9999,
    loop: true,
    max: 180,
    life: '0.35~0.85',
    speed: '0.7~1.4',
    size: '0.12~0.38',
    rotate: '0~360',
    color: '#ffaa33',
    alpha: '0.85~1',
    emissive: '2~4',
    image: getFireTextureUrl(),
    spritesheet: [4, 4, 14, true],
    blending: 'additive',
    lit: false,
    billboard: 'full',
    space: 'local',
    sizeOverLife: '0,0.35|0.25,1|1,0.15',
    alphaOverLife: '0,0.9|0.6,0.85|1,0',
    colorOverLife: '0,#fff4aa|0.35,#ff9900|1,#aa2200',
    emissiveOverLife: '0,3.5|0.4,2.5|1,0',
  })
  fire.force = new THREE.Vector3(0, 1.4, 0)
  return fire
}

export function addArenaFireEffects(world, root) {
  if (world.network?.isServer || !world.particles) return

  const barrizers = []
  root.traverse(node => {
    if (BARRIZER_IDS.includes(node.id)) barrizers.push(node)
  })

  if (!barrizers.length) {
    console.warn('[Arena] No barrizer meshes found for fire effects')
    return
  }

  for (const barrizer of barrizers) {
    const fire = createFireEmitter()
    fire.position.y = getLocalTopY(barrizer)
    barrizer.add(fire)
  }
}
