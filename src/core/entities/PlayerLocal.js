import { Entity } from './Entity'
import { clamp } from '../utils'
import * as THREE from '../extras/three'
import { XRControllerModelFactory } from 'three/addons'
import { Layers } from '../extras/Layers'
import { DEG2RAD, RAD2DEG } from '../extras/general'
import { createNode } from '../extras/createNode'
import { bindRotations } from '../extras/bindRotations'
import { simpleCamLerp } from '../extras/simpleCamLerp'
import { Emotes, KickTiming } from '../extras/playerEmotes'
import { ControlPriorities } from '../extras/ControlPriorities'
import { isBoolean, isNumber } from 'lodash-es'
import { hasRank, Ranks } from '../extras/ranks'

const UP = new THREE.Vector3(0, 1, 0)
const DOWN = new THREE.Vector3(0, -1, 0)
const FORWARD = new THREE.Vector3(0, 0, -1)
const BACKWARD = new THREE.Vector3(0, 0, 1)
const SCALE_IDENTITY = new THREE.Vector3(1, 1, 1)
const POINTER_LOOK_SPEED = 0.1
const PAN_LOOK_SPEED = 0.4
const ZOOM_SPEED = 2
const MIN_ZOOM = 0
const MAX_ZOOM = 8
const STICK_OUTER_RADIUS = 50
const STICK_INNER_RADIUS = 25
const DEFAULT_CAM_HEIGHT = 1.2

const v1 = new THREE.Vector3()
const v2 = new THREE.Vector3()
const v3 = new THREE.Vector3()
const v4 = new THREE.Vector3()
const v5 = new THREE.Vector3()
const v6 = new THREE.Vector3()
const e1 = new THREE.Euler(0, 0, 0, 'YXZ')
const q1 = new THREE.Quaternion()
const q2 = new THREE.Quaternion()
const q3 = new THREE.Quaternion()
const q4 = new THREE.Quaternion()
const m1 = new THREE.Matrix4()
const m2 = new THREE.Matrix4()
const m3 = new THREE.Matrix4()

const gazeTiltAngle = 10 * DEG2RAD
const gazeTiltAxis = new THREE.Vector3(1, 0, 0) // X-axis for pitch

// TODO: de-dup createVRMFactory.js has a copy
const Modes = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  JUMP: 3,
  FALL: 4,
  FLY: 5,
  TALK: 6,
}

export class PlayerLocal extends Entity {
  constructor(world, data, local) {
    super(world, data, local)
    this.isPlayer = true
    this.isLocal = true
    this.init()
  }

  async init() {
    this.mass = 1
    this.gravity = 20
    this.effectiveGravity = this.gravity * this.mass
    this.jumpHeight = 1.5

    this.capsuleRadius = 0.3
    this.capsuleHeight = 1.6

    this.grounded = false
    this.groundAngle = 0
    this.groundNormal = new THREE.Vector3().copy(UP)
    this.groundSweepRadius = this.capsuleRadius - 0.01 // slighty smaller than player
    this.groundSweepGeometry = new PHYSX.PxSphereGeometry(this.groundSweepRadius)

    // Sword collision tracking
    this.swordColliderActive = false
    this.swordColliderReady = false // Prevents phantom hits from re-enabling collider
    this.hitPlayersThisSwing = new Set()
    
    // Attack timing
    this.attackWindupTime = 0.5 // 500ms windup before collider activates
    this.attackDuration = 1.0 // Total attack duration
    this.currentAttackEmote = null
    this.attackWindupTimeout = null
    this.attackEndTimeout = null
    this.attackFreezeTimeout = null
    this.attackEarlyReleaseHoldTimeout = null
    this.isInWindup = false
    this.isCommitted = false
    this.attackAnimationPaused = false
    
    // Block state
    this.isBlocking = false
    this.blockTimeout = null
    this.blockDuration = 1.0 // Block animation duration
    this.blockBreakCooldownUntil = 0
    this.kickDuration = KickTiming.duration
    this.kickColliderDelay = KickTiming.colliderDelay
    this.kickColliderDuration = KickTiming.colliderDuration
    this.kickColliderActive = false
    this.kickActivateTimeout = null
    this.kickDeactivateTimeout = null
    this.hitPlayersThisKick = new Set()
    this.isKicking = false
    
    // Death/respawn state
    this.isDead = false
    this.deathTimeout = null
    
    // Particle system
    this.activeParticles = []
    
    // Mouse drag attack tracking
    this.mouseDragStart = null // { time }
    this.mouseDragAccumulated = null // { x, y } - accumulated delta from start
    this.isDragging = false
    this.dragThreshold = 30 // pixels to move before it's considered a drag
    this.isChargingAttack = false // holding at backswing, waiting for release
    this.chargedAttackEmote = null // which attack is being charged
    this.chargeStartTime = null // when charged attack backswing started
    this.pendingChargedRelease = false // mouse released early — swing when windup completes
    this.earlyReleaseHoldActive = false // mandatory backswing hold after early release
    
    // Mouse drag block tracking
    this.blockDragStart = null // { time }
    this.blockDragAccumulated = null // { x, y } - accumulated delta from start
    this.isBlockDragging = false
    this.isHoldingBlock = false // holding at block pose, waiting for release
    this.currentBlockEmote = null // which block direction is being held
    this.currentBlockTag = null // 'high', 'left', 'right', 'low'
    
    // Current attack tag for blocking system
    this.currentAttackTag = null // 'high', 'left', 'right', 'low'

    this.pushForce = null
    this.pushForceInit = false

    this.slipping = false

    this.jumped = false
    this.jumping = false
    this.justLeftGround = false

    this.fallTimer = 0
    this.falling = false

    this.moveDir = new THREE.Vector3()
    this.moving = false

    this.firstPerson = false

    this.lastJumpAt = 0
    this.flying = false
    this.flyForce = 100
    this.flyDrag = 300
    this.flyDir = new THREE.Vector3()

    this.platform = {
      actor: null,
      prevTransform: new THREE.Matrix4(),
    }

    this.xrRig = new THREE.Object3D()
    this.xrRig.rotation.reorder('YXZ')
    this.xrControllerFactory = null
    this.xrControllerLeft = null
    this.xrControllerRight = null

    this.mode = Modes.IDLE
    this.axis = new THREE.Vector3()
    this.gaze = new THREE.Vector3()

    this.speaking = false

    this.lastSendAt = 0

    this.base = createNode('group')
    this.base.position.fromArray(this.data.position)
    this.base.quaternion.fromArray(this.data.quaternion)

    this.hmdDelta = new THREE.Vector3()
    this.hmdLast = new THREE.Vector3()

    this.aura = createNode('group')

    this.nametag = createNode('nametag', { label: '', health: this.data.health, active: false })
    this.aura.add(this.nametag)

    this.bubble = createNode('ui', {
      id: 'bubble',
      // space: 'screen',
      width: 300,
      height: 512,
      // size: 0.01,
      pivot: 'bottom-center',
      // pivot: 'top-left',
      billboard: 'full',
      scaler: [3, 30],
      justifyContent: 'flex-end',
      alignItems: 'center',
      active: false,
    })
    this.bubbleBox = createNode('uiview', {
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderRadius: 10,
      padding: 10,
    })
    this.bubbleText = createNode('uitext', {
      color: 'white',
      fontWeight: 100,
      lineHeight: 1.4,
      fontSize: 16,
    })
    this.bubble.add(this.bubbleBox)
    this.bubbleBox.add(this.bubbleText)
    this.aura.add(this.bubble)

    this.aura.activate({ world: this.world, entity: this })
    this.base.activate({ world: this.world, entity: this })

    this.camHeight = DEFAULT_CAM_HEIGHT

    this.cam = {}
    this.cam.position = new THREE.Vector3().copy(this.base.position)
    this.cam.position.y += this.camHeight
    this.cam.quaternion = new THREE.Quaternion()
    this.cam.rotation = new THREE.Euler(0, 0, 0, 'YXZ')
    bindRotations(this.cam.quaternion, this.cam.rotation)
    this.cam.quaternion.copy(this.base.quaternion)
    this.cam.rotation.x += -15 * DEG2RAD
    this.cam.zoom = 1.5

    if (this.world.loader?.preloader) {
      await this.world.loader.preloader
    }

    this.applyAvatar()
    this.initCapsule()
    this.initControl()

    // Set up collider visualization listener
    this.showColliders = false
    this.world.on('showColliders', (show) => {
      this.showColliders = show
      console.log('[PlayerLocal] Show colliders state changed to:', show)
      
      // Update visibility if meshes already exist
      if (this.swordColliderMesh) this.swordColliderMesh.visible = show
      if (this.capsuleColliderMesh) this.capsuleColliderMesh.visible = show
    })

    this.world.setHot(this, true)
    this.world.on('xrSession', this.onXRSession)
    this.world.emit('ready', true)
  }

  getAvatarUrl() {
    return this.data.sessionAvatar || this.data.avatar || 'asset://avatar.vrm'
  }

  applyAvatar() {
    const avatarUrl = this.getAvatarUrl()
    if (this.avatarUrl === avatarUrl) return
    this.world.loader
      .load('avatar', avatarUrl)
      .then(src => {
        if (this.avatar) this.avatar.deactivate()
        this.avatar = src.toNodes().get('avatar')
        this.avatar.disableRateCheck() // max fps for local player
        this.base.add(this.avatar)
        this.nametag.position.y = this.avatar.getHeadToHeight() + 0.2
        this.bubble.position.y = this.avatar.getHeadToHeight() + 0.2
        if (!this.bubble.active) {
          this.nametag.active = true
        }
        this.avatarUrl = avatarUrl
        this.camHeight = this.avatar.height * 0.9
        this.applySword()
      })
      .catch(err => {
        console.error('[Avatar Load Error]', err)
        console.error('[Avatar Load Error] Avatar URL:', avatarUrl)
        console.error('[Avatar Load Error] Stack:', err.stack)
      })
  }

  applySword() {
    // Load and attach sword to right hand
    this.world.loader
      .load('model', 'asset://sword.glb')
      .then(src => {
        if (this.sword) this.sword.deactivate()
        this.sword = src.toNodes()
        this.sword.activate({ world: this.world, entity: this })
        this.initSwordCollider()
        this.initBlockCollider()
        this.initKickCollider()
      })
      .catch(err => {
        console.error('Failed to load sword:', err)
      })
  }

  initSwordCollider() {
    // Create a box collider for the sword blade
    // Sword is about 1.0 units long, 0.1 wide, 0.05 thick
    const width = 0.1
    const height = 1.0
    const depth = 0.05
    const geometry = new PHYSX.PxBoxGeometry(width / 2, height / 2, depth / 2)
    
    const material = this.world.physics.physics.createMaterial(0, 0, 0)
    // Create as a trigger shape (no SIMULATION_SHAPE flag for triggers)
    const flags = new PHYSX.PxShapeFlags(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE)
    
    this.swordShape = this.world.physics.physics.createShape(geometry, material, true, flags)
    
    // Set up filter data for weapon layer
    const filterData = new PHYSX.PxFilterData(
      Layers.weapon.group,
      Layers.weapon.mask,
      PHYSX.PxPairFlagEnum.eNOTIFY_TOUCH_FOUND | PHYSX.PxPairFlagEnum.eNOTIFY_TOUCH_LOST,
      0
    )
    
    this.swordShape.setQueryFilterData(filterData)
    this.swordShape.setSimulationFilterData(filterData)
    
    // Create kinematic rigidbody for sword
    const transform = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity)
    v1.copy(this.base.position).toPxTransform(transform)
    q1.set(0, 0, 0, 1).toPxTransform(transform)
    
    this.swordBody = this.world.physics.physics.createRigidDynamic(transform)
    this.swordBody.setRigidBodyFlag(PHYSX.PxRigidBodyFlagEnum.eKINEMATIC, true)
    this.swordBody.setActorFlag(PHYSX.PxActorFlagEnum.eDISABLE_GRAVITY, true)
    this.swordBody.attachShape(this.swordShape)
    
    const self = this
    this.swordHandle = this.world.physics.addActor(this.swordBody, {
      tag: 'sword',
      playerId: this.data.id,
      onTriggerEnter: (otherHandle) => {
        self.onSwordHit(otherHandle)
      },
    })
    
    // Start with collider disabled (disable trigger flag)
    this.swordShape.setFlag(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE, false)
    this.swordColliderActive = false
    
