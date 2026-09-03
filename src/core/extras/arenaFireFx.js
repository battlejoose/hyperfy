import * as THREE from './three'

/**
 * Brazier fire — fully procedural (no asset).
 *
 * Each brazier gets a small group of additive shader billboards: a main flame
 * and a hotter inner core (cylindrical billboards driven by animated 3D noise),
 * a soft heat glow at the base, rising ember sparks, and a wisp of smoke.
 * The braziers are the `barrizer` nodes in the colosseum GLB; their origin sits
 * on the bowl rim.
 */
export const BARRIZER_IDS = ['barrizer', 'barrizer_2']
/** Vertical offset of the fire from the brazier node (bowl rim). */
const FIRE_Y_OFFSET = -0.08

const FLAME_WIDTH = 0.95
const FLAME_HEIGHT = 1.35
const CORE_WIDTH = 0.55
const CORE_HEIGHT = 0.95
const GLOW_SIZE = 1.6
const SMOKE_WIDTH = 1.4
const SMOKE_BOTTOM = 0.8
const SMOKE_HEIGHT = 2.8
const EMBER_COUNT = 48

const NOISE_GLSL = /* glsl */ `
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
      f.z
    );
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise3(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return v;
  }
`

// Quad that always faces the camera around the Y axis (flames, smoke).
const CYLINDRICAL_BILLBOARD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 origin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCam = cameraPosition - origin;
    toCam.y = 0.0;
    float len = length(toCam);
    vec3 fwd = len > 0.0001 ? toCam / len : vec3(0.0, 0.0, 1.0);
    vec3 right = vec3(fwd.z, 0.0, -fwd.x);
    vec3 worldPos = origin + right * position.x + vec3(0.0, position.y, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`

// Quad that fully faces the camera (glow).
const SPHERICAL_BILLBOARD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 origin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 worldPos = origin + camRight * position.x + camUp * position.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`

const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uIntensity;
  uniform float uSpeed;
  uniform float uDetail;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    float t = uTime * uSpeed;
    float x = vUv.x * 2.0 - 1.0;
    float y = vUv.y;
    // rising, warped noise field
    vec3 p = vec3(x * uDetail, y * 2.2 - t * 1.6, uSeed + t * 0.12);
    float warp = fbm(p * 1.4 + vec3(0.0, -t * 0.5, 0.0));
    float n = fbm(p + vec3(warp * 1.3, warp * 0.5, 0.0));
    // the whole tongue sways
    float sway = (fbm(vec3(y * 1.6 - t * 0.8, uSeed * 3.0, 4.0)) - 0.5) * 0.7 * y;
    float halfWidth = mix(0.9, 0.04, pow(y, 0.6));
    float d = abs(x - sway) / halfWidth;
    float body = 1.0 - smoothstep(0.35, 1.0, d);
    // noise carves the tongues; the top thins out
    float dens = body * (n * 2.1 - 0.35) - pow(y, 1.3) * 0.55;
    float alpha = smoothstep(0.03, 0.45, dens);
    // flicker
    float flick = 0.8 + 0.4 * fbm(vec3(t * 2.5, uSeed * 7.0, 1.0));
    // temperature -> colour (hot core only low in the flame)
    float heat = clamp(dens * 1.5 + (1.0 - y) * 0.45 - 0.15, 0.0, 1.0);
    vec3 col = mix(vec3(0.55, 0.03, 0.0), vec3(1.0, 0.32, 0.02), smoothstep(0.05, 0.4, heat));
    col = mix(col, vec3(1.0, 0.68, 0.12), smoothstep(0.45, 0.8, heat));
    col = mix(col, vec3(1.0, 0.92, 0.6), smoothstep(0.86, 1.0, heat) * 0.7);
    alpha *= smoothstep(0.0, 0.07, y) * (1.0 - smoothstep(0.82, 1.0, y)) * flick;
    alpha = clamp(alpha, 0.0, 1.0);
    gl_FragColor = vec4(col * alpha * uIntensity, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const GLOW_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    float flick = 0.8 + 0.4 * fbm(vec3(uTime * 3.0, uSeed * 5.0, 2.0));
    float a = pow(clamp(1.0 - r, 0.0, 1.0), 2.2) * 0.32 * flick;
    vec3 col = mix(vec3(1.0, 0.3, 0.04), vec3(1.0, 0.7, 0.25), a * 2.0);
    gl_FragColor = vec4(col * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const SMOKE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    float t = uTime;
    float x = vUv.x * 2.0 - 1.0;
    float y = vUv.y;
    vec3 p = vec3(x * 1.4, y * 1.6 - t * 0.55, uSeed + 9.0 + t * 0.05);
    float warp = fbm(p * 0.9);
    float n = fbm(p + vec3(warp * 1.5, warp, 0.0));
    float sway = (fbm(vec3(y * 1.2 - t * 0.35, uSeed, 7.0)) - 0.5) * 1.2 * y;
    float halfWidth = mix(0.35, 1.0, y);
    float d = abs(x - sway) / halfWidth;
    float body = 1.0 - smoothstep(0.4, 1.0, d);
    float dens = body * (n * 1.3 - 0.35);
    float a = smoothstep(0.0, 0.5, dens) * 0.28;
    a *= smoothstep(0.0, 0.15, y) * (1.0 - smoothstep(0.55, 1.0, y));
    vec3 col = vec3(0.16, 0.15, 0.14) + n * 0.12;
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const EMBER_VERT = /* glsl */ `
  uniform float uTime;
  attribute float aSeed;
  attribute vec2 aCorner;
  varying float vLife;
  varying vec2 vCorner;
  void main() {
    vCorner = aCorner;
    float speed = 0.28 + aSeed * 0.3;
    float life = fract(uTime * speed + aSeed * 11.0);
    vLife = life;
    float ang = aSeed * 6.2831 + life * (1.5 + aSeed);
    float rad = 0.3 * (0.35 + fract(aSeed * 13.0) * 0.65) * (1.0 + life * 0.6);
    vec3 pos = vec3(cos(ang) * rad + sin(life * 11.0 + aSeed * 30.0) * 0.06, life * 2.1, sin(ang) * rad);
    float size = 0.03 * (1.0 - life * 0.55);
    vec3 origin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 worldPos = origin + pos + (camRight * aCorner.x + camUp * aCorner.y) * size;
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`

const EMBER_FRAG = /* glsl */ `
  varying float vLife;
  varying vec2 vCorner;
  void main() {
    float r = length(vCorner);
    float a = smoothstep(1.0, 0.25, r) * (1.0 - smoothstep(0.55, 1.0, vLife));
    vec3 col = mix(vec3(1.0, 0.85, 0.4), vec3(1.0, 0.3, 0.04), vLife);
    gl_FragColor = vec4(col * a * 1.1, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function billboardQuad(width, height, baseY = 0) {
  const g = new THREE.PlaneGeometry(width, height)
  g.translate(0, height / 2 + baseY, 0)
  return g
}

function emberGeometry(count, seed) {
  const positions = new Float32Array(count * 4 * 3)
  const seeds = new Float32Array(count * 4)
  const corners = new Float32Array(count * 4 * 2)
  const indices = []
  let s = seed
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
  for (let i = 0; i < count; i++) {
    const r = rand()
    const cornerList = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
    for (let k = 0; k < 4; k++) {
      seeds[i * 4 + k] = r
      corners[(i * 4 + k) * 2] = cornerList[k][0]
      corners[(i * 4 + k) * 2 + 1] = cornerList[k][1]
    }
    const b = i * 4
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  g.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2))
  g.setIndex(indices)
  return g
}

function additiveMaterial(vertexShader, fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

/** Premultiplied-alpha blend: keeps the flame colour saturated over a bright background. */
function flameMaterial(vertexShader, fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    premultipliedAlpha: true,
    side: THREE.DoubleSide,
  })
}

/** Builds one brazier fire. Origin = bowl rim center. */
export function createBrazierFire(seed = 0) {
  const group = new THREE.Group()
  const time = { value: 0 }
  const disposables = []

  const add = (geometry, material, renderOrder) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = renderOrder
    group.add(mesh)
    disposables.push(geometry, material)
    return mesh
  }

  // glow at the base
  add(
    billboardQuad(GLOW_SIZE, GLOW_SIZE, -GLOW_SIZE / 2 + 0.3),
    additiveMaterial(SPHERICAL_BILLBOARD_VERT, GLOW_FRAG, { uTime: time, uSeed: { value: seed } }),
    10
  )
  // main flame
  add(
    billboardQuad(FLAME_WIDTH, FLAME_HEIGHT),
    flameMaterial(CYLINDRICAL_BILLBOARD_VERT, FLAME_FRAG, {
      uTime: time,
      uSeed: { value: seed },
      uIntensity: { value: 1.0 },
      uSpeed: { value: 1.0 },
      uDetail: { value: 2.2 },
    }),
    11
  )
  // hot inner core, faster and finer
  add(
    billboardQuad(CORE_WIDTH, CORE_HEIGHT),
    flameMaterial(CYLINDRICAL_BILLBOARD_VERT, FLAME_FRAG, {
      uTime: time,
      uSeed: { value: seed + 37.0 },
      uIntensity: { value: 1.15 },
      uSpeed: { value: 1.4 },
      uDetail: { value: 2.8 },
    }),
    12
  )
  // embers
  add(emberGeometry(EMBER_COUNT, Math.floor(seed * 1000) + 7), additiveMaterial(EMBER_VERT, EMBER_FRAG, { uTime: time }), 13)
  // smoke (normal blending, drawn last)
  const smoke = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uSeed: { value: seed + 5.0 } },
    vertexShader: CYLINDRICAL_BILLBOARD_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  add(billboardQuad(SMOKE_WIDTH, SMOKE_HEIGHT, SMOKE_BOTTOM), smoke, 9)

  group.userData.fireTime = time
  group.userData.fireDisposables = disposables
  return group
}

const _pos = new THREE.Vector3()

export async function addArenaFireFx(world, arenaRoot) {
  if (world.network?.isServer) return

  arenaRoot.updateTransform()
  world._arenaFireMeshes = world._arenaFireMeshes || []
  world._arenaFireMixers = world._arenaFireMixers || []
  world._arenaFires = world._arenaFires || []

  BARRIZER_IDS.forEach((id, i) => {
    const anchor = arenaRoot.get(id)
    if (!anchor) {
      console.warn('[Arena] barrizer not found:', id)
      return
    }
    anchor.updateTransform()
    _pos.setFromMatrixPosition(anchor.matrixWorld)

    const fire = createBrazierFire(i * 13.7 + 1.3)
    fire.position.copy(_pos)
    fire.position.y += FIRE_Y_OFFSET
    // desync the two fires
    fire.userData.fireTime.value = i * 4.1

    world.stage.scene.add(fire)
    world._arenaFireMeshes.push(fire)
    world._arenaFires.push(fire)
  })
}

export function updateArenaFireFx(world, delta) {
  const fires = world._arenaFires
  if (fires?.length) {
    const dt = Math.min(delta, 0.1)
    for (const fire of fires) fire.userData.fireTime.value += dt
  }
  const mixers = world._arenaFireMixers
  if (!mixers?.length) return
  for (const mixer of mixers) {
    mixer.update(delta)
  }
}

export function clearArenaFireFx(world) {
  if (world._arenaFireMeshes?.length) {
    for (const obj of world._arenaFireMeshes) {
      world.stage?.scene?.remove(obj)
      for (const d of obj.userData?.fireDisposables || []) d.dispose?.()
    }
  }
  world._arenaFireMeshes = null
  world._arenaFireMixers = null
  world._arenaFires = null
}
