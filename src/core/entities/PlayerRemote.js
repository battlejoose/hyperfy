import * as THREE from '../extras/three'
import { Entity } from './Entity'
import { createNode } from '../extras/createNode'
import { LerpQuaternion } from '../extras/LerpQuaternion'
import { LerpVector3 } from '../extras/LerpVector3'
import { hasRank, Ranks } from '../extras/ranks'
import { BufferedLerpVector3 } from '../extras/BufferedLerpVector3'
import { BufferedLerpQuaternion } from '../extras/BufferedLerpQuaternion'
import { Layers } from '../extras/Layers'
import { Emotes, KickTiming } from '../extras/playerEmotes'
import { initFootsteps, updateFootsteps, LocomotionModes } from '../extras/playerFootsteps'

let capsuleGeometry
{
  const radius = 0.3
  const inner = 1.2
  const height = radius + inner + radius
  capsuleGeometry = new THREE.CapsuleGeometry(radius, inner) // matches PlayerLocal capsule size
  capsuleGeometry.translate(0, height / 2, 0)
}

export class PlayerRemote extends Entity {
  constructor(world, data, local) {
    super(world, data, local)
    this.isPlayer = true
    this.isRemote = true
    this.init()
  }

  async init() {
    // Sword collision tracking
    this.swordColliderActive = false
    this.hitPlayersThisSwing = new Set()
    
    // Block state
    this.isBlocking = false
    this.currentlyBlocking = false
    
    // Kick state
    this.kickColliderActive = false
    this.kickColliderDelay = KickTiming.colliderDelay
    this.kickColliderDuration = KickTiming.colliderDuration
    this.kickActivateTimeout = null
    this.kickDeactivateTimeout = null
    this.hitPlayersThisKick = new Set()
    this.currentlyKicking = false
    this.blockForwardOffset = 0.5
    
    // Attack and block tags for directional blocking system
    this.currentAttackTag = null // 'high', 'left', 'right', 'low'
    this.currentBlockTag = null // 'high', 'left', 'right', 'low'
    
    // Death state tracking
    this.isDead = false
    this.deathTimeout = null
    
    // Particle system
    this.activeParticles = []

    this.base = createNode('group')
    this.base.position.fromArray(this.data.position)
    this.base.quaternion.fromArray(this.data.quaternion)

    this.body = createNode('rigidbody', { type: 'kinematic' })
    this.body.active = this.data.effect?.anchorId ? false : true
    this.base.add(this.body)
    this.collider = createNode('collider', {
      type: 'geometry',
      convex: true,
      geometry: capsuleGeometry,
      layer: 'player',
    })
    this.body.add(this.collider)

    // this.caps = createNode('mesh', {
    //   type: 'geometry',
    //   geometry: capsuleGeometry,
    //   material: new THREE.MeshStandardMaterial({ color: 'white' }),
    // })
    // this.base.add(this.caps)

    this.aura = createNode('group')
    this.nametag = createNode('nametag', { label: this.data.name, health: this.data.health, active: false })
    this.aura.add(this.nametag)

    this.bubble = createNode('ui', {
      width: 300,
      height: 512,
      pivot: 'bottom-center',
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
    if (this.world.audio) {
      this.footstepAudio = initFootsteps(this.base)
    }

    this.applyAvatar()

    this.position = new BufferedLerpVector3(this.base.position, this.world.networkRate * 1.5)
    this.quaternion = new BufferedLerpQuaternion(this.base.quaternion, this.world.networkRate * 1.5)
    this.teleport = 0

    this.mode = 0
    this.axis = new THREE.Vector3()
    this.gaze = new THREE.Vector3()

    // Set up collider visualization listener
    this.showColliders = false
    this.world.on('showColliders', (show) => {
      this.showColliders = show
      console.log('[PlayerRemote] Show colliders state changed to:', show, 'player:', this.data.id)
      
      // Update visibility if meshes already exist
      if (this.swordColliderMesh) this.swordColliderMesh.visible = show
      if (this.capsuleColliderMesh) this.capsuleColliderMesh.visible = show
    })

    this.world.setHot(this, true)
  }

  applyAvatar() {
    const avatarUrl = this.data.sessionAvatar || this.data.avatar || 'asset://avatar.vrm'
    if (this.avatarUrl === avatarUrl) return
    this.world.loader.load('avatar', avatarUrl).then(src => {
      if (this.avatar) this.avatar.deactivate()
      this.avatar = src.toNodes().get('avatar')
      this.base.add(this.avatar)
      this.nametag.position.y = this.avatar.getHeadToHeight() + 0.2
      this.bubble.position.y = this.avatar.getHeadToHeight() + 0.2
      if (!this.bubble.active) {
        this.nametag.active = true
      }
      this.avatarUrl = avatarUrl
      this.applySword()
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
    if (!PHYSX) return
    // Create a box collider for the sword blade
    const width = 0.1
    const height = 1.0
    const depth = 0.05
    const geometry = new PHYSX.PxBoxGeometry(width / 2, height / 2, depth / 2)
    
    const material = this.world.physics.physics.createMaterial(0, 0, 0)
    // Create as a trigger shape (no SIMULATION_SHAPE flag for triggers)
    const flags = new PHYSX.PxShapeFlags(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE)
    
    this.swordShape = this.world.physics.physics.createShape(geometry, material, true, flags)
    
    const filterData = new PHYSX.PxFilterData(
      Layers.weapon.group,
      Layers.weapon.mask,
      PHYSX.PxPairFlagEnum.eNOTIFY_TOUCH_FOUND | PHYSX.PxPairFlagEnum.eNOTIFY_TOUCH_LOST,
      0
    )
    
    this.swordShape.setQueryFilterData(filterData)
    this.swordShape.setSimulationFilterData(filterData)
    
    const transform = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity)
    const v1 = new THREE.Vector3()
    const q1 = new THREE.Quaternion()
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
    
    this.swordShape.setFlag(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE, false)
    this.swordColliderActive = false
    
    PHYSX.destroy(geometry)
  }

  initBlockCollider() {
    if (!PHYSX) return
    // Create a square collider in front of the player for blocking
    const capsuleRadius = 0.3
    const capsuleHeight = 1.8
    const width = capsuleRadius * 3.0
    const height = capsuleHeight * 0.9
    const depth = 0.3
    const geometry = new PHYSX.PxBoxGeometry(width / 2, height / 2, depth / 2)
    
    const material = this.world.physics.physics.createMaterial(0, 0, 0)
    // Create as SIMULATION shape so sword triggers can detect it (trigger-to-trigger doesn't work)
    const flags = new PHYSX.PxShapeFlags(PHYSX.PxShapeFlagEnum.eSIMULATION_SHAPE | PHYSX.PxShapeFlagEnum.eSCENE_QUERY_SHAPE)
    
    this.blockShape = this.world.physics.physics.createShape(geometry, material, true, flags)
    
    const filterData = new PHYSX.PxFilterData(
      Layers.player.group,
      Layers.weapon.mask,
      PHYSX.PxPairFlagEnum.eNOTIFY_TOUCH_FOUND,
      0
    )
    
    this.blockShape.setQueryFilterData(filterData)
    this.blockShape.setSimulationFilterData(filterData)
    
    const transform = new PHYSX.PxTransform(PHYSX.PxIDENTITYEnum.PxIdentity)
    const v1 = new THREE.Vector3()
    const q1 = new THREE.Quaternion()
    v1.copy(this.base.position).toPxTransform(transform)
    q1.set(0, 0, 0, 1).toPxTransform(transform)
    
    this.blockBody = this.world.physics.physics.createRigidDynamic(transform)
    this.blockBody.setRigidBodyFlag(PHYSX.PxRigidBodyFlagEnum.eKINEMATIC, true)
    this.blockBody.setActorFlag(PHYSX.PxActorFlagEnum.eDISABLE_GRAVITY, true)
    this.blockBody.attachShape(this.blockShape)
    
    // No collision callback needed for remote players' block colliders
    this.blockHandle = this.world.physics.addActor(this.blockBody, {
      tag: 'block',
      playerId: this.data.id,
    })
    
    // Store dimensions for visualization
    this.blockWidth = width
    this.blockHeight = height
    this.blockDepth = depth
    
    this.blockShape.setFlag(PHYSX.PxShapeFlagEnum.eSIMULATION_SHAPE, false)
    
    PHYSX.destroy(geometry)
  }

  initKickCollider() {
    if (!PHYSX) return
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
    const v1 = new THREE.Vector3()
    const q1 = new THREE.Quaternion()
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
    this.kickShape.setFlag(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE, false)

    PHYSX.destroy(geometry)
  }

  onSwordHit(otherHandle) {
    if (!this.swordColliderActive) return
    
    const playerId = otherHandle.playerId
    if (!playerId) return
    if (playerId === this.data.id) return
    if (this.hitPlayersThisSwing.has(playerId)) return
    
    this.hitPlayersThisSwing.add(playerId)
    
    // Check if we hit a BLOCK collider
    if (otherHandle.tag === 'block') {
      console.log('[Sword Remote] Hit BLOCK from player:', playerId)
      
      // Get blocker entity to check their block tag
      const blocker = this.world.entities.get(playerId)
      if (!blocker) return
      
      // Check if the block direction matches the attack direction
      const attackTag = this.currentAttackTag
      const blockTag = blocker.currentBlockTag
      
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
        console.log('[Sword Remote] Block SUCCESSFUL - Attack:', attackTag, 'blocked by:', blockTag, '- spawning sparks')
        // Spawn spark particles and play block audio at block position (chest area)
        const blockPos = new THREE.Vector3()
        blockPos.copy(this.base.position)
        blockPos.y += 1.8 * 0.6 // Match block collider height
        this.spawnSparkParticles(blockPos)
        this.playBlockAudio(blockPos)
        return
      } else {
        console.log('[Sword Remote] Block FAILED - Attack:', attackTag, 'vs Block:', blockTag, '- spawning blood, attack continues')
        // Block doesn't match - spawn blood and continue to damage
        const blockPos = new THREE.Vector3()
        blockPos.copy(this.base.position)
        blockPos.y += 1.8 * 0.6
        this.spawnBloodParticles(blockPos)
        this.playHitAudio(blockPos)
        return
      }
    }
    
    // Spawn blood particles and play hit audio at hit location (use sword mesh position)
    if (this.sword) {
      const hitPos = new THREE.Vector3()
      this.sword.getWorldPosition(hitPos)
      this.spawnBloodParticles(hitPos)
      this.playHitAudio(hitPos)
    }
    
    // Log collision for debugging (damage is handled by server via playerHit message)
    console.log('[Sword Remote] Collision detected between', this.data.id, 'and', playerId)
  }

  onKickHit(otherHandle) {
    // Block breaks are sent to the server; the blocker stops locally and syncs via entityModified
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
    
    console.log('[Audio Remote] Playing hit sound at position:', position)
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
    
    console.log('[Audio Remote] Playing block sound at position:', position)
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

  setSwordColliderActive(active) {
    if (!this.swordShape) return
    
    if (active && !this.swordColliderActive) {
      this.swordShape.setFlag(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE, true)
      this.swordColliderActive = true
      this.hitPlayersThisSwing.clear()
      console.log('[Sword Remote] Collider activated for player:', this.data.id)
    } else if (!active && this.swordColliderActive) {
      this.swordShape.setFlag(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE, false)
      this.swordColliderActive = false
      console.log('[Sword Remote] Collider deactivated for player:', this.data.id, '- hit', this.hitPlayersThisSwing.size, 'player(s)')
    }
  }

  setBlockColliderActive(active) {
    if (!this.blockShape) return
    
    if (active) {
      console.log('[Block Remote] Activating block collider for player:', this.data.id, '(SIMULATION shape)')
      this.blockShape.setFlag(PHYSX.PxShapeFlagEnum.eSIMULATION_SHAPE, true)
      this.isBlocking = true
    } else {
      console.log('[Block Remote] Deactivating block collider for player:', this.data.id)
      this.blockShape.setFlag(PHYSX.PxShapeFlagEnum.eSIMULATION_SHAPE, false)
      this.isBlocking = false
    }
  }

  setKickColliderActive(active) {
    if (!this.kickShape) return

    if (active && !this.kickColliderActive) {
      console.log('[Kick Remote] Activating kick collider for player:', this.data.id)
      this.kickShape.setFlag(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE, true)
      this.kickColliderActive = true
    } else if (!active && this.kickColliderActive) {
      console.log('[Kick Remote] Deactivating kick collider for player:', this.data.id)
      this.kickShape.setFlag(PHYSX.PxShapeFlagEnum.eTRIGGER_SHAPE, false)
      this.kickColliderActive = false
    }
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
    this.currentlyKicking = false
  }

  getAnchorMatrix() {
    if (this.data.effect?.anchorId) {
      return this.world.anchors.get(this.data.effect.anchorId)
    }
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

  update(delta) {
    // Update particles
    this.updateParticles(delta)
    
    const anchor = this.getAnchorMatrix()
    if (!anchor) {
      this.position.update(delta)
      this.quaternion.update(delta)
    }
    // Check for attack emotes from effects first, otherwise use regular emote
    const emote = this.data.effect?.emote || this.data.emote
    
    // Set attack/block tags based on current emote for directional blocking
    if (emote === Emotes.ATTACK_HIGH) this.currentAttackTag = 'high'
    else if (emote === Emotes.ATTACK_LEFT) this.currentAttackTag = 'left'
    else if (emote === Emotes.ATTACK_RIGHT) this.currentAttackTag = 'right'
    else if (emote === Emotes.ATTACK_LOW) this.currentAttackTag = 'low'
    else if (emote === Emotes.BLOCK_HIGH) this.currentBlockTag = 'high'
    else if (emote === Emotes.BLOCK_LEFT) this.currentBlockTag = 'left'
    else if (emote === Emotes.BLOCK_RIGHT) this.currentBlockTag = 'right'
    else if (emote === Emotes.BLOCK_LOW) this.currentBlockTag = 'low'
    else if (emote === Emotes.BLOCK) this.currentBlockTag = null // Old block blocks everything
    else {
      // Clear tags if not attacking or blocking
      this.currentAttackTag = null
      this.currentBlockTag = null
    }
    
    // Pass effect duration if available (important for charged attacks)
    // NOTE: Must call .instance.setEmote() directly to pass duration parameter
    // because the Avatar Node wrapper only accepts one parameter
    const duration = this.data.effect?.duration
    if (this.avatar?.instance) {
      this.avatar.instance.setEmote(emote, duration)
    }
    this.avatar?.instance?.setLocomotion(this.mode, this.axis, this.gaze)

    updateFootsteps(this.footstepAudio, {
      mode: this.mode,
      isDead: this.isDead,
      isFlying: this.mode === LocomotionModes.FLY,
      hasEffectEmote: !!this.data.effect?.emote,
    })

    // Handle sword collider activation for attack animations
    const attackEmotes = [Emotes.ATTACK_LEFT, Emotes.ATTACK_RIGHT, Emotes.ATTACK_HIGH, Emotes.ATTACK_LOW]
    const isAttacking = this.data.effect?.emote && attackEmotes.includes(this.data.effect.emote)
    const attackDuration = this.data.effect?.duration || 0
    
    // Detect charged attack (duration > 10 means player is holding)
    const isChargingAttack = isAttacking && attackDuration > 10
    
    // Track if we just started an attack
    if (isAttacking && !this.currentlyAttacking) {
      this.currentlyAttacking = true
      this.attackStartTime = Date.now()
      this.currentAttackEmote = this.data.effect.emote
      this.lastAttackDuration = attackDuration
      
      // If it's a charged attack, pause animation after 0.5s (same as local player)
      if (isChargingAttack) {
        if (this.attackFreezeTimeout) clearTimeout(this.attackFreezeTimeout)
        this.attackFreezeTimeout = setTimeout(() => {
          // Pause the animation mixer
          if (this.avatar?.instance?.mixer) {
            this.avatar.instance.mixer.timeScale = 0
            this.attackAnimationPaused = true
          }
        }, 500)
      } else {
        // Normal attack - activate collider after 0.5s
        if (this.attackColliderDelayTimeout) clearTimeout(this.attackColliderDelayTimeout)
        this.attackColliderDelayTimeout = setTimeout(() => {
          if (this.currentlyAttacking) {
            this.setSwordColliderActive(true)
          }
          this.attackColliderDelayTimeout = null
        }, 500)
      }
      
      // Clear the flag after attack duration (use actual duration, not hardcoded 1s)
      if (this.attackTimeout) clearTimeout(this.attackTimeout)
      this.attackTimeout = setTimeout(() => {
        this.currentlyAttacking = false
        this.setSwordColliderActive(false)
      }, attackDuration * 1000)
    } else if (isAttacking && this.currentlyAttacking) {
      // Check if duration changed (from charging to release)
      if (this.lastAttackDuration > 10 && attackDuration <= 10) {
        // Player released! Resume animation and activate collider
        if (this.attackFreezeTimeout) {
          clearTimeout(this.attackFreezeTimeout)
          this.attackFreezeTimeout = null
        }
        
        // Resume animation mixer
        if (this.attackAnimationPaused && this.avatar?.instance?.mixer) {
          this.avatar.instance.mixer.timeScale = 1
          this.attackAnimationPaused = false
        }
        
        // Activate sword collider immediately on release
        this.setSwordColliderActive(true)
      }
      
      this.lastAttackDuration = attackDuration
    } else if (!isAttacking && this.currentlyAttacking) {
      // Attack ended early - check if it was held for at least 0.5 seconds
      const holdDuration = Date.now() - this.attackStartTime
      if (holdDuration < 500) {
        // Released too early - cancel collider activation
        if (this.attackColliderDelayTimeout) {
          clearTimeout(this.attackColliderDelayTimeout)
          this.attackColliderDelayTimeout = null
        }
        if (this.attackFreezeTimeout) {
          clearTimeout(this.attackFreezeTimeout)
          this.attackFreezeTimeout = null
        }
      }
      
      // Resume animation if it was paused
      if (this.attackAnimationPaused && this.avatar?.instance?.mixer) {
        this.avatar.instance.mixer.timeScale = 1
        this.attackAnimationPaused = false
      }
      
      this.currentlyAttacking = false
      this.setSwordColliderActive(false)
      if (this.attackTimeout) {
        clearTimeout(this.attackTimeout)
        this.attackTimeout = null
      }
    }
    
    // Handle block collider activation for block animation
    const blockEmotes = [Emotes.BLOCK, Emotes.BLOCK_HIGH, Emotes.BLOCK_LEFT, Emotes.BLOCK_RIGHT, Emotes.BLOCK_LOW]
    const isBlocking = this.data.effect?.emote && blockEmotes.includes(this.data.effect.emote)
    
    if (isBlocking && !this.currentlyBlocking) {
      this.currentlyBlocking = true
      console.log('[Block Remote] Activating block collider for emote:', this.data.effect.emote, 'with tag:', this.currentBlockTag)
      this.setBlockColliderActive(true)
      // For directional blocks with long duration (999), keep active indefinitely
      // For normal blocks, clear after 1 second
      const blockDuration = this.data.effect?.duration || 1.0
      if (blockDuration < 10) {
        // Normal timed block
        if (this.blockTimeout) clearTimeout(this.blockTimeout)
        this.blockTimeout = setTimeout(() => {
          this.currentlyBlocking = false
          this.setBlockColliderActive(false)
        }, blockDuration * 1000)
      }
    } else if (!isBlocking && this.currentlyBlocking) {
      // Block ended early
      console.log('[Block Remote] Deactivating block collider')
      this.currentlyBlocking = false
      this.setBlockColliderActive(false)
      if (this.blockTimeout) {
        clearTimeout(this.blockTimeout)
        this.blockTimeout = null
      }
    }

    // Handle kick collider activation for kick animation
    const isKicking = this.data.effect?.emote === Emotes.KICK

    if (isKicking && !this.currentlyKicking) {
      this.currentlyKicking = true
      this.hitPlayersThisKick.clear()
      this.kickActivateTimeout = setTimeout(() => {
        if (this.currentlyKicking) this.setKickColliderActive(true)
        this.kickActivateTimeout = null
      }, this.kickColliderDelay * 1000)
      this.kickDeactivateTimeout = setTimeout(() => {
        this.setKickColliderActive(false)
        this.kickDeactivateTimeout = null
      }, (this.kickColliderDelay + this.kickColliderDuration) * 1000)
    } else if (!isKicking && this.currentlyKicking) {
      this.clearKickColliderTimeouts()
    }
  }

  lateUpdate(delta) {
    // Create collider meshes if needed (deferred until scene is ready)
    if (this.showColliders && this.world.stage && this.world.stage.scene) {
      // Create capsule mesh if it doesn't exist
      if (!this.capsuleColliderMesh) {
        const radius = 0.3
        const inner = 1.2
        const height = radius + inner + radius
        const capsuleGeom = new THREE.CapsuleGeometry(radius, inner, 8, 16)
        capsuleGeom.translate(0, height / 2, 0)
        const capsuleMat = new THREE.MeshBasicMaterial({
          color: 0x0000ff,
          transparent: true,
          opacity: 0.3,
          wireframe: false,
          depthTest: true,
        })
        this.capsuleColliderMesh = new THREE.Mesh(capsuleGeom, capsuleMat)
        this.capsuleColliderMesh.visible = true
        this.world.stage.scene.add(this.capsuleColliderMesh)
        console.log('[PlayerRemote] Created capsule collider mesh (deferred) for player:', this.data.id)
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
        console.log('[PlayerRemote] Created sword collider mesh (deferred) for player:', this.data.id)
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
        console.log('[PlayerRemote] Created block collider mesh (deferred) for player:', this.data.id)
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
        console.log('[PlayerRemote] Created kick collider mesh (deferred) for player:', this.data.id)
      }
    }

    const anchor = this.getAnchorMatrix()
    if (anchor) {
      this.position.snap()
      this.quaternion.snap()
      this.base.position.setFromMatrixPosition(anchor)
      this.base.quaternion.setFromRotationMatrix(anchor)
      this.base.clean()
    }
    if (this.avatar) {
      const matrix = this.avatar.getBoneTransform('head')
      if (matrix) {
        this.aura.position.setFromMatrixPosition(matrix)
      }
    }
    if (this.avatar && this.sword) {
      const matrix = this.avatar.getBoneTransform('rightHand')
      if (matrix) {
        const v5 = new THREE.Vector3()
        const v6 = new THREE.Vector3()
        const q4 = new THREE.Quaternion()
        
        // Get base transform from hand bone
        this.sword.position.setFromMatrixPosition(matrix)
        this.sword.quaternion.setFromRotationMatrix(matrix)
        
        // Scale the sword down to a reasonable size
        this.sword.scale.set(0.7, 0.7, 0.7)
        
        // Apply rotation offset to orient sword properly in hand
        q4.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
        this.sword.quaternion.multiply(q4)
        
        // Apply position offset relative to hand orientation
        v5.set(0.15, -0.5, 0.0)
        v5.applyQuaternion(this.sword.quaternion)
        this.sword.position.add(v5)

        // Update sword collider position to match sword mesh
        if (this.swordBody) {
          const pose = this.swordBody.getGlobalPose()
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
      const v6 = new THREE.Vector3()
      const pose = this.blockBody.getGlobalPose()
      // Position block collider in front of player at chest height
      const forwardOffset = 0.5
      const heightOffset = 1.8 * 0.6 // Upper mid-body
      
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
      const v3 = new THREE.Vector3()
      const v6 = new THREE.Vector3()
      const pose = this.kickBody.getGlobalPose()
      const blockForwardOffset = this.blockForwardOffset ?? 0.5
      const heightOffset = 1.8 * 0.6

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

  onAttackCanceled() {
    console.log('[Attack] Remote player canceled attack early')
    
    // Cancel any pending timeouts
    if (this.attackFreezeTimeout) {
      clearTimeout(this.attackFreezeTimeout)
      this.attackFreezeTimeout = null
    }
    if (this.attackColliderDelayTimeout) {
      clearTimeout(this.attackColliderDelayTimeout)
      this.attackColliderDelayTimeout = null
    }
    
    // Resume animation if it was paused
    if (this.attackAnimationPaused && this.avatar?.instance?.mixer) {
      this.avatar.instance.mixer.timeScale = 1
      this.attackAnimationPaused = false
    }
    
    // Force switch back to locomotion by clearing the emote
    if (this.avatar?.instance) {
      this.avatar.instance.setEmote(null)
    }
    
    // Clear the effect data
    this.data.effect = null
    
    // Immediately end the attack
    this.currentlyAttacking = false
    this.setSwordColliderActive(false)
    if (this.attackTimeout) {
      clearTimeout(this.attackTimeout)
      this.attackTimeout = null
    }
  }

  setEffect(effect, onEnd) {
    if (this.data.effect) {
      this.data.effect = null
      this.onEffectEnd?.()
      this.onEffectEnd = null
    }
    this.data.effect = effect
    this.onEffectEnd = onEnd
    this.body.active = effect?.anchorId ? false : true
  }

  setSpeaking(speaking) {
    if (this.speaking === speaking) return
    if (speaking && this.isMuted()) return
    this.speaking = speaking
    const name = this.data.name
    this.nametag.label = speaking ? `» ${name} «` : name
  }

  modify(data) {
    let avatarChanged
    if (data.hasOwnProperty('t')) {
      this.teleport++
    }
    if (data.hasOwnProperty('p')) {
      this.data.position = data.p
      this.position.push(data.p, this.teleport)
    }
    if (data.hasOwnProperty('q')) {
      this.data.quaternion = data.q
      this.quaternion.push(data.q, this.teleport)
    }
    if (data.hasOwnProperty('m')) {
      this.data.mode = data.m
      this.mode = data.m
    }
    if (data.hasOwnProperty('a')) {
      this.data.axis = data.a
      this.axis.fromArray(data.a)
    }
    if (data.hasOwnProperty('g')) {
      this.data.gaze = data.g
      this.gaze.fromArray(data.g)
    }
    if (data.hasOwnProperty('e')) {
      this.data.emote = data.e
    }
    if (data.hasOwnProperty('ef')) {
      this.setEffect(data.ef)
    }
    if (data.hasOwnProperty('name')) {
      this.data.name = data.name
      this.nametag.label = data.name
      this.world.emit('name', { playerId: this.data.id, name: this.data.name })
    }
    if (data.hasOwnProperty('health')) {
      const previousHealth = this.data.health
      this.data.health = data.health
      this.nametag.health = data.health
      console.log('[Health] Remote player', this.data.id, 'health updated to:', data.health)
      this.world.events.emit('health', { playerId: this.data.id, health: data.health })
      
      // Handle death and respawn
      if (data.health <= 0 && (previousHealth === undefined || previousHealth > 0)) {
        this.onDeath()
      } else if (data.health > 0 && this.isDead) {
        // Healing while dead = respawn
        if (this.deathTimeout) {
          clearTimeout(this.deathTimeout)
          this.deathTimeout = null
        }
        this.onRespawn()
      }
    }
    if (data.hasOwnProperty('avatar')) {
      this.data.avatar = data.avatar
      avatarChanged = true
    }
    if (data.hasOwnProperty('sessionAvatar')) {
      this.data.sessionAvatar = data.sessionAvatar
      avatarChanged = true
    }
    if (data.hasOwnProperty('rank')) {
      this.data.rank = data.rank
      this.world.emit('rank', { playerId: this.data.id, rank: this.data.rank })
    }
    if (avatarChanged) {
      this.applyAvatar()
    }
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
    console.log('[Death] Remote player', this.data.id, 'died - starting death sequence')
    this.isDead = true
    
    // Cancel any charged attack state and resume animation mixer BEFORE death animation starts
    if (this.attackFreezeTimeout) {
      clearTimeout(this.attackFreezeTimeout)
      this.attackFreezeTimeout = null
    }
    if (this.attackColliderDelayTimeout) {
      clearTimeout(this.attackColliderDelayTimeout)
      this.attackColliderDelayTimeout = null
    }
    if (this.attackTimeout) {
      clearTimeout(this.attackTimeout)
      this.attackTimeout = null
    }
    if (this.attackAnimationPaused && this.avatar?.instance?.mixer) {
      this.avatar.instance.mixer.timeScale = 1
      this.attackAnimationPaused = false
    }
    this.setSwordColliderActive(false)
    
    // Tell avatar to use dead animation as locomotion
    if (this.avatar && this.avatar.instance && this.avatar.instance.setDeathState) {
      this.avatar.instance.setDeathState(true)
    }
    
    // The fall effect will be triggered via setEffect from the network
    // After 5 seconds, the getup effect will also come via network
    // We just need to handle the respawn timing locally for UI purposes
    this.deathTimeout = setTimeout(() => {
      // Remote respawn doesn't restore health locally - that comes from server
      console.log('[Respawn] Remote player', this.data.id, 'respawn timing complete')
    }, 7000) // Fall (1.5s) + wait (5s) + getup (2s) - but effects come from network
  }
  
  onRespawn() {
    console.log('[Respawn] Remote player', this.data.id, 'respawning')
    this.isDead = false
    
    // Restore normal locomotion
    if (this.avatar && this.avatar.instance && this.avatar.instance.setDeathState) {
      this.avatar.instance.setDeathState(false)
    }
  }

  destroy(local) {
    if (this.destroyed) return
    this.destroyed = true

    clearTimeout(this.chatTimer)
    clearTimeout(this.attackTimeout)
    clearTimeout(this.deathTimeout)
    this.base.deactivate()
    this.avatar = null
    if (this.sword) this.sword.deactivate()
    this.sword = null

    // Clean up sword collider
    if (this.swordHandle) {
      this.swordHandle.destroy()
      this.swordHandle = null
    }
    if (this.swordBody) {
      this.swordBody = null
    }
    if (this.swordShape) {
      this.swordShape = null
    }

    // Clean up visualization meshes (client only)
    if (this.world.stage && this.world.stage.scene) {
      if (this.swordColliderMesh) {
        this.world.stage.scene.remove(this.swordColliderMesh)
        this.swordColliderMesh = null
      }
      if (this.capsuleColliderMesh) {
        this.world.stage.scene.remove(this.capsuleColliderMesh)
        this.capsuleColliderMesh = null
      }
    }

    this.world.setHot(this, false)
    this.world.events.emit('leave', { playerId: this.data.id })
    this.aura.deactivate()
    this.aura = null

    this.world.entities.remove(this.data.id)
    // if removed locally we need to broadcast to server/clients
    if (local) {
      this.world.network.send('entityRemoved', this.data.id)
    }
  }
}
