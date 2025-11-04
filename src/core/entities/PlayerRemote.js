import * as THREE from '../extras/three'
import { Entity } from './Entity'
import { createNode } from '../extras/createNode'
import { LerpQuaternion } from '../extras/LerpQuaternion'
import { LerpVector3 } from '../extras/LerpVector3'
import { hasRank, Ranks } from '../extras/ranks'
import { BufferedLerpVector3 } from '../extras/BufferedLerpVector3'
import { BufferedLerpQuaternion } from '../extras/BufferedLerpQuaternion'
import { Layers } from '../extras/Layers'
import { Emotes } from '../extras/playerEmotes'

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
    
    // Death state tracking
    this.isDead = false
    this.deathTimeout = null

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

  onSwordHit(otherHandle) {
    if (!this.swordColliderActive) return
    
    const playerId = otherHandle.playerId
    if (!playerId) return
    if (playerId === this.data.id) return
    if (this.hitPlayersThisSwing.has(playerId)) return
    
    this.hitPlayersThisSwing.add(playerId)
    
    // Log collision for debugging (damage is handled by server via playerHit message)
    console.log('[Sword Remote] Collision detected between', this.data.id, 'and', playerId)
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
    const anchor = this.getAnchorMatrix()
    if (!anchor) {
      this.position.update(delta)
      this.quaternion.update(delta)
    }
    // Check for attack emotes from effects first, otherwise use regular emote
    const emote = this.data.effect?.emote || this.data.emote
    this.avatar?.setEmote(emote)
    this.avatar?.instance?.setLocomotion(this.mode, this.axis, this.gaze)

    // Handle sword collider activation for attack animations
    const attackEmotes = [Emotes.ATTACK_LEFT, Emotes.ATTACK_RIGHT, Emotes.ATTACK_HIGH, Emotes.ATTACK_LOW]
    const isAttacking = this.data.effect?.emote && attackEmotes.includes(this.data.effect.emote)
    
    // Track if we just started an attack
    if (isAttacking && !this.currentlyAttacking) {
      this.currentlyAttacking = true
      this.setSwordColliderActive(true)
      // Clear the flag after attack duration
      if (this.attackTimeout) clearTimeout(this.attackTimeout)
      this.attackTimeout = setTimeout(() => {
        this.currentlyAttacking = false
        this.setSwordColliderActive(false)
      }, 1000)
    } else if (!isAttacking && this.currentlyAttacking) {
      // Attack ended early
      this.currentlyAttacking = false
      this.setSwordColliderActive(false)
      if (this.attackTimeout) {
        clearTimeout(this.attackTimeout)
        this.attackTimeout = null
      }
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

    // Update capsule collider visualization mesh
    if (this.capsuleColliderMesh) {
      this.capsuleColliderMesh.position.copy(this.base.position)
      this.capsuleColliderMesh.quaternion.copy(this.base.quaternion)
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