    PHYSX.destroy(geometry)
  }

  initBlockCollider() {
    // Create a square collider in front of the player for blocking
    // Roughly the size of the capsule collider (width and height)
    const width = this.capsuleRadius * 3.0 // Slightly wider than capsule
    const height = this.capsuleHeight * 0.9 // Most of the body height (taller)
    const depth = 0.3 // Thin shield in front
    const geometry = new PHYSX.PxBoxGeometry(width / 2, height / 2, depth / 2)
    
    const material = this.world.physics.physics.createMaterial(0, 0, 0)
    // Create as SIMULATION shape so sword triggers can detect it (trigger-to-trigger doesn't work)
    const flags = new PHYSX.PxShapeFlags(PHYSX.PxShapeFlagEnum.eSIMULATION_SHAPE | PHYSX.PxShapeFlagEnum.eSCENE_QUERY_SHAPE)
    
    this.blockShape = this.world.physics.physics.createShape(geometry, material, true, flags)
    
    // Set up filter data for block layer (interacts with weapons)
    const filterData = new PHYSX.PxFilterData(
      Layers.player.group, // Block is part of player
      Layers.weapon.mask,  // Only collides with weapons
      PHYSX.PxPairFlagEnum.eNOTIFY_TOUCH_FOUND,
      0
    )
    
    this.blockShape.setQueryFilterData(filterData)
    this.blockShape.setSimulationFilterData(filterData)
    
    // Create kinematic rigidbody for block collider
    const transform = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity)
    v1.copy(this.base.position).toPxTransform(transform)
    q1.set(0, 0, 0, 1).toPxTransform(transform)
    
    this.blockBody = this.world.physics.physics.createRigidDynamic(transform)
    this.blockBody.setRigidBodyFlag(PHYSX.PxRigidBodyFlagEnum.eKINEMATIC, true)
    this.blockBody.setActorFlag(PHYSX.PxActorFlagEnum.eDISABLE_GRAVITY, true)
    this.blockBody.attachShape(this.blockShape)
    
    const self = this
    this.blockHandle = this.world.physics.addActor(this.blockBody, {
      tag: 'block',
      playerId: this.data.id,
      onTriggerEnter: (otherHandle) => {
        self.onBlockHit(otherHandle)
      },
    })
    
    // Store dimensions for visualization
    this.blockWidth = width
    this.blockHeight = height
    this.blockDepth = depth
    
    // Start with collider disabled (disable simulation flag)
    this.blockShape.setFlag(PHYSX.PxShapeFlagEnum.eSIMULATION_SHAPE, false)
    
    PHYSX.destroy(geometry)
  }

  initKickCollider() {
    // 1x1m cross-section, 3m forward from block collider center
    const width = 0.5
    const height = 0.5
    const depth = 0.75
    const geometry = new PHYSX.PxBoxGeometry(width / 2, height / 2, depth / 2)

    const material = this.world.physics.physics.createMaterial(0, 0, 0)
    const flags = new PHYSX.PxShapeFlags(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE)

    this.kickShape = this.world.physics.physics.createShape(geometry, material, true, flags)

    const filterData = new PHYSX.PxFilterData(
      Layers.weapon.group,
      Layers.weapon.mask,
      PHYSX.PxPairFlagEnum.eNOTIFY_TOUCH_FOUND | PHYSX.PxPairFlagEnum.eNOTIFY_TOUCH_LOST,
      0
    )

    this.kickShape.setQueryFilterData(filterData)
    this.kickShape.setSimulationFilterData(filterData)

    const transform = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity)
    v1.copy(this.base.position).toPxTransform(transform)
    q1.set(0, 0, 0, 1).toPxTransform(transform)

    this.kickBody = this.world.physics.physics.createRigidDynamic(transform)
    this.kickBody.setRigidBodyFlag(PHYSX.PxRigidBodyFlagEnum.eKINEMATIC, true)
    this.kickBody.setActorFlag(PHYSX.PxActorFlagEnum.eDISABLE_GRAVITY, true)
    this.kickBody.attachShape(this.kickShape)

    const self = this
    this.kickHandle = this.world.physics.addActor(this.kickBody, {
      tag: 'kick',
      playerId: this.data.id,
      onTriggerEnter: otherHandle => {
        self.onKickHit(otherHandle)
      },
    })

    this.kickWidth = width
    this.kickHeight = height
    this.kickDepth = depth
    this.blockForwardOffset = 0.5
    this.kickShape.setFlag(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE, false)

    PHYSX.destroy(geometry)
  }

  onBlockHit(otherHandle) {
    // Only process hits when actively blocking
    if (!this.isBlocking) return
    
    // Check if it's a sword
    if (otherHandle.tag !== 'sword') return
    
    const attackerId = otherHandle.playerId
    if (!attackerId) return
    
    // Don't block our own sword
    if (attackerId === this.data.id) return
    
    // Get attacker entity to check their attack tag
    const attacker = this.world.entities.get(attackerId)
    if (!attacker) return
    
    // Check if the block direction matches the attack direction
    const attackTag = attacker.currentAttackTag
    const blockTag = this.currentBlockTag
    
    let blockedSuccessfully = false
    
    // If no block tag, old block behavior (blocks everything)
    if (!blockTag) {
      blockedSuccessfully = true
    } else if (blockTag && attackTag) {
      // Tag-based blocking: check if tags match
      // high blocks high, low blocks low
      // left blocks RIGHT, right blocks LEFT
      if (blockTag === 'high' && attackTag === 'high') blockedSuccessfully = true
      else if (blockTag === 'low' && attackTag === 'low') blockedSuccessfully = true
      else if (blockTag === 'left' && attackTag === 'right') blockedSuccessfully = true
      else if (blockTag === 'right' && attackTag === 'left') blockedSuccessfully = true
    }
    
    if (blockedSuccessfully) {
      console.log('[Block] Successfully blocked attack from player:', attackerId, '- Attack:', attackTag, 'blocked by:', blockTag)
      
      // Spawn spark particles and play block audio at block position (chest area)
      const blockPos = new THREE.Vector3()
      blockPos.copy(this.base.position)
      blockPos.y += this.capsuleHeight * 0.6 // Match block collider height
      this.spawnSparkParticles(blockPos)
      this.playBlockAudio(blockPos)
      
    } else {
      console.log('[Block] Block does NOT match - Attack:', attackTag, 'vs Block:', blockTag, '- attack goes through, taking damage!')
      
      // Spawn blood particles at hit location (block position, since sword hit our block)
      const hitPos = new THREE.Vector3()
      hitPos.copy(this.base.position)
      hitPos.y += this.capsuleHeight * 0.6 // Match block collider height
      this.spawnBloodParticles(hitPos)
      this.playHitAudio(hitPos)
      
      // Don't notify server about block - the attacker will send damage normally
    }
  }

  spawnBloodParticles(position) {
    // Create red blood particles
    const particleCount = 50
    const geometry = new THREE.BoxGeometry(0.03, 0.03, 0.03)
    
    for (let i = 0; i < particleCount; i++) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xaa0000,
        emissive: 0xcc0000,
        emissiveIntensity: 2,
        opacity: 0.9,
        transparent: true,
      })
      
      const particle = new THREE.Mesh(geometry, material)
      particle.position.set(position.x, position.y, position.z)
      this.world.stage.scene.add(particle)
      
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 4
      )
      
      this.addParticle(particle, velocity, 0.6, 2, material)
    }
  }

  spawnSparkParticles(position) {
    // Create yellow spark particles
    const particleCount = 10
    const geometry = new THREE.BoxGeometry(0.02, 0.02, 0.02)
    
    for (let i = 0; i < particleCount; i++) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 4,
        opacity: 1,
        transparent: true,
      })
      
      const particle = new THREE.Mesh(geometry, material)
      particle.position.set(position.x, position.y, position.z)
      this.world.stage.scene.add(particle)
      
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 4 + 2,
        (Math.random() - 0.5) * 6
      )
      
      this.addParticle(particle, velocity, 0.5, 4, material)
    }
  }

  addParticle(particle, velocity, lifetime, initialEmissive, material) {
    const particleData = {
      mesh: particle,
      material: material,
      velocity: velocity,
      lifetime: lifetime,
      elapsed: 0,
      initialEmissive: initialEmissive,
      gravity: 9.8,
    }
    this.activeParticles.push(particleData)
  }

  updateParticles(delta) {
    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const p = this.activeParticles[i]
      p.elapsed += delta
      
      // Apply velocity with gravity
      p.mesh.position.x += p.velocity.x * delta
      p.mesh.position.y += p.velocity.y * delta - p.gravity * p.elapsed * delta
      p.mesh.position.z += p.velocity.z * delta
      
      // Fade out
      const alpha = Math.max(0, 1 - p.elapsed / p.lifetime)
      p.material.opacity = alpha
      p.material.emissiveIntensity = p.initialEmissive * alpha
      
      // Remove if expired
      if (p.elapsed >= p.lifetime) {
        this.world.stage.scene.remove(p.mesh)
        p.material.dispose()
        this.activeParticles.splice(i, 1)
      }
    }
  }

  playHitAudio(position) {
    if (!this.world.audio) {
      console.log('[Audio] Audio system not available')
      return
    }
    
    console.log('[Audio Local] Playing hit sound at position:', position)
    const audio = createNode('audio', {
      src: 'asset://audiohit.mp3',
      volume: 0.5,
      loop: false,
      group: 'sfx',
      spatial: true,
      refDistance: 1,
      maxDistance: 20,
      rolloffFactor: 2,
    })
    
    audio.position.copy(position)
    audio.activate({ world: this.world, entity: this })
    audio.play()
    // Audio will automatically stop and clean up when finished (loop: false)
  }

  playBlockAudio(position) {
    if (!this.world.audio) {
      console.log('[Audio] Audio system not available')
      return
    }
    
    console.log('[Audio Local] Playing block sound at position:', position)
    const audio = createNode('audio', {
      src: 'asset://audioblock.mp3',
      volume: 0.5,
      loop: false,
      group: 'sfx',
      spatial: true,
      refDistance: 1,
      maxDistance: 20,
      rolloffFactor: 2,
    })
    
    audio.position.copy(position)
    audio.activate({ world: this.world, entity: this })
    audio.play()
    // Audio will automatically stop and clean up when finished (loop: false)
  }

  onSwordHit(otherHandle) {
    // Check if it's a player first
    const playerId = otherHandle.playerId
    if (!playerId) return
    
    // Only process hits when collider is active AND ready (prevents phantom hits from re-enabling)
    if (!this.swordColliderActive) {
      console.log('[Sword] Collision detected with', playerId, 'but collider is INACTIVE - ignoring')
      return
    }
    
    if (!this.swordColliderReady) {
      console.log('[Sword] Collision detected with', playerId, 'but collider is NOT READY (phantom hit) - ignoring')
      return
    }
    
    // Check if we hit a BLOCK collider (active blocks disable the sword!)
    if (otherHandle.tag === 'block') {
      const blockerId = otherHandle.playerId
      if (!blockerId) return
      if (blockerId === this.data.id) return // Don't block our own sword
      
      // Get blocker entity to check their block tag
      const blocker = this.world.entities.get(blockerId)
      if (!blocker) return
      
      // Check if the block direction matches the attack direction
      const attackTag = this.currentAttackTag
      const blockTag = blocker.currentBlockTag
      
      console.log('[Sword] Checking block match - Attack tag:', attackTag, 'Block tag:', blockTag, 'Blocker type:', blocker.isRemote ? 'REMOTE' : 'LOCAL')
      
      let blockedSuccessfully = false
      
      // If no tags, old block behavior (blocks everything)
      if (!blockTag) {
        blockedSuccessfully = true
      } else if (blockTag && attackTag) {
        // Tag-based blocking: check if tags match
        // high blocks high, low blocks low
        // left blocks RIGHT, right blocks LEFT
        if (blockTag === 'high' && attackTag === 'high') blockedSuccessfully = true
        else if (blockTag === 'low' && attackTag === 'low') blockedSuccessfully = true
        else if (blockTag === 'left' && attackTag === 'right') blockedSuccessfully = true
        else if (blockTag === 'right' && attackTag === 'left') blockedSuccessfully = true
      }
      
      if (blockedSuccessfully) {
        console.log('[Sword] Hit ACTIVE BLOCK from player:', blockerId, '- Attack:', attackTag, 'blocked by:', blockTag, '- SWORD BLOCKED!')
        
        // Add blocker to hit list to prevent damage in same frame
        this.hitPlayersThisSwing.add(blockerId)
        
        // Deactivate sword for rest of swing
        this.setSwordColliderActive(false)
        
        // Play block sound and spawn spark particles at block position
        if (blocker.base) {
          const blockPos = new THREE.Vector3()
          blockPos.copy(blocker.base.position)
          blockPos.y += 1.8 * 0.6 // Match block collider height
          this.spawnSparkParticles(blockPos)
          
          // Play block audio
          this.playBlockAudio(blockPos)
        }
        
        return
      } else {
        // Block doesn't match attack direction - attack goes through!
        console.log('[Sword] Block from player:', blockerId, 'does NOT match - Attack:', attackTag, 'vs Block:', blockTag, '- attack continues')
        // Continue to damage check below (treat as if no block)
      }
    }
    
    // Don't hit ourselves
    if (playerId === this.data.id) return
    
    // Only hit each player once per swing
    if (this.hitPlayersThisSwing.has(playerId)) {
      console.log('[Sword] Already hit', playerId, 'this swing - ignoring')
      return
    }
    
    this.hitPlayersThisSwing.add(playerId)
    
    // Spawn blood particles and play hit audio at hit location (use sword mesh position)
    if (this.sword) {
      const hitPos = new THREE.Vector3()
      this.sword.getWorldPosition(hitPos)
      this.spawnBloodParticles(hitPos)
      this.playHitAudio(hitPos)
    }
    
    // Send hit notification to server (server will validate and apply damage)
    console.log('[Sword] VALID HIT on player:', playerId, '- notifying server NOW')
    this.world.network.send('playerHit', {
      attackerId: this.data.id,
      targetId: playerId,
      damage: 25,
    })
  }

  onKickHit(otherHandle) {
    if (!this.kickColliderActive) return
    if (otherHandle.tag !== 'block') return

    const blockerId = otherHandle.playerId
    if (!blockerId || blockerId === this.data.id) return
    if (this.hitPlayersThisKick.has(blockerId)) return

    const blocker = this.world.entities.get(blockerId)
    if (!blocker?.isBlocking) return

    this.hitPlayersThisKick.add(blockerId)

    console.log('[Kick] Broke block from player:', blockerId, '- notifying server')
    this.world.network.send('blockBroken', {
      kickerId: this.data.id,
      blockerId,
    })
  }

  startAttack(emote, chargeMode = false) {
    // Can't attack while sprinting
    if (this.running) {
      console.log('[Attack] Cannot attack while sprinting')
      return
    }
    
    // If already charging, ignore
    if (this.isChargingAttack) return
    
    // If we're already committed to an attack (past windup), ignore new input
    if (this.isCommitted) {
      return
    }
    
    // Set attack tag based on emote
    if (emote === Emotes.ATTACK_HIGH) this.currentAttackTag = 'high'
    else if (emote === Emotes.ATTACK_LEFT) this.currentAttackTag = 'left'
    else if (emote === Emotes.ATTACK_RIGHT) this.currentAttackTag = 'right'
    else if (emote === Emotes.ATTACK_LOW) this.currentAttackTag = 'low'
    
    // If we're in windup, this is a cancel + new attack
    if (this.isInWindup) {
      // Cancel previous attack timers
      if (this.attackWindupTimeout) clearTimeout(this.attackWindupTimeout)
      if (this.attackEndTimeout) clearTimeout(this.attackEndTimeout)
      if (this.attackFreezeTimeout) clearTimeout(this.attackFreezeTimeout)
      if (this.attackEarlyReleaseHoldTimeout) clearTimeout(this.attackEarlyReleaseHoldTimeout)
      if (this.attackAnimationPaused) this.resumeAttackAnimation()
      this.setSwordColliderActive(false)
      this.pendingChargedRelease = false
      this.earlyReleaseHoldActive = false
    }
    
    // IMPORTANT: Clear hit tracking NOW, before any collider activation
    this.hitPlayersThisSwing.clear()
    console.log('[Attack] Cleared hit tracking for new attack')
    
    if (chargeMode) {
      // Charge mode: play backswing and hold (or auto-swing if mouse released early)
      console.log('[Attack] CHARGING attack - playing backswing:', emote)
      this.isChargingAttack = true
      this.chargedAttackEmote = emote
      this.chargeStartTime = Date.now()
      this.pendingChargedRelease = false
      this.earlyReleaseHoldActive = false
      this.currentAttackEmote = emote
      this.isInWindup = true
      this.isCommitted = false
      this.attackAnimationPaused = false
      
      // Ensure sword collider is OFF during charge
      this.setSwordColliderActive(false)
      
      // Play the full attack animation with very long duration (so it doesn't expire while holding)
      this.setEffect({
        emote: emote,
        duration: 999, // Very long so player can hold as long as they want
        cancellable: false,
      })
      
      // After windup, pause at backswing — early release swings as soon as windup completes
      this.attackFreezeTimeout = setTimeout(() => {
        if (this.isChargingAttack && this.chargedAttackEmote === emote) {
          if (this.pendingChargedRelease) {
            this.pendingChargedRelease = false
            console.log('[Attack] Early release — swinging at windup completion')
            this.completeChargedAttack()
          } else {
            console.log('[Attack] Pausing animation at backswing pose - hold as long as you want!')
            this.attackAnimationPaused = true
            this.pauseAttackAnimation()
          }
        }
      }, this.attackWindupTime * 1000)
    } else {
      // Normal mode: full attack
      console.log('[Attack] Starting FULL attack:', emote)
      this.currentAttackEmote = emote
      this.isInWindup = true
      this.isCommitted = false
      
      // Play full attack animation
      this.setEffect({
        emote: emote,
        duration: this.attackDuration,
        cancellable: false,
      })
      
      // After windup time, activate sword collider and commit to attack
      this.attackWindupTimeout = setTimeout(() => {
        this.isInWindup = false
        this.isCommitted = true
        this.setSwordColliderActive(true)
      }, this.attackWindupTime * 1000)
      
      // After full attack duration, deactivate and reset
      this.attackEndTimeout = setTimeout(() => {
        this.setSwordColliderActive(false)
        this.currentAttackEmote = null
        this.currentAttackTag = null // Clear attack tag
        this.isInWindup = false
        this.isCommitted = false
      }, this.attackDuration * 1000)
    }
  }
  
  pauseAttackAnimation() {
    try {
      // Access the mixer through the avatar's instance
      if (this.avatar && this.avatar.instance && this.avatar.instance.mixer) {
        const mixer = this.avatar.instance.mixer
        // Pause the mixer itself
        mixer.timeScale = 0
        console.log('[Attack] Animation mixer paused (timeScale = 0)')
      } else {
        console.warn('[Attack] Could not access animation mixer to pause')
      }
    } catch (err) {
      console.error('[Attack] Error pausing animation:', err)
    }
  }

  resumeAttackAnimation() {
    try {
      // Access the mixer through the avatar's instance
      if (this.avatar && this.avatar.instance && this.avatar.instance.mixer) {
        const mixer = this.avatar.instance.mixer
        // Resume the mixer
        mixer.timeScale = 1
        console.log('[Attack] Animation mixer resumed (timeScale = 1)')
      } else {
        console.warn('[Attack] Could not access animation mixer to resume')
      }
    } catch (err) {
      console.error('[Attack] Error resuming animation:', err)
    }
  }

  completeChargedAttack() {
    if (!this.isChargingAttack || !this.chargedAttackEmote) return
    
    console.log('[Attack] RELEASING charged attack - resuming animation:', this.chargedAttackEmote)
    
    // Clear any pending timeouts
    if (this.attackFreezeTimeout) {
      clearTimeout(this.attackFreezeTimeout)
      this.attackFreezeTimeout = null
    }
    if (this.attackEarlyReleaseHoldTimeout) {
      clearTimeout(this.attackEarlyReleaseHoldTimeout)
      this.attackEarlyReleaseHoldTimeout = null
    }
    
    const emote = this.chargedAttackEmote
    this.isChargingAttack = false
    this.chargedAttackEmote = null
    this.chargeStartTime = null
    this.pendingChargedRelease = false
    this.earlyReleaseHoldActive = false
    this.isInWindup = false
    this.isCommitted = true
    
    // Resume the animation if it was paused
    if (this.attackAnimationPaused) {
      this.attackAnimationPaused = false
      this.resumeAttackAnimation()
    }
    
    // Restart the effect with proper duration so it ends at the right time
    this.setEffect({
      emote: emote,
      duration: this.attackDuration - this.attackWindupTime, // Remaining time
      cancellable: false,
    })
    
    this.setSwordColliderActive(true)
    
    // After remaining attack duration (minus the backswing we already played), deactivate and reset
    this.attackEndTimeout = setTimeout(() => {
      this.setSwordColliderActive(false)
      this.currentAttackEmote = null
      this.currentAttackTag = null // Clear attack tag
      this.isInWindup = false
      this.isCommitted = false
      console.log('[Attack] Charged attack complete')
    }, (this.attackDuration - this.attackWindupTime) * 1000)
  }

  cancelAttack() {
    const attackEmotes = [Emotes.ATTACK_LEFT, Emotes.ATTACK_RIGHT, Emotes.ATTACK_HIGH, Emotes.ATTACK_LOW]
    const hasAttackEffect = attackEmotes.includes(this.data.effect?.emote)
    if (
      !this.isInWindup &&
      !this.isCommitted &&
      !this.isChargingAttack &&
      !this.currentAttackEmote &&
      !this.currentAttackTag &&
      !hasAttackEffect
    ) {
      return
    }

    console.log('[Attack] Canceling active attack')

    if (this.attackWindupTimeout) clearTimeout(this.attackWindupTimeout)
    if (this.attackEndTimeout) clearTimeout(this.attackEndTimeout)
    if (this.attackFreezeTimeout) clearTimeout(this.attackFreezeTimeout)
    if (this.attackEarlyReleaseHoldTimeout) clearTimeout(this.attackEarlyReleaseHoldTimeout)
    this.attackWindupTimeout = null
    this.attackEndTimeout = null
    this.attackFreezeTimeout = null
    this.attackEarlyReleaseHoldTimeout = null

    if (this.attackAnimationPaused) {
      this.resumeAttackAnimation()
      this.attackAnimationPaused = false
    }

    this.setSwordColliderActive(false)
    this.isInWindup = false
    this.isCommitted = false
    this.isChargingAttack = false
    this.chargedAttackEmote = null
    this.chargeStartTime = null
    this.pendingChargedRelease = false
    this.earlyReleaseHoldActive = false
    this.currentAttackEmote = null
    this.currentAttackTag = null
    this.hitPlayersThisSwing.clear()
  }

  interruptAttackFromHit() {
    const attackEmotes = [Emotes.ATTACK_LEFT, Emotes.ATTACK_RIGHT, Emotes.ATTACK_HIGH, Emotes.ATTACK_LOW]
    const hasAttackEffect = attackEmotes.includes(this.data.effect?.emote)
    if (
      !this.isInWindup &&
      !this.isCommitted &&
      !this.isChargingAttack &&
      !this.currentAttackEmote &&
      !this.currentAttackTag &&
      !hasAttackEffect
    ) {
      return
    }

    console.log('[Attack] Interrupted by hit')

    this.cancelAttack()

    if (hasAttackEffect) {
      this.setEffect(null)
      this.emote = null
      if (this.avatar?.instance?.mixer) {
        this.avatar.instance.mixer.timeScale = 1
      }
      if (this.avatar?.instance) {
        this.avatar.instance.setEmote(null, undefined, { immediate: true })
      }
    }

    this.mouseDragStart = null
    this.mouseDragAccumulated = null
    this.isDragging = false
  }

  cancelBlock() {
    const blockEmotes = [Emotes.BLOCK, Emotes.BLOCK_HIGH, Emotes.BLOCK_LEFT, Emotes.BLOCK_RIGHT, Emotes.BLOCK_LOW]
    const hasBlockEffect = blockEmotes.includes(this.data.effect?.emote)
    if (!this.isBlocking && !this.isHoldingBlock && !hasBlockEffect) return

    console.log('[Block] Canceling active block')

    if (this.blockTimeout) {
      clearTimeout(this.blockTimeout)
      this.blockTimeout = null
    }
    if (this.blockFreezeTimeout) {
      clearTimeout(this.blockFreezeTimeout)
      this.blockFreezeTimeout = null
    }

    if (this.blockAnimationPaused) {
      this.blockAnimationPaused = false
      this.resumeBlockAnimation()
    }

    this.setBlockColliderActive(false)
    this.isHoldingBlock = false
    this.isBlocking = false
    this.currentBlockEmote = null
    this.currentBlockTag = null
  }

  clearCombatAnimation() {
    const combatEmotes = [
      Emotes.ATTACK_LEFT,
      Emotes.ATTACK_RIGHT,
      Emotes.ATTACK_HIGH,
      Emotes.ATTACK_LOW,
      Emotes.BLOCK,
      Emotes.BLOCK_LEFT,
      Emotes.BLOCK_RIGHT,
      Emotes.BLOCK_HIGH,
      Emotes.BLOCK_LOW,
      Emotes.KICK,
    ]
    if (!combatEmotes.includes(this.data.effect?.emote)) return

    this.setEffect(null)
    this.emote = null

    if (this.avatar?.instance?.mixer) {
      this.avatar.instance.mixer.timeScale = 1
    }
    if (this.avatar?.instance) {
      this.avatar.instance.setEmote(null, undefined, { immediate: true })
    }
  }

  startKick() {
    if (this.isDead) return
    if (this.running) return
    if (this.data.effect?.emote === Emotes.KICK && this.data.effect?.duration > 0) return

    this.cancelAttack()
    this.cancelBlock()
    this.clearCombatAnimation()

    // Clear drag tracking so canceled attack/block input doesn't fire on release
    this.mouseDragStart = null
    this.mouseDragAccumulated = null
    this.isDragging = false
    this.blockDragStart = null
    this.blockDragAccumulated = null
    this.isBlockDragging = false

    if (this.avatar?.instance?.mixer && this.avatar.instance.mixer.timeScale === 0) {
      this.avatar.instance.mixer.timeScale = 1
    }

    this.clearKickColliderTimeouts()
    this.hitPlayersThisKick.clear()
    this.isKicking = true

    this.emote = Emotes.KICK
    this.setEffect({
      emote: Emotes.KICK,
      duration: this.kickDuration,
      cancellable: false,
    })
    if (this.avatar?.instance) {
      this.avatar.instance.setEmote(Emotes.KICK, this.kickDuration)
    }

    this.kickActivateTimeout = setTimeout(() => {
      if (this.isKicking) this.setKickColliderActive(true)
      this.kickActivateTimeout = null
    }, this.kickColliderDelay * 1000)

    this.kickDeactivateTimeout = setTimeout(() => {
      this.setKickColliderActive(false)
      this.kickDeactivateTimeout = null
    }, (this.kickColliderDelay + this.kickColliderDuration) * 1000)
  }

  clearKickColliderTimeouts() {
    if (this.kickActivateTimeout) {
      clearTimeout(this.kickActivateTimeout)
      this.kickActivateTimeout = null
    }
    if (this.kickDeactivateTimeout) {
      clearTimeout(this.kickDeactivateTimeout)
      this.kickDeactivateTimeout = null
    }
    this.setKickColliderActive(false)
    this.isKicking = false
  }

  startBlock(emote = Emotes.BLOCK, holdMode = false) {
    // Can't block while dead
    if (this.isDead) return

    if (Date.now() < this.blockBreakCooldownUntil) {
      console.log('[Block] Block on cooldown after kick break')
      return
    }
    
    // If already blocking or holding a block, ignore
    if (this.isBlocking || this.isHoldingBlock) return
    
    console.log('[Block] Starting block:', emote, 'holdMode:', holdMode)
    this.isBlocking = true
    
    // Set block tag based on emote
    if (emote === Emotes.BLOCK_HIGH) this.currentBlockTag = 'high'
    else if (emote === Emotes.BLOCK_LEFT) this.currentBlockTag = 'left'
    else if (emote === Emotes.BLOCK_RIGHT) this.currentBlockTag = 'right'
    else if (emote === Emotes.BLOCK_LOW) this.currentBlockTag = 'low'
    else this.currentBlockTag = null // Old block emote has no tag (blocks everything)
    
    // Activate block collider
    this.setBlockColliderActive(true)
    
    if (holdMode) {
      // Hold mode: play first 0.5 seconds and hold indefinitely
      console.log('[Block] Starting HOLD block - will pause after 0.5s')
      this.isHoldingBlock = true
      this.currentBlockEmote = emote
      this.blockAnimationPaused = false
      
      // Play block animation with very long duration (999 seconds)
      this.setEffect({
        emote: emote,
        duration: 999, // Very long duration to prevent auto-cancel
        cancellable: false,
      })
      
      // After 0.5 seconds, pause the animation at the block pose
      this.blockFreezeTimeout = setTimeout(() => {
        if (this.isHoldingBlock && this.currentBlockEmote === emote) {
          console.log('[Block] Pausing animation at block pose - hold as long as you want!')
          this.blockAnimationPaused = true
          this.pauseBlockAnimation()
        }
      }, 500) // 0.5 seconds
    } else {
      // Normal mode: full block with duration
      console.log('[Block] Starting NORMAL block with duration')
      
      // Play block animation
      this.setEffect({
        emote: emote,
        duration: this.blockDuration,
        cancellable: false,
      })
      
      // After block duration, deactivate
      this.blockTimeout = setTimeout(() => {
        this.setBlockColliderActive(false)
        this.isBlocking = false
        this.currentBlockTag = null // Clear block tag
        console.log('[Block] Block ended')
      }, this.blockDuration * 1000)
    }
  }
  
  pauseBlockAnimation() {
    try {
      // Access the mixer through the avatar's instance
      if (this.avatar && this.avatar.instance && this.avatar.instance.mixer) {
        const mixer = this.avatar.instance.mixer
        // Pause the mixer itself
        mixer.timeScale = 0
        console.log('[Block] Animation mixer paused (timeScale = 0)')
      } else {
        console.warn('[Block] Could not access animation mixer to pause')
      }
    } catch (err) {
      console.error('[Block] Error pausing animation:', err)
    }
  }
  
  resumeBlockAnimation() {
    try {
      // Access the mixer through the avatar's instance
      if (this.avatar && this.avatar.instance && this.avatar.instance.mixer) {
        const mixer = this.avatar.instance.mixer
        // Resume the mixer
        mixer.timeScale = 1
        console.log('[Block] Animation mixer resumed (timeScale = 1)')
      } else {
        console.warn('[Block] Could not access animation mixer to resume')
      }
    } catch (err) {
      console.error('[Block] Error resuming animation:', err)
    }
  }
  
  stopBlock() {
    if (!this.isHoldingBlock) return
    
    console.log('[Block] Stopping held block')
    
    // Clear any pending freeze timeout
    if (this.blockFreezeTimeout) {
      clearTimeout(this.blockFreezeTimeout)
      this.blockFreezeTimeout = null
    }
    
    // Resume the animation if it was paused
    if (this.blockAnimationPaused) {
      this.blockAnimationPaused = false
      this.resumeBlockAnimation()
    }
    
    // Clear the effect to return to idle
    this.setEffect(null)
    
    // Deactivate block collider
    this.setBlockColliderActive(false)
    
    // Reset state
    this.isHoldingBlock = false
    this.isBlocking = false
    this.currentBlockEmote = null
    this.currentBlockTag = null // Clear block tag
    
    console.log('[Block] Block stopped, returning to idle')
  }

  breakBlockFromKick() {
    if (!this.isBlocking && !this.isHoldingBlock) return

    console.log('[Block] Block broken by kick')

    if (this.blockTimeout) {
      clearTimeout(this.blockTimeout)
      this.blockTimeout = null
    }
    if (this.blockFreezeTimeout) {
      clearTimeout(this.blockFreezeTimeout)
      this.blockFreezeTimeout = null
    }

    if (this.blockAnimationPaused) {
      this.blockAnimationPaused = false
      this.resumeBlockAnimation()
    }

    this.setEffect(null)
    this.setBlockColliderActive(false)
    this.isHoldingBlock = false
    this.isBlocking = false
    this.currentBlockEmote = null
    this.currentBlockTag = null
    this.blockBreakCooldownUntil = Date.now() + KickTiming.blockCooldownAfterBreak * 1000
    this.blockDragStart = null
    this.blockDragAccumulated = null
    this.isBlockDragging = false
  }

  setSwordColliderActive(active) {
    if (!this.swordShape) return
    
    if (active && !this.swordColliderActive) {
      // Activate collider for new swing by enabling the shape
      // Note: hitPlayersThisSwing is cleared in startAttack() BEFORE this is called
      console.log('[Sword] Activating collider shape')
      this.swordShape.setFlag(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE, true)
      this.swordColliderActive = true
      this.swordColliderReady = false // Not ready yet - prevents phantom hits
      
      // Wait 1 physics frame (16ms) before accepting hits
      // This prevents PhysX from reporting stale collisions from before the collider was disabled
      setTimeout(() => {
        if (this.swordColliderActive) { // Only set ready if still active
          this.swordColliderReady = true
          console.log('[Sword] Collider now READY to detect hits')
        }
      }, 16)
    } else if (!active && this.swordColliderActive) {
      // Deactivate collider by disabling the shape
      console.log('[Sword] Deactivating collider - hit', this.hitPlayersThisSwing.size, 'player(s)')
      this.swordShape.setFlag(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE, false)
      this.swordColliderActive = false
      this.swordColliderReady = false
    }
  }

  setBlockColliderActive(active) {
    if (!this.blockShape) return
    
    if (active) {
      console.log('[Block] Activating block collider (SIMULATION shape)')
      this.blockShape.setFlag(PHYSX.PxShapeFlagEnum.eSIMULATION_SHAPE, true)
    } else {
      console.log('[Block] Deactivating block collider')
      this.blockShape.setFlag(PHYSX.PxShapeFlagEnum.eSIMULATION_SHAPE, false)
    }
  }

  setKickColliderActive(active) {
    if (!this.kickShape) return

    if (active && !this.kickColliderActive) {
      console.log('[Kick] Activating kick collider (TRIGGER shape)')
      this.kickShape.setFlag(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE, true)
      this.kickColliderActive = true
    } else if (!active && this.kickColliderActive) {
      console.log('[Kick] Deactivating kick collider')
      this.kickShape.setFlag(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE, false)
      this.kickColliderActive = false
    }
  }

  initCapsule() {
    const radius = this.capsuleRadius
    const height = this.capsuleHeight
    const halfHeight = (height - radius - radius) / 2
    const geometry = new PHYSX.PxCapsuleGeometry(radius, halfHeight)
    // frictionless material (the combine mode ensures we always use out min=0 instead of avging)
    // we use eMIN when in the air so that we don't stick to walls etc
    // and eMAX on the ground so that we don't constantly slip off physics objects we're pushing
    this.material = this.world.physics.physics.createMaterial(0, 0, 0)
    // material.setFrictionCombineMode(PHYSX.PxCombineModeEnum.eMIN)
    // material.setRestitutionCombineMode(PHYSX.PxCombineModeEnum.eMIN)
    const flags = new PHYSX.PxShapeFlags(PHYSX.PxShapeFlagEnum.eSCENE_QUERY_SHAPE | PHYSX.PxShapeFlagEnum.eSIMULATION_SHAPE) // prettier-ignore
    const shape = this.world.physics.physics.createShape(geometry, this.material, true, flags)
    const localPose = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity)
    // rotate to stand up
    q1.set(0, 0, 0).setFromAxisAngle(BACKWARD, Math.PI / 2)
    q1.toPxTransform(localPose)
    // move capsule up so its base is at 0,0,0
    v1.set(0, halfHeight + radius, 0)
    v1.toPxTransform(localPose)
    shape.setLocalPose(localPose)
    const filterData = new PHYSX.PxFilterData(
      Layers.player.group,
      Layers.player.mask,
      PHYSX.PxPairFlagEnum.eNOTIFY_TOUCH_FOUND |
        PHYSX.PxPairFlagEnum.eNOTIFY_TOUCH_LOST |
        PHYSX.PxPairFlagEnum.eNOTIFY_CONTACT_POINTS |
        PHYSX.PxPairFlagEnum.eDETECT_CCD_CONTACT |
        PHYSX.PxPairFlagEnum.eSOLVE_CONTACT |
        PHYSX.PxPairFlagEnum.eDETECT_DISCRETE_CONTACT,
      0
    )
    shape.setContactOffset(0.08) // just enough to fire contacts (because we muck with velocity sometimes standing on a thing doesn't contact)
    // shape.setFlag(PHYSX.PxShapeFlagEnum.eUSE_SWEPT_BOUNDS, true)
    shape.setQueryFilterData(filterData)
    shape.setSimulationFilterData(filterData)
    const transform = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity)
    v1.copy(this.base.position).toPxTransform(transform)
    q1.set(0, 0, 0, 1).toPxTransform(transform)
    this.capsule = this.world.physics.physics.createRigidDynamic(transform)
    this.capsule.setMass(this.mass)
    // this.capsule.setRigidBodyFlag(PHYSX.PxRigidBodyFlagEnum.eKINEMATIC, false)
    this.capsule.setRigidBodyFlag(PHYSX.PxRigidBodyFlagEnum.eENABLE_CCD, true)
    this.capsule.setRigidDynamicLockFlag(PHYSX.PxRigidDynamicLockFlagEnum.eLOCK_ANGULAR_X, true)
    // this.capsule.setRigidDynamicLockFlag(PHYSX.PxRigidDynamicLockFlagEnum.eLOCK_ANGULAR_Y, true)
    this.capsule.setRigidDynamicLockFlag(PHYSX.PxRigidDynamicLockFlagEnum.eLOCK_ANGULAR_Z, true)
    // disable gravity we'll add it ourselves
    this.capsule.setActorFlag(PHYSX.PxActorFlagEnum.eDISABLE_GRAVITY, true)
    this.capsule.attachShape(shape)
    // There's a weird issue where running directly at a wall the capsule won't generate contacts and instead
    // go straight through it. It has to be almost perfectly head on, a slight angle and everything works fine.
    // I spent days trying to figure out why, it's not CCD, it's not contact offsets, its just straight up bugged.
    // For now the best solution is to just add a sphere right in the center of our capsule to keep that problem at bay.
    let shape2
    {
      // const geometry = new PHYSX.PxSphereGeometry(radius)
      // shape2 = this.world.physics.physics.createShape(geometry, this.material, true, flags)
      // shape2.setQueryFilterData(filterData)
      // shape2.setSimulationFilterData(filterData)
      // const pose = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity)
      // v1.set(0, halfHeight + radius, 0).toPxTransform(pose)
      // shape2.setLocalPose(pose)
      // this.capsule.attachShape(shape2)
    }
    this.capsuleHandle = this.world.physics.addActor(this.capsule, {
      tag: null,
      playerId: this.data.id,
      onInterpolate: position => {
        this.base.position.copy(position)
      },
    })
  }

  initControl() {
    this.control = this.world.controls.bind({
      priority: ControlPriorities.PLAYER,
      onTouch: touch => {
        if (!this.stick && touch.position.x < this.control.screen.width / 2) {
          this.stick = {
            center: touch.position.clone(),
            active: false,
            touch,
          }
        } else if (!this.pan) {
          this.pan = touch
        }
      },
      onTouchEnd: touch => {
        if (this.stick?.touch === touch) {
          this.stick = null
          this.world.emit('stick', null)
        }
        if (this.pan === touch) {
          this.pan = null
        }
      },
    })
    this.control.camera.write = true
    this.control.camera.position.copy(this.cam.position)
    this.control.camera.quaternion.copy(this.cam.quaternion)
    this.control.camera.zoom = this.cam.zoom
    // this.control.setActions([{ type: 'space', label: 'Jump / Double-Jump' }])
    // this.control.setActions([{ type: 'escape', label: 'Menu' }])
  }

  onXRSession = session => {
    if (session) {
      if (!this.xrControllerFactory) {
        this.xrControllerFactory = new XRControllerModelFactory()
        this.xrControllerLeft = this.world.graphics.renderer.xr.getControllerGrip(0)
        this.xrControllerLeft.add(this.xrControllerFactory.createControllerModel(this.xrControllerLeft))
        this.xrRig.add(this.xrControllerLeft)
        this.xrControllerRight = this.world.graphics.renderer.xr.getControllerGrip(1)
        this.xrControllerRight.add(this.xrControllerFactory.createControllerModel(this.xrControllerRight))
        this.xrRig.add(this.xrControllerRight)
      }
      this.world.stage.scene.add(this.xrRig)
      this.xrRig.add(this.world.camera)
      this.cam.zoom = 0
      this.control.camera.write = false
      this.isXR = true
    } else {
      this.world.stage.scene.remove(this.xrRig)
      this.world.rig.add(this.world.camera)
      this.world.camera.position.set(0, 0, 0)
      this.world.camera.rotation.set(0, 0, 0)
      this.cam.zoom = 1
      this.control.camera.write = true
      this.isXR = false
    }
  }

  setXRPlayerPosition(position) {
    const parent = this.xrRig
    const child = this.world.camera
    const feetWorldPos = child.getWorldPosition(v2)
    feetWorldPos.y -= child.position.y
    const offset = v1.subVectors(position, feetWorldPos)
    parent.position.add(offset)

    // const offset = v1.copy(position)
    // const offset = v1.copy(position)
    // offset.x -= parent.position.x + child.position.x
    // offset.y -= parent.position.y
    // offset.z -= parent.position.z + child.position.z
    // parent.position.add(offset)
  }

  turnXRRigAtPlayer(degrees) {
    const parent = this.xrRig
    const child = this.world.camera
    // console.log(child.getWorldPosition(new THREE.Vector3()))
    const pivotWorld = new THREE.Vector3()
    child.getWorldPosition(pivotWorld)
    parent.rotateOnAxis(UP, degrees * THREE.MathUtils.DEG2RAD)
    const offset = child.position.clone()
    offset.applyQuaternion(parent.quaternion)
    parent.position.copy(pivotWorld).sub(offset)
    // console.log(child.getWorldPosition(new THREE.Vector3()))
  }

  toggleFlying(value) {
    value = isBoolean(value) ? value : !this.flying
    if (this.flying === value) return
    this.flying = value
    if (this.flying) {
      // zero out vertical velocity when entering fly mode
      const velocity = this.capsule.getLinearVelocity()
      velocity.y = 0
      this.capsule.setLinearVelocity(velocity)
    } else {
      // ...
    }
    this.lastJumpAt = -999
  }

  getAnchorMatrix() {
    if (this.data.effect?.anchorId) {
      return this.world.anchors.get(this.data.effect.anchorId)
    }
    return null
  }

  outranks(otherPlayer) {
    const rank = Math.max(this.data.rank, this.world.settings.effectiveRank)
    const otherRank = Math.max(otherPlayer.data.rank, this.world.settings.effectiveRank)
    return rank > otherRank
  }

  isAdmin() {
    const rank = Math.max(this.data.rank, this.world.settings.effectiveRank)
    return hasRank(rank, Ranks.ADMIN)
  }

  isBuilder() {
    const rank = Math.max(this.data.rank, this.world.settings.effectiveRank)
    return hasRank(rank, Ranks.BUILDER)
  }

  isMuted() {
    return this.world.livekit.isMuted(this.data.id)
  }

  fixedUpdate(delta) {
    const xr = this.isXR
    const freeze = this.data.effect?.freeze
    const anchor = this.getAnchorMatrix()
    const snare = this.data.effect?.snare || 0

    if (anchor && !this.capsuleDisabled) {
      this.capsule.setActorFlag(PHYSX.PxActorFlagEnum.eDISABLE_SIMULATION, true)
      this.capsuleDisabled = true
    }
    if (!anchor && this.capsuleDisabled) {
      this.capsule.setActorFlag(PHYSX.PxActorFlagEnum.eDISABLE_SIMULATION, false)
      this.capsuleDisabled = false
    }

    if (anchor) {
      /**
       *
       * ZERO MODE
       *
       */
    } else if (!this.flying) {
      /**
       *
       * STANDARD MODE
       *
       */

      // if grounded last update, check for moving platforms and move with them
      if (this.grounded) {
        // find any potentially moving platform
        const pose = this.capsule.getGlobalPose()
        const origin = v1.copy(pose.p)
        origin.y += 0.2
        const hitMask = Layers.environment.group | Layers.prop.group
        const hit = this.world.physics.raycast(origin, DOWN, 2, hitMask)
        let actor = hit?.handle?.actor || null
        // if we found a new platform, set it up for tracking
        if (this.platform.actor !== actor) {
          this.platform.actor = actor
          if (actor) {
            const platformPose = this.platform.actor.getGlobalPose()
            v1.copy(platformPose.p)
            q1.copy(platformPose.q)
            this.platform.prevTransform.compose(v1, q1, SCALE_IDENTITY)
          }
        }
        // move with platform
        if (this.platform.actor) {
          // get current platform transform
          const currTransform = m1
          const platformPose = this.platform.actor.getGlobalPose()
          v1.copy(platformPose.p)
          q1.copy(platformPose.q)
          currTransform.compose(v1, q1, SCALE_IDENTITY)
          // get delta transform
          const deltaTransform = m2.multiplyMatrices(currTransform, this.platform.prevTransform.clone().invert())
          // extract delta position and quaternion
          const deltaPosition = v2
          const deltaQuaternion = q2
          const deltaScale = v3
          deltaTransform.decompose(deltaPosition, deltaQuaternion, deltaScale)
          // apply delta to player
          const playerPose = this.capsule.getGlobalPose()
          v4.copy(playerPose.p)
          q3.copy(playerPose.q)
          const playerTransform = m3
          playerTransform.compose(v4, q3, SCALE_IDENTITY)
          playerTransform.premultiply(deltaTransform)
          const newPosition = v5
          const newQuaternion = q4
          playerTransform.decompose(newPosition, newQuaternion, v6)
          const newPose = this.capsule.getGlobalPose()
          newPosition.toPxTransform(newPose)
          // newQuaternion.toPxTransform(newPose) // capsule doesn't rotate
          this.capsule.setGlobalPose(newPose)
          // rotate ghost by Y only
          e1.setFromQuaternion(deltaQuaternion).reorder('YXZ')
          e1.x = 0
          e1.z = 0
          q1.setFromEuler(e1)
          this.base.quaternion.multiply(q1)
          this.base.updateTransform()
          // store current transform for next frame
          this.platform.prevTransform.copy(currTransform)
        }
      } else {
        this.platform.actor = null
      }

      // sweep down to see if we hit ground
      let sweepHit
      {
        const geometry = this.groundSweepGeometry
        const pose = this.capsule.getGlobalPose()
        const origin = v1.copy(pose.p /*this.ghost.position*/)
        origin.y += this.groundSweepRadius + 0.12 // move up inside player + a bit
        const direction = DOWN
        const maxDistance = 0.12 + 0.1 // outside player + a bit more
        const hitMask = Layers.environment.group | Layers.prop.group
        sweepHit = this.world.physics.sweep(geometry, origin, direction, maxDistance, hitMask)
      }

      // update grounded info
      if (sweepHit) {
        this.justLeftGround = false
        this.grounded = true
        this.groundNormal.copy(sweepHit.normal)
        this.groundAngle = UP.angleTo(this.groundNormal) * RAD2DEG
      } else {
        this.justLeftGround = !!this.grounded
        this.grounded = false
        this.groundNormal.copy(UP)
        this.groundAngle = 0
      }

      // if on a steep slope, unground and track slipping
      if (this.grounded && this.groundAngle > 60) {
        this.justLeftGround = false
        this.grounded = false
        this.groundNormal.copy(UP)
        this.groundAngle = 0
        this.slipping = true
      } else {
        this.slipping = false
      }

      // our capsule material has 0 friction
      // we use eMIN when in the air so that we don't stick to walls etc (zero friction)
      // and eMAX on the ground so that we don't constantly slip off physics objects we're pushing (absorb objects friction)
      if (this.grounded) {
        if (this.materialMax !== true) {
          this.material.setFrictionCombineMode(PHYSX.PxCombineModeEnum.eMAX)
          this.material.setRestitutionCombineMode(PHYSX.PxCombineModeEnum.eMAX)
          this.materialMax = true
        }
      } else {
        if (this.materialMax !== false) {
          this.material.setFrictionCombineMode(PHYSX.PxCombineModeEnum.eMIN)
          this.material.setRestitutionCombineMode(PHYSX.PxCombineModeEnum.eMIN)
          this.materialMax = false
        }
      }

      // if we jumped and have now left the ground, progress to jumping
      if (this.jumped && !this.grounded) {
        this.jumped = false
        this.jumping = true
      }

      // if not grounded and our velocity is downward, start timing our falling
      if (!this.grounded && this.capsule.getLinearVelocity().y < 0) {
        this.fallTimer += delta
      } else {
        this.fallTimer = 0
      }
      // if we've been falling for a bit then progress to actual falling
      // this is to prevent animation jitter when only falling for a very small amount of time
      if (this.fallTimer > 0.1 && !this.falling) {
        this.jumping = false
        this.airJumping = false
        this.falling = true
        this.fallStartY = this.base.position.y
      }

      // if falling track distance
      if (this.falling) {
        this.fallDistance = this.fallStartY - this.base.position.y
      }

      // if falling and we're now on the ground, clear it
      if (this.falling && this.grounded) {
        this.falling = false
      }

      // if jumping and we're now on the ground, clear it
      if (this.jumping && this.grounded) {
        this.jumping = false
      }

      // if airJumping and we're now on the ground, clear it
      if (this.airJumped && this.grounded) {
        this.airJumped = false
        this.airJumping = false
      }

      // if we're grounded we don't need gravity.
      // more importantly we disable it so that we don't slowly slide down ramps while standing still.
      // even more importantly, if the platform we are on is dynamic we apply a force to it to compensate for our gravity being off.
      // this allows things like see-saws to move down when we stand on them etc.
      if (this.grounded) {
        // gravity is disabled but we need to check our platform
        if (this.platform.actor) {
          const isStatic = this.platform.actor instanceof PHYSX.PxRigidStatic
          const isKinematic = this.platform.actor.getRigidBodyFlags?.().isSet(PHYSX.PxRigidBodyFlagEnum.eKINEMATIC)
          // if its dynamic apply downward force!
          if (!isKinematic && !isStatic) {
            // this feels like the right amount of force but no idea why 0.2
            const amount = -9.81 * 0.2
            const force = v1.set(0, amount, 0)
            PHYSX.PxRigidBodyExt.prototype.addForceAtPos(
              this.platform.actor,
              force.toPxVec3(),
              this.capsule.getGlobalPose().p,
              PHYSX.PxForceModeEnum.eFORCE,
              true
            )
          }
        }
      } else {
        const force = v1.set(0, -this.effectiveGravity, 0)
        this.capsule.addForce(force.toPxVec3(), PHYSX.PxForceModeEnum.eFORCE, true)
      }

      // update velocity
      const velocity = v1.copy(this.capsule.getLinearVelocity())
      // apply drag, orientated to ground normal
      // this prevents ice-skating & yeeting us upward when going up ramps
      const dragCoeff = 10 * delta
      let perpComponent = v2.copy(this.groundNormal).multiplyScalar(velocity.dot(this.groundNormal))
      let parallelComponent = v3.copy(velocity).sub(perpComponent)
      parallelComponent.multiplyScalar(1 - dragCoeff)
      velocity.copy(parallelComponent.add(perpComponent))
      // cancel out velocity in ground normal direction (up oriented to ground normal)
      // this helps us stick to elevators
      if (this.grounded && !this.jumping) {
        const projectedLength = velocity.dot(this.groundNormal)
        const projectedVector = v2.copy(this.groundNormal).multiplyScalar(projectedLength)
        velocity.sub(projectedVector)
      }
      // when walking off an edge or over the top of a ramp, attempt to snap down to a surface
      if (this.justLeftGround && !this.jumping) {
        velocity.y = -5
      }
      // if slipping ensure we can't gain upward velocity
      if (this.slipping) {
        // increase downward velocity to prevent sliding upward when walking at a slope
        velocity.y -= 0.5
      }

      // apply additional push force
      if (this.pushForce) {
        if (!this.pushForceInit) {
          this.pushForceInit = true
          // if we're pushing up, act like a jump so we don't stick to the ground
          if (this.pushForce.y) {
            this.jumped = true
            // ensure other stuff is reset
            this.jumping = false
            this.falling = false
            this.airJumped = false
            this.airJumping = false
          }
        }
        velocity.add(this.pushForce)
        const drag = 20
        const decayFactor = 1 - drag * delta
        if (decayFactor < 0) {
          // if drag * delta > 1, just set to zero
          this.pushForce.set(0, 0, 0)
        } else {
          this.pushForce.multiplyScalar(Math.max(decayFactor, 0))
        }
        if (this.pushForce.length() < 0.01) {
          this.pushForce = null
        }
      }

      this.capsule.setLinearVelocity(velocity.toPxVec3())

      // apply move force, projected onto ground normal
      if (this.moving) {
        let moveSpeed = (this.running ? 6 : 3) * this.mass // run
        moveSpeed *= 1 - snare
        const slopeRotation = q1.setFromUnitVectors(UP, this.groundNormal)
        const moveForce = v1.copy(this.moveDir).multiplyScalar(moveSpeed * 10).applyQuaternion(slopeRotation) // prettier-ignore
        this.capsule.addForce(moveForce.toPxVec3(), PHYSX.PxForceModeEnum.eFORCE, true)
        // alternative (slightly different projection)
        // let moveSpeed = 10
        // const slopeMoveDir = v1.copy(this.moveDir).projectOnPlane(this.groundNormal).normalize()
        // const moveForce = v2.copy(slopeMoveDir).multiplyScalar(moveSpeed * 10)
        // this.capsule.addForce(moveForce.toPxVec3(), PHYSX.PxForceModeEnum.eFORCE, true)
      }

      // ground/air jump
      const shouldJump =
        this.grounded && !this.jumping && this.jumpDown && !this.data.effect?.snare && !this.data.effect?.freeze
      const shouldAirJump =
        false && !this.grounded && !this.airJumped && this.jumpPressed && !this.world.builder?.enabled // temp: disabled
      if (shouldJump || shouldAirJump) {
        // calc velocity needed to reach jump height
        let jumpVelocity = Math.sqrt(2 * this.effectiveGravity * this.jumpHeight)
        jumpVelocity = jumpVelocity * (1 / Math.sqrt(this.mass))
        // update velocity
        const velocity = this.capsule.getLinearVelocity()
        velocity.y = jumpVelocity
        this.capsule.setLinearVelocity(velocity)
        // ground jump init (we haven't left the ground yet)
        if (shouldJump) {
          this.jumped = true
        }
        // air jump init
        if (shouldAirJump) {
          this.falling = false
          this.fallTimer = 0
          this.jumping = true
          this.airJumped = true
          this.airJumping = true
        }
      }
    } else {
      /**
       *
       * FLYING MODE
       *
       */

      // apply force in the direction we want to go
      if (this.moving || this.jumpDown || this.control.keyC.down) {
        const flySpeed = this.flyForce * (this.running ? 2 : 1)
        const force = v1.copy(this.flyDir).multiplyScalar(flySpeed)
        // handle vertical movement
        if (this.jumpDown) {
          force.y = flySpeed
        } else if (this.control.keyC.down) {
          force.y = -flySpeed
        }
        this.capsule.addForce(force.toPxVec3(), PHYSX.PxForceModeEnum.eFORCE, true)
      }

      // add drag to prevent excessive speeds
      const velocity = v2.copy(this.capsule.getLinearVelocity())
      const dragForce = v3.copy(velocity).multiplyScalar(-this.flyDrag * delta)
      this.capsule.addForce(dragForce.toPxVec3(), PHYSX.PxForceModeEnum.eFORCE, true)

      // zero out any rotational velocity
      const zeroAngular = v4.set(0, 0, 0)
      this.capsule.setAngularVelocity(zeroAngular.toPxVec3())

      // if non-xr and not in build mode, cancel flying
      if (!this.world.builder?.enabled && !this.isXR) {
        this.toggleFlying()
      }
    }

    // double jump in build mode, toggle flying
    // double jump in xr and "can" build, toggle flying
    if (this.jumpPressed && (this.world.builder?.enabled || (this.isXR && this.world.builder?.canBuild()))) {
      if (this.world.time - this.lastJumpAt < 0.4) {
        this.toggleFlying()
      }
      this.lastJumpAt = this.world.time
    }

    // consume jump press so we dont run it across multiple fixedUpdates in one frame
    this.jumpPressed = false
  }

  update(delta) {
    // Update particles
    this.updateParticles(delta)
    
    const xr = this.isXR
    const freeze = this.data.effect?.freeze
    const anchor = this.getAnchorMatrix()

    // if (xr) return
    // console.log('update')

    if (xr) {
      // move the rig so that the ground underneath the camera aligns with the base player
      this.setXRPlayerPosition(this.base.position)
      // fetch any physical movement delta
      this.world.camera.getWorldPosition(v1)
      v1.y = 0
      v2.copy(this.xrRig.position)
      v2.y = 0
      v3.copy(v1).sub(v2)
      this.hmdDelta.copy(v3).sub(this.hmdLast)
      this.hmdLast.copy(v3)
      // apply physical movement delta to capsule so physics stays with us if we wander
      const pose = this.capsule.getGlobalPose()
      v2.copy(pose.p).add(this.hmdDelta)
      v2.toPxVec3(pose.p)
      this.capsule.setGlobalPose(pose)
    }

    // update cam look direction
    if (xr) {
      // in xr clear camera rotation (handled internally)
      // in xr we only track turn here, which is added to the xr camera later on
      // this.cam.rotation.x = 0
      // this.cam.rotation.z = 0
      if (this.control.xrRightStick.value.x === 0 && this.didSnapTurn) {
        this.didSnapTurn = false
      } else if (this.control.xrRightStick.value.x > 0 && !this.didSnapTurn) {
        this.turnXRRigAtPlayer(-45)
        this.didSnapTurn = true
      } else if (this.control.xrRightStick.value.x < 0 && !this.didSnapTurn) {
        this.turnXRRigAtPlayer(45)
        this.didSnapTurn = true
      }
      // if we did snap turn, we need to refresh the hmd position to cancel it out
      if (this.didSnapTurn) {
        this.world.camera.getWorldPosition(v1)
        v1.y = 0
        v2.copy(this.xrRig.position)
        v2.y = 0
        v3.copy(v1).sub(v2)
        this.hmdLast.copy(v3)
      }
    } else if (this.control.pointer.locked) {
      // or pointer lock, rotate camera with pointer movement
      this.cam.rotation.x += -this.control.pointer.delta.y * POINTER_LOOK_SPEED * delta
      this.cam.rotation.y += -this.control.pointer.delta.x * POINTER_LOOK_SPEED * delta
      this.cam.rotation.z = 0
    } else if (this.pan) {
      // or when touch panning
      this.cam.rotation.x += -this.pan.delta.y * PAN_LOOK_SPEED * delta
      this.cam.rotation.y += -this.pan.delta.x * PAN_LOOK_SPEED * delta
      this.cam.rotation.z = 0
    }

    // ensure we can't look too far up/down
    if (!xr) {
      this.cam.rotation.x = clamp(this.cam.rotation.x, -89 * DEG2RAD, 89 * DEG2RAD)
    }

    // zoom camera if scrolling wheel
    if (!xr) {
      this.cam.zoom += -this.control.scrollDelta.value * ZOOM_SPEED * delta
      this.cam.zoom = clamp(this.cam.zoom, MIN_ZOOM, MAX_ZOOM)
    }

    // transition in and out of first person
    if (this.cam.zoom < 1 && !this.firstPerson) {
      this.cam.zoom = 0
      this.firstPerson = true
      this.avatar.visible = false
    } else if (this.cam.zoom > 0 && this.firstPerson) {
      this.cam.zoom = 1
      this.firstPerson = false
      this.avatar.visible = true
    }

    // stick movement threshold
    if (this.stick && !this.stick.active) {
      this.stick.active = this.stick.center.distanceTo(this.stick.touch.position) > 3
    }

    // watch jump presses to either fly or air-jump
    this.jumpDown = xr ? this.control.xrRightBtn1.down : this.control.space.down || this.control.touchA.down
    if (xr ? this.control.xrRightBtn1.pressed : this.control.space.pressed || this.control.touchA.pressed) {
      this.jumpPressed = true
    }

    // handle attack animations (keys 1, 2, 3, 4, 5) and kick (key F)
    // Use proper attack timing with windup, commit, and canceling
    if (!xr && !this.isDead) {
      if (this.control.digit1.pressed) {
        this.startAttack(Emotes.ATTACK_LEFT)
      } else if (this.control.digit2.pressed) {
        this.startAttack(Emotes.ATTACK_RIGHT)
      } else if (this.control.digit3.pressed) {
        this.startAttack(Emotes.ATTACK_HIGH)
      } else if (this.control.digit4.pressed) {
        this.startAttack(Emotes.ATTACK_LOW)
      } else if (this.control.digit5.pressed) {
        this.startBlock()
      } else if (this.control.keyF.pressed) {
        this.startKick()
      }
      
      // Mouse drag attack system
      // Left mouse: drag direction determines attack
      // Right mouse: block
      
      // Right mouse down: start tracking block drag
      if (this.control.mouseRight.pressed && this.control.pointer.locked) {
        this.blockDragStart = {
          time: Date.now()
        }
        this.blockDragAccumulated = { x: 0, y: 0 }
        this.isBlockDragging = false
        console.log('[Mouse Block] Right mouse down - starting block drag tracking')
      }
      
      // Track mouse movement while dragging (accumulate deltas)
      if (this.control.mouseRight.down && this.blockDragStart && this.control.pointer.locked) {
        const delta = this.control.pointer.delta
        this.blockDragAccumulated.x += delta.x
        this.blockDragAccumulated.y += delta.y
        
        // Check if we've moved enough to be considered a drag
        const distance = Math.sqrt(
          this.blockDragAccumulated.x * this.blockDragAccumulated.x + 
          this.blockDragAccumulated.y * this.blockDragAccumulated.y
        )
        
        // Once we've dragged enough and not already holding block, start directional block
        if (distance > this.dragThreshold && !this.isHoldingBlock && !this.isBlockDragging) {
          this.isBlockDragging = true
          
          // Determine direction and start held block
          const dx = this.blockDragAccumulated.x
          const dy = this.blockDragAccumulated.y
          const absX = Math.abs(dx)
          const absY = Math.abs(dy)
          
          let blockEmote
          if (absX > absY) {
            // Horizontal drag
            if (dx > 0) {
              blockEmote = Emotes.BLOCK_RIGHT
              console.log('[Mouse Block] HOLDING RIGHT block')
            } else {
              blockEmote = Emotes.BLOCK_LEFT
              console.log('[Mouse Block] HOLDING LEFT block')
            }
          } else {
            // Vertical drag
            if (dy > 0) {
              blockEmote = Emotes.BLOCK_LOW
              console.log('[Mouse Block] HOLDING LOW block')
            } else {
              blockEmote = Emotes.BLOCK_HIGH
              console.log('[Mouse Block] HOLDING HIGH block')
            }
          }
          
          // Start the directional block in hold mode
          this.startBlock(blockEmote, true) // holdMode = true
        }
      }
      
      // Right mouse released: stop held block
      if (this.control.mouseRight.released && this.blockDragStart && this.control.pointer.locked) {
        if (this.isHoldingBlock) {
          // Stop the held block (no follow-through)
          console.log('[Mouse Block] Right mouse released - stopping held block')
          this.stopBlock()
        } else {
          console.log('[Mouse Block] Right mouse released - no held block (drag too short)')
        }
        
        // Reset drag tracking
        this.blockDragStart = null
        this.blockDragAccumulated = null
        this.isBlockDragging = false
      }
      
      // Left mouse down: start tracking drag
      if (this.control.mouseLeft.pressed && this.control.pointer.locked) {
        this.mouseDragStart = {
          time: Date.now()
        }
        this.mouseDragAccumulated = { x: 0, y: 0 }
        this.isDragging = false
        console.log('[Mouse Attack] Mouse down - starting drag tracking')
      }
      
      // Track mouse movement while dragging (accumulate deltas)
      if (this.control.mouseLeft.down && this.mouseDragStart && this.control.pointer.locked) {
        const delta = this.control.pointer.delta
        this.mouseDragAccumulated.x += delta.x
        this.mouseDragAccumulated.y += delta.y
        
        // Check if we've moved enough to be considered a drag
        const distance = Math.sqrt(
          this.mouseDragAccumulated.x * this.mouseDragAccumulated.x + 
          this.mouseDragAccumulated.y * this.mouseDragAccumulated.y
        )
        
        // Once we've dragged enough and not already charging, start charged attack
        if (distance > this.dragThreshold && !this.isChargingAttack && !this.isDragging) {
          this.isDragging = true
          
          // Determine direction and start charged attack
          const dx = this.mouseDragAccumulated.x
          const dy = this.mouseDragAccumulated.y
          const absX = Math.abs(dx)
          const absY = Math.abs(dy)
          
          let attackEmote
          if (absX > absY) {
            // Horizontal drag
            if (dx > 0) {
              attackEmote = Emotes.ATTACK_RIGHT
              console.log('[Mouse Attack] CHARGING RIGHT attack')
            } else {
              attackEmote = Emotes.ATTACK_LEFT
              console.log('[Mouse Attack] CHARGING LEFT attack')
            }
          } else {
            // Vertical drag
            if (dy > 0) {
              attackEmote = Emotes.ATTACK_LOW
              console.log('[Mouse Attack] CHARGING LOW attack')
            } else {
              attackEmote = Emotes.ATTACK_HIGH
              console.log('[Mouse Attack] CHARGING HIGH attack')
            }
          }
          
          // Start charged attack (plays backswing and holds)
          this.startAttack(attackEmote, true)
        }
      }
      
      // Left mouse released: complete charged attack if charging
      if (this.control.mouseLeft.released && this.mouseDragStart && this.control.pointer.locked) {
        if (this.isChargingAttack) {
          const windupElapsed = this.chargeStartTime
            ? (Date.now() - this.chargeStartTime) / 1000
            : this.attackWindupTime
          if (windupElapsed >= this.attackWindupTime || this.attackAnimationPaused) {
            console.log('[Mouse Attack] Mouse released - completing charged attack')
            this.completeChargedAttack()
          } else {
            console.log('[Mouse Attack] Released early - will swing when windup completes')
            this.pendingChargedRelease = true
          }
        } else if (!this.isDragging) {
          console.log('[Mouse Attack] Click without drag - right attack')
          this.startAttack(Emotes.ATTACK_RIGHT)
        } else {
          console.log('[Mouse Attack] Mouse released - drag ended without charged attack')
        }
        
        // Reset drag tracking
        this.mouseDragStart = null
        this.mouseDragAccumulated = null
        this.isDragging = false
      }
    }

    // get our movement direction
    this.moveDir.set(0, 0, 0)
    if (xr) {
      // in xr use controller input
      this.moveDir.x = this.control.xrLeftStick.value.x
      this.moveDir.z = this.control.xrLeftStick.value.z
    } else if (this.stick?.active) {
      // if we have a touch joystick use that
      const touchX = this.stick.touch.position.x
      const touchY = this.stick.touch.position.y
      const centerX = this.stick.center.x
      const centerY = this.stick.center.y
      const dx = centerX - touchX
      const dy = centerY - touchY
      const distance = Math.sqrt(dx * dx + dy * dy)
      const moveRadius = STICK_OUTER_RADIUS - STICK_INNER_RADIUS
      if (distance > moveRadius) {
        this.stick.center.x = touchX + (moveRadius * dx) / distance
        this.stick.center.y = touchY + (moveRadius * dy) / distance
      }
      const stickX = (touchX - this.stick.center.x) / moveRadius
      const stickY = (touchY - this.stick.center.y) / moveRadius
      this.moveDir.x = stickX
      this.moveDir.z = stickY
      this.world.emit('stick', this.stick)
    } else {
      // otherwise use keyboard
      if (this.control.keyW.down || this.control.arrowUp.down) this.moveDir.z -= 1
      if (this.control.keyS.down || this.control.arrowDown.down) this.moveDir.z += 1
      if (this.control.keyA.down || this.control.arrowLeft.down) this.moveDir.x -= 1
      if (this.control.keyD.down || this.control.arrowRight.down) this.moveDir.x += 1
    }

    // we're moving if direction is set
    this.moving = this.moveDir.length() > 0

    // check effect cancel
    if (this.data.effect?.cancellable && (this.moving || this.jumpDown)) {
      this.setEffect(null)
    }

    if (freeze || anchor || this.isDead) {
      // cancel movement (freeze, anchor, or dead)
      this.moveDir.set(0, 0, 0)
      this.moving = false
    }

    // determine if we're "running"
    if (this.stick?.active || xr) {
      // touch/xr joysticks at full extent
      this.running = this.moving && this.moveDir.length() > 0.9
    } else {
      // or keyboard shift key
      this.running = this.moving && (this.control.shiftLeft.down || this.control.shiftRight.down)
    }

    // Cancel any active attacks when sprinting starts
    if (this.running && (this.isInWindup || this.isCommitted || this.isChargingAttack)) {
      console.log('[Attack] Sprinting started - canceling active attack')
      
      // Clear all attack timeouts
      if (this.attackWindupTimeout) clearTimeout(this.attackWindupTimeout)
      if (this.attackEndTimeout) clearTimeout(this.attackEndTimeout)
      if (this.attackFreezeTimeout) clearTimeout(this.attackFreezeTimeout)
      if (this.attackEarlyReleaseHoldTimeout) clearTimeout(this.attackEarlyReleaseHoldTimeout)
      
      // Resume animation if paused
      if (this.attackAnimationPaused) {
        this.resumeAttackAnimation()
        this.attackAnimationPaused = false
      }
      
      // Deactivate sword collider
      this.setSwordColliderActive(false)
      
      // Reset attack state
      this.isInWindup = false
      this.isCommitted = false
      this.isChargingAttack = false
      this.chargedAttackEmote = null
      this.chargeStartTime = null
      this.pendingChargedRelease = false
      this.earlyReleaseHoldActive = false
      this.currentAttackEmote = null
      
      // Clear effect to stop animation
      this.setEffect(null)
    }

    // normalize direction (also prevents surfing)
    this.moveDir.normalize()

    // flying direction
    if (xr) {
      this.flyDir.copy(this.moveDir)
      this.world.camera.getWorldQuaternion(q1)
      this.flyDir.applyQuaternion(q1)
    } else {
      this.flyDir.copy(this.moveDir)
      this.flyDir.applyQuaternion(this.cam.quaternion)
    }

    // store un-rotated move direction (axis)
    this.axis.copy(this.moveDir)

    // get un-rotated move direction in degrees
    // Octant ranges (8 directions)
    // Forward:         337.5° to 22.5° (or -22.5° to 22.5°)
    // Forward-Right:   22.5° to 67.5°
    // Right:           67.5° to 112.5°
    // Backward-Right:  112.5° to 157.5°
    // Backward:        157.5° to 202.5°
    // Backward-Left:   202.5° to 247.5°
    // Left:            247.5° to 292.5°
    // Forward-Left:    292.5° to 337.5°
    const moveRad = Math.atan2(this.axis.x, -this.axis.z)
    let moveDeg = moveRad * RAD2DEG
    if (moveDeg < 0) moveDeg += 360

    // rotate direction to face camera Y direction
    if (xr) {
      this.world.camera.getWorldQuaternion(q1)
      e1.setFromQuaternion(q1).reorder('YXZ')
      // e1.y += this.xrRig.rotation.y
      // e1.y += this.cam.rotation.y // why not world.camera now?
      const yQuaternion = q1.setFromAxisAngle(UP, e1.y)
      this.moveDir.applyQuaternion(yQuaternion)
    } else {
      const yQuaternion = q1.setFromAxisAngle(UP, this.cam.rotation.y)
      this.moveDir.applyQuaternion(yQuaternion)
    }

    // get initial facing angle matching camera
    let rotY = 0
    let applyRotY
    if (xr) {
      this.world.camera.getWorldQuaternion(q1)
      e1.setFromQuaternion(q1).reorder('YXZ')
      rotY = e1.y
      // rotY = e1.y + this.cam.rotation.y
    } else {
      rotY = this.cam.rotation.y
    }
    if (this.data.effect?.turn) {
      applyRotY = true
    } else if (this.moving || this.firstPerson) {
      applyRotY = true
    }

    // when moving, or in first person or effect.turn, continually slerp to face that angle
    if (applyRotY) {
      e1.set(0, rotY, 0)
      q1.setFromEuler(e1)
      const alpha = 1 - Math.pow(0.00000001, delta)
      this.base.quaternion.slerp(q1, alpha)
    }

    // apply emote
    let emote
    if (this.data.effect?.emote) {
      emote = this.data.effect.emote
    }
    if (this.emote !== emote) {
      this.emote = emote
    }
    // Pass effect duration if available (important for charged attacks)
    // NOTE: Must call .instance.setEmote() directly to pass duration parameter
    // because the Avatar Node wrapper only accepts one parameter
    const duration = this.data.effect?.duration
    if (this.avatar?.instance) {
      this.avatar.instance.setEmote(this.emote, duration)
    }

    // get locomotion mode
    let mode
    if (this.data.effect?.emote) {
      // emote = this.data.effect.emote
    } else if (this.flying) {
      mode = Modes.FLY
    } else if (this.airJumping) {
      mode = Modes.FLIP
    } else if (this.jumping) {
      mode = Modes.JUMP
    } else if (this.falling) {
      mode = this.fallDistance > 1.6 ? Modes.FALL : Modes.JUMP
    } else if (this.moving) {
      mode = this.running ? Modes.RUN : Modes.WALK
    } else if (this.speaking) {
      mode = Modes.TALK
    }
    if (!mode) mode = Modes.IDLE
    this.mode = mode

    // set gaze direction
    if (xr) {
      this.world.camera.getWorldQuaternion(q1)
      this.gaze.copy(FORWARD).applyQuaternion(q1)
    } else {
      this.gaze.copy(FORWARD).applyQuaternion(this.cam.quaternion)
      if (!this.firstPerson) {
        // tilt slightly up in third person as people look from above
        v1.copy(gazeTiltAxis).applyQuaternion(this.cam.quaternion) // tilt in cam space
        this.gaze.applyAxisAngle(v1, gazeTiltAngle) // positive for upward tilt
      }
    }

    if (xr) {
      // hint to controls that xr rig is in a new position
      this.world.controls.applyXRRig(this.xrRig)
    }

    // apply locomotion
    this.avatar?.instance?.setLocomotion(this.mode, this.axis, this.gaze)

    // send network updates
    this.lastSendAt += delta
    if (this.lastSendAt >= this.world.networkRate) {
      if (!this.lastState) {
        this.lastState = {
          id: this.data.id,
          p: this.base.position.clone(),
          q: this.base.quaternion.clone(),
          m: this.mode,
          a: this.axis.clone(),
          g: this.gaze.clone(),
          e: null,
        }
      }
      const data = {
        id: this.data.id,
      }
      let hasChanges
      if (!this.lastState.p.equals(this.base.position)) {
        data.p = this.base.position.toArray()
        this.lastState.p.copy(this.base.position)
        hasChanges = true
      }
      if (!this.lastState.q.equals(this.base.quaternion)) {
        data.q = this.base.quaternion.toArray()
        this.lastState.q.copy(this.base.quaternion)
        hasChanges = true
      }
      if (this.lastState.m !== this.mode) {
        data.m = this.mode
        this.lastState.m = this.mode
        hasChanges = true
      }
      if (!this.lastState.a.equals(this.axis)) {
        data.a = this.axis.toArray()
        this.lastState.a.copy(this.axis)
        hasChanges = true
      }
      if (!this.lastState.g.equals(this.gaze)) {
        data.g = this.gaze.toArray()
        this.lastState.g.copy(this.gaze)
        hasChanges = true
      }
      if (this.lastState.e !== this.emote) {
        data.e = this.emote
        this.lastState.e = this.emote
        hasChanges = true
      }
      if (hasChanges) {
        this.world.network.send('entityModified', data)
      }
      this.lastSendAt = 0
    }

    // effect duration
    if (this.data.effect?.duration) {
      this.data.effect.duration -= delta
      if (this.data.effect.duration <= 0) {
        if (this.data.effect.emote === Emotes.KICK) {
          this.clearKickColliderTimeouts()
        }
        this.setEffect(null)
      }
    }
  }

  lateUpdate(delta) {
    const xr = this.isXR
    const anchor = this.getAnchorMatrix()

    // Create collider meshes if needed (deferred until scene is ready)
    if (this.showColliders && this.world.stage && this.world.stage.scene) {
      // Create capsule mesh if it doesn't exist
      if (!this.capsuleColliderMesh) {
        const radius = this.capsuleRadius
        const height = this.capsuleHeight
        const capsuleGeom = new THREE.CapsuleGeometry(radius, height - radius * 2, 8, 16)
        capsuleGeom.translate(0, height / 2, 0)
        const capsuleMat = new THREE.MeshBasicMaterial({
          color: 0x00ff00,
          transparent: true,
          opacity: 0.3,
          wireframe: false,
          depthTest: true,
        })
        this.capsuleColliderMesh = new THREE.Mesh(capsuleGeom, capsuleMat)
        this.capsuleColliderMesh.visible = true
        this.world.stage.scene.add(this.capsuleColliderMesh)
        console.log('[PlayerLocal] Created capsule collider mesh (deferred)')
      }
      
      // Create sword mesh if it doesn't exist and we have the sword shape
      if (!this.swordColliderMesh && this.swordShape) {
        const width = 0.1
        const height = 1.0
        const depth = 0.05
        const boxGeom = new THREE.BoxGeometry(width, height, depth)
        const boxMat = new THREE.MeshBasicMaterial({
          color: 0xff0000,
          transparent: true,
          opacity: 0.3,
          wireframe: false,
          depthTest: true,
        })
        this.swordColliderMesh = new THREE.Mesh(boxGeom, boxMat)
        this.swordColliderMesh.visible = true
        this.world.stage.scene.add(this.swordColliderMesh)
        console.log('[PlayerLocal] Created sword collider mesh (deferred)')
      }
      
      // Create block mesh if it doesn't exist and we have the block shape
      if (!this.blockColliderMesh && this.blockShape) {
        const blockGeom = new THREE.BoxGeometry(this.blockWidth, this.blockHeight, this.blockDepth)
        const blockMat = new THREE.MeshBasicMaterial({
          color: 0xffff00, // Yellow (changes to green when blocking)
          transparent: true,
          opacity: 0.2,
          wireframe: false,
          depthTest: true,
        })
        this.blockColliderMesh = new THREE.Mesh(blockGeom, blockMat)
        this.blockColliderMesh.visible = true
        this.world.stage.scene.add(this.blockColliderMesh)
        console.log('[PlayerLocal] Created block collider mesh (deferred)')
      }

      // Create kick mesh if it doesn't exist and we have the kick shape
      if (!this.kickColliderMesh && this.kickShape) {
        const kickGeom = new THREE.BoxGeometry(this.kickWidth, this.kickHeight, this.kickDepth)
        const kickMat = new THREE.MeshBasicMaterial({
          color: 0xff8800,
          transparent: true,
          opacity: 0.2,
          wireframe: false,
          depthTest: true,
        })
        this.kickColliderMesh = new THREE.Mesh(kickGeom, kickMat)
        this.kickColliderMesh.visible = true
        this.world.stage.scene.add(this.kickColliderMesh)
        console.log('[PlayerLocal] Created kick collider mesh (deferred)')
      }
    }

    // if (xr) return
    // console.log('lateUpdate')

    // if we're anchored, force into that pose
    if (anchor) {
      this.base.position.setFromMatrixPosition(anchor)
      this.base.quaternion.setFromRotationMatrix(anchor)
      const pose = this.capsule.getGlobalPose()
      this.base.position.toPxTransform(pose)
      this.capsuleHandle.snap(pose)
    }
    // make camera follow our position horizontally
    this.cam.position.copy(this.base.position)
    if (xr) {
      // ...
    } else {
      // and vertically at our vrm model height
      this.cam.position.y += this.camHeight
      // and slightly to the right over the avatars shoulder, when not first person / xr
      if (!this.firstPerson) {
        const forward = v1.copy(FORWARD).applyQuaternion(this.cam.quaternion)
        const right = v2.crossVectors(forward, UP).normalize()
        this.cam.position.add(right.multiplyScalar(0.3))
      }
    }
    if (xr) {
      // in vr snap camera
      // this.control.camera.position.copy(this.cam.position)
      // this.control.camera.quaternion.copy(this.cam.quaternion)
    } else {
      // otherwise interpolate camera towards target
      simpleCamLerp(this.world, this.control.camera, this.cam, delta)
    }
    if (this.avatar) {
      const matrix = this.avatar.getBoneTransform('head')
      if (matrix) this.aura.position.setFromMatrixPosition(matrix)
    }
    if (this.avatar && this.sword) {
      const matrix = this.avatar.getBoneTransform('rightHand')
      if (matrix) {
        // Get base transform from hand bone
        this.sword.position.setFromMatrixPosition(matrix)
        this.sword.quaternion.setFromRotationMatrix(matrix)
        
        // Scale the sword down to a reasonable size (adjust as needed)
        this.sword.scale.set(0.7, 0.7, 0.7)
        
        // Apply rotation offset to orient sword properly in hand
        // Rotate 90 degrees around X axis to point sword forward
        q4.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
        this.sword.quaternion.multiply(q4)
        
        // Apply position offset relative to hand orientation
        // Move sword to place handle in hand
        v5.set(0.15, -0.5, 0.0) // x, y, z offset relative to hand
        v5.applyQuaternion(this.sword.quaternion)
        this.sword.position.add(v5)

        // Update sword collider position to match sword mesh
        if (this.swordBody) {
          const pose = this.swordBody.getGlobalPose()
          // Position collider at sword blade (offset forward from handle)
          v6.set(0, -0.1, 0) // Move collider to middle of blade
          v6.applyQuaternion(this.sword.quaternion)
          v6.add(this.sword.position)
          v6.toPxTransform(pose)
          this.sword.quaternion.toPxTransform(pose)
          this.swordBody.setGlobalPose(pose)

          // Update sword collider visualization mesh
          if (this.swordColliderMesh) {
            this.swordColliderMesh.position.copy(v6)
            this.swordColliderMesh.quaternion.copy(this.sword.quaternion)
          }
        }
      }
    }

    // Update block collider position (always positioned in front of player)
    if (this.blockBody) {
      const pose = this.blockBody.getGlobalPose()
      // Position block collider in front of player at chest height
      const forwardOffset = 0.5 // Distance in front of player
      const heightOffset = this.capsuleHeight * 0.6 // Upper mid-body
      
      v6.set(0, 0, -forwardOffset) // Negative Z is forward in Three.js
      v6.applyQuaternion(this.base.quaternion)
      v6.add(this.base.position)
      v6.y += heightOffset
      
      v6.toPxTransform(pose)
      this.base.quaternion.toPxTransform(pose)
      this.blockBody.setGlobalPose(pose)

      // Update block collider visualization mesh
      if (this.blockColliderMesh) {
        this.blockColliderMesh.position.copy(v6)
        this.blockColliderMesh.quaternion.copy(this.base.quaternion)
        
        // Change color based on blocking state
        const material = this.blockColliderMesh.material
        if (this.isBlocking) {
          material.color.setHex(0x00ff00) // Green when blocking
          material.opacity = 0.5
        } else {
          material.color.setHex(0xffff00) // Yellow when not blocking
          material.opacity = 0.2
        }
      }
    }

    // Update kick collider position (extends forward from block collider center)
    if (this.kickBody) {
      const pose = this.kickBody.getGlobalPose()
      const blockForwardOffset = this.blockForwardOffset ?? 0.5
      const heightOffset = this.capsuleHeight * 0.6

      v6.set(0, 0, -blockForwardOffset)
      v6.applyQuaternion(this.base.quaternion)
      v6.add(this.base.position)
      v6.y += heightOffset

      v3.set(0, 0, -this.kickDepth / 2)
      v3.applyQuaternion(this.base.quaternion)
      v6.add(v3)

      v6.toPxTransform(pose)
      this.base.quaternion.toPxTransform(pose)
      this.kickBody.setGlobalPose(pose)

      if (this.kickColliderMesh) {
        this.kickColliderMesh.position.copy(v6)
        this.kickColliderMesh.quaternion.copy(this.base.quaternion)

        const material = this.kickColliderMesh.material
        if (this.kickColliderActive) {
          material.color.setHex(0xff4400)
          material.opacity = 0.5
        } else {
          material.color.setHex(0xff8800)
          material.opacity = 0.2
        }
      }
    }

    // Update capsule collider visualization mesh
    if (this.capsuleColliderMesh) {
      this.capsuleColliderMesh.position.copy(this.base.position)
      this.capsuleColliderMesh.quaternion.copy(this.base.quaternion)
    }
  }

  teleport({ position, rotationY }) {
    position = position.isVector3 ? position : new THREE.Vector3().fromArray(position)
    const hasRotation = isNumber(rotationY)
    // snap to position
    const pose = this.capsule.getGlobalPose()
    position.toPxTransform(pose)
    this.capsuleHandle.snap(pose)
    this.base.position.copy(position)
    if (hasRotation) this.base.rotation.y = rotationY
    // send network update
    this.world.network.send('entityModified', {
      id: this.data.id,
      p: this.base.position.toArray(),
      q: this.base.quaternion.toArray(),
      t: true,
    })
    // snap camera
    this.cam.position.copy(this.base.position)
    this.cam.position.y += this.camHeight
    if (hasRotation) this.cam.rotation.y = rotationY
    this.control.camera.position.copy(this.cam.position)
    this.control.camera.quaternion.copy(this.cam.quaternion)
  }

  setEffect(effect, onEnd) {
    if (this.data.effect === effect) return
    if (this.data.effect) {
      this.data.effect = null
      this.onEffectEnd?.()
      this.onEffectEnd = null
    }
    this.data.effect = effect
    this.onEffectEnd = onEnd
    // send network update
    this.world.network.send('entityModified', {
      id: this.data.id,
      ef: effect,
    })
  }

  setSpeaking(speaking) {
    if (this.speaking === speaking) return
    if (speaking && this.isMuted()) return
    this.speaking = speaking
  }

  push(force) {
    force = v1.fromArray(force)
    // squash vertical to emulate what our huge horizontal drag coefficient does
    // force.y *= 0.1
    // add to any existing push
    if (this.pushForce) {
      this.pushForce.add(force)
    }
    // otherwise start push
    else {
      this.pushForce = force.clone()
      this.pushForceInit = false
    }
  }

  setName(name) {
    this.modify({ name })
    this.world.network.send('entityModified', { id: this.data.id, name })
  }

  setSessionAvatar(avatar) {
    this.data.sessionAvatar = avatar
    this.applyAvatar()
    this.world.network.send('entityModified', {
      id: this.data.id,
      sessionAvatar: avatar,
    })
  }

  chat(msg) {
    this.nametag.active = false
    this.bubbleText.value = msg
    this.bubble.active = true
    clearTimeout(this.chatTimer)
    this.chatTimer = setTimeout(() => {
      this.bubble.active = false
      this.nametag.active = true
    }, 5000)
  }

  onDeath() {
    console.log('[Death] Player died - starting death sequence')
    this.isDead = true
    
    // Cancel any active attacks
    if (this.attackWindupTimeout) clearTimeout(this.attackWindupTimeout)
    if (this.attackEndTimeout) clearTimeout(this.attackEndTimeout)
    if (this.attackFreezeTimeout) clearTimeout(this.attackFreezeTimeout)
    this.setSwordColliderActive(false) // This also sets swordColliderReady to false
    this.isInWindup = false
    this.isCommitted = false
    this.currentAttackEmote = null
    this.currentAttackTag = null // Clear attack tag
    this.hitPlayersThisSwing.clear()
    
    // Cancel any charged attack state and resume animation mixer BEFORE death animation starts
    if (this.isChargingAttack) {
      this.isChargingAttack = false
      this.chargedAttackEmote = null
      this.chargeStartTime = null
      this.pendingChargedRelease = false
      this.earlyReleaseHoldActive = false
      if (this.attackEarlyReleaseHoldTimeout) {
        clearTimeout(this.attackEarlyReleaseHoldTimeout)
        this.attackEarlyReleaseHoldTimeout = null
      }
    }
    if (this.attackAnimationPaused && this.avatar?.instance?.mixer) {
      this.avatar.instance.mixer.timeScale = 1
      this.attackAnimationPaused = false
    }
    
    // Cancel any active block
    if (this.blockTimeout) clearTimeout(this.blockTimeout)
    if (this.blockFreezeTimeout) clearTimeout(this.blockFreezeTimeout)
    this.setBlockColliderActive(false)
    this.isBlocking = false
    this.currentBlockTag = null // Clear block tag
    this.clearKickColliderTimeouts()
    this.currentAttackTag = null
    
    // Cancel any held block state and resume animation mixer BEFORE death animation starts
    if (this.isHoldingBlock) {
      this.isHoldingBlock = false
      this.currentBlockEmote = null
    }
    if (this.blockAnimationPaused && this.avatar?.instance?.mixer) {
      this.avatar.instance.mixer.timeScale = 1
      this.blockAnimationPaused = false
    }
    
    // Tell avatar to use dead animation as locomotion
    if (this.avatar && this.avatar.instance && this.avatar.instance.setDeathState) {
      this.avatar.instance.setDeathState(true)
    }
    
    // Play fall animation (will transition to dead locomotion when finished)
    this.setEffect({
      emote: Emotes.DEATH_FALL,
      duration: 1.5,
      cancellable: false,
    })
    
    // After 5 seconds total, play getup
    this.deathTimeout = setTimeout(() => {
      this.onRespawn()
    }, 5000)
  }
  
  onRespawn() {
    console.log('[Respawn] Starting getup sequence')
    
    // Play getup animation (will transition back to normal locomotion when finished)
    this.setEffect({
      emote: Emotes.GETUP,
      duration: 2.0,
      cancellable: false,
    })
    
    // Wait for getup animation to finish
    setTimeout(() => {
      console.log('[Respawn] Respawn complete - re-enabling movement and attacks')
      this.isDead = false
      
      // Restore normal locomotion
      if (this.avatar && this.avatar.instance && this.avatar.instance.setDeathState) {
        this.avatar.instance.setDeathState(false)
      }
      
      // Clear effect to return to normal movement
      this.setEffect(null)
      
      // Request health restoration from server
      this.world.network.send('playerHit', {
        attackerId: this.data.id,
        targetId: this.data.id,
        damage: -100, // Negative damage = healing
      })
    }, 2000)
  }

  modify(data) {
    let avatarChanged
    let changed
    if (data.hasOwnProperty('name')) {
      this.data.name = data.name
      this.world.emit('name', { playerId: this.data.id, name: this.data.name })
      changed = true
    }
    if (data.hasOwnProperty('health')) {
      const prevHealth = this.data.health !== undefined ? this.data.health : 100
      if (data.health < prevHealth) {
        this.interruptAttackFromHit()
      }
      this.data.health = data.health
      this.nametag.health = data.health
      console.log('[Health] Local player health updated to:', data.health)
      this.world.events.emit('health', { playerId: this.data.id, health: data.health })
      
      // Check for death
      if (data.health <= 0 && !this.isDead) {
        this.onDeath()
      } else if (data.health > 0 && this.isDead) {
        // If we got healed while dead, cancel death sequence
        if (this.deathTimeout) {
          clearTimeout(this.deathTimeout)
          this.deathTimeout = null
        }
        this.isDead = false
        this.setEffect(null)
        console.log('[Respawn] Death cancelled - player healed')
      }
      // changed = true
    }
    if (data.hasOwnProperty('avatar')) {
      this.data.avatar = data.avatar
      avatarChanged = true
      changed = true
    }
    if (data.hasOwnProperty('sessionAvatar')) {
      this.data.sessionAvatar = data.sessionAvatar
      avatarChanged = true
    }
    if (data.hasOwnProperty('ef')) {
      if (this.data.effect) {
        this.data.effect = null
        this.onEffectEnd?.()
        this.onEffectEnd = null
      }
      this.data.effect = data.ef
    }
    if (data.hasOwnProperty('rank')) {
      this.data.rank = data.rank
      this.world.emit('rank', { playerId: this.data.id, rank: this.data.rank })
      changed = true
    }
    if (avatarChanged) {
      this.applyAvatar()
    }
    if (changed) {
      this.world.emit('player', this)
    }
  }
}
