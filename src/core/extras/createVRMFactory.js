import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'

import * as THREE from './three'
import { DEG2RAD } from './general'
import { getTrianglesFromGeometry } from './getTrianglesFromGeometry'
import { getTextureBytesFromMaterial } from './getTextureBytesFromMaterial'
import { Emotes, KickTiming, AttackTiming } from './playerEmotes'
import { CombatHandOffsets } from './combatHandOffsets'

const v1 = new THREE.Vector3()
const v2 = new THREE.Vector3()
const q1 = new THREE.Quaternion()
const m1 = new THREE.Matrix4()

const FORWARD = new THREE.Vector3(0, 0, -1)

const DIST_MIN_RATE = 1 / 5 // 5 times per second
const DIST_MAX_RATE = 1 / 60 // 40 times per second
const DIST_MIN = 5 // <= 5m = max rate
const DIST_MAX = 60 // >= 60m = min rate

const MAX_GAZE_DISTANCE = 40

const material = new THREE.MeshBasicMaterial()

const AimAxis = {
  X: new THREE.Vector3(1, 0, 0),
  Y: new THREE.Vector3(0, 1, 0),
  Z: new THREE.Vector3(0, 0, 1),
  NEG_X: new THREE.Vector3(-1, 0, 0),
  NEG_Y: new THREE.Vector3(0, -1, 0),
  NEG_Z: new THREE.Vector3(0, 0, -1),
}

const UpAxis = {
  X: new THREE.Vector3(1, 0, 0),
  Y: new THREE.Vector3(0, 1, 0),
  Z: new THREE.Vector3(0, 0, 1),
  NEG_X: new THREE.Vector3(-1, 0, 0),
  NEG_Y: new THREE.Vector3(0, -1, 0),
  NEG_Z: new THREE.Vector3(0, 0, -1),
}

// TODO: de-dup PlayerLocal.js has a copy
const Modes = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  JUMP: 3,
  FALL: 4,
  FLY: 5,
  TALK: 6,
}

export function createVRMFactory(glb, setupMaterial) {
  // we'll update matrix ourselves
  glb.scene.matrixAutoUpdate = false
  glb.scene.matrixWorldAutoUpdate = false
  // remove expressions from scene
  const expressions = glb.scene.children.filter(n => n.type === 'VRMExpression') // prettier-ignore
  for (const node of expressions) node.removeFromParent()
  // remove VRMHumanoidRig
  const vrmHumanoidRigs = glb.scene.children.filter(n => n.name === 'VRMHumanoidRig') // prettier-ignore
  for (const node of vrmHumanoidRigs) node.removeFromParent()
  // remove secondary
  const secondaries = glb.scene.children.filter(n => n.name === 'secondary') // prettier-ignore
  for (const node of secondaries) node.removeFromParent()
  // enable shadows
  glb.scene.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true
      obj.receiveShadow = true
    }
  })
  // calculate root to hips
  const bones = glb.userData.vrm.humanoid._rawHumanBones.humanBones
  const hipsPosition = v1.setFromMatrixPosition(bones.hips.node.matrixWorld)
  const rootPosition = v2.set(0, 0, 0) //setFromMatrixPosition(bones.root.node.matrixWorld)
  const rootToHips = hipsPosition.y - rootPosition.y
  // get vrm version
  const version = glb.userData.vrm.meta?.metaVersion
  // convert skinned mesh to detached bind mode
  // this lets us remove root bone from scene and then only perform matrix updates on the whole skeleton
  // when we actually need to  for massive performance
  const skinnedMeshes = []
  glb.scene.traverse(node => {
    if (node.isSkinnedMesh) {
      node.bindMode = THREE.DetachedBindMode
      node.bindMatrix.copy(node.matrixWorld)
      node.bindMatrixInverse.copy(node.bindMatrix).invert()
      skinnedMeshes.push(node)
    }
    if (node.isMesh) {
      // bounds tree
      node.geometry.computeBoundsTree()
      // fix csm shadow banding
      node.material.shadowSide = THREE.BackSide
      // csm material setup
      setupMaterial(node.material)
    }
  })
  // remove root bone from scene
  // const rootBone = glb.scene.getObjectByName('RootBone')
  // console.log({ rootBone })
  // rootBone.parent.remove(rootBone)
  // rootBone.updateMatrixWorld(true)

  const skeleton = skinnedMeshes[0].skeleton // should be same across all skinnedMeshes

  // pose arms down
  const normBones = glb.userData.vrm.humanoid._normalizedHumanBones.humanBones
  const leftArm = normBones.leftUpperArm.node
  leftArm.rotation.z = 75 * DEG2RAD
  const rightArm = normBones.rightUpperArm.node
  rightArm.rotation.z = -75 * DEG2RAD
  glb.userData.vrm.humanoid.update(0)
  skeleton.update()

  // get height
  let height = 0.5 // minimum
  for (const mesh of skinnedMeshes) {
    if (!mesh.boundingBox) mesh.computeBoundingBox()
    if (height < mesh.boundingBox.max.y) {
      height = mesh.boundingBox.max.y
    }
  }

  // this.headToEyes = this.eyePosition.clone().sub(headPos)
  const headPos = normBones.head.node.getWorldPosition(new THREE.Vector3())
  const headToHeight = height - headPos.y

  const getBoneName = vrmBoneName => {
    return glb.userData.vrm.humanoid.getRawBoneNode(vrmBoneName)?.name
  }

  const noop = () => {
    // ...
  }

  return {
    create,
    applyStats(stats) {
      glb.scene.traverse(obj => {
        if (obj.geometry && !stats.geometries.has(obj.geometry.uuid)) {
          stats.geometries.add(obj.geometry.uuid)
          stats.triangles += getTrianglesFromGeometry(obj.geometry)
        }
        if (obj.material && !stats.materials.has(obj.material.uuid)) {
          stats.materials.add(obj.material.uuid)
          stats.textureBytes += getTextureBytesFromMaterial(obj.material)
        }
      })
    },
  }

  function create(matrix, hooks, node) {
    const vrm = cloneGLB(glb)
    const tvrm = vrm.userData.vrm
    const skinnedMeshes = getSkinnedMeshes(vrm.scene)
    const skeleton = skinnedMeshes[0].skeleton // should be same across all skinnedMeshes
    const rootBone = skeleton.bones[0] // should always be 0
    rootBone.parent.remove(rootBone)
    rootBone.updateMatrixWorld(true)
    vrm.scene.matrix = matrix // synced!
    vrm.scene.matrixWorld = matrix // synced!
    hooks.scene.add(vrm.scene)

    const getEntity = () => node?.ctx.entity

    // spatial capsule
    const cRadius = 0.3
    const sItem = {
      matrix,
      geometry: createCapsule(cRadius, height - cRadius * 2),
      material,
      getEntity,
    }
    hooks.octree?.insert(sItem)

    // debug capsule
    // const foo = new THREE.Mesh(
    //   sItem.geometry,
    //   new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 })
    // )
    // vrm.scene.add(foo)

    // link back entity for raycasts

    vrm.scene.traverse(o => {
      o.getEntity = getEntity
    })

    // i have no idea how but the mixer only needs one of the skinned meshes
    // and if i set it to vrm.scene it no longer works with detached bind mode
    const mixer = new THREE.AnimationMixer(skinnedMeshes[0])

    const bonesByName = {}
    const findBone = name => {
      // name is the official vrm bone name eg 'leftHand'
      // actualName is the actual bone name used in the skeleton which may different across vrms
      if (!bonesByName[name]) {
        const actualName = glb.userData.vrm.humanoid.getRawBoneNode(name)?.name
        bonesByName[name] = skeleton.getBoneByName(actualName)
      }
      return bonesByName[name]
    }

    const mt = new THREE.Matrix4()
    const getBoneTransform = boneName => {
      const bone = findBone(boneName)
      if (!bone) return null
      // combine the scene's world matrix with the bone's world matrix
      return mt.multiplyMatrices(vrm.scene.matrixWorld, bone.matrixWorld)
    }

    const loco = {
      mode: Modes.IDLE,
      axis: new THREE.Vector3(),
      gazeDir: null,
    }
    const setLocomotion = (mode, axis, gazeDir) => {
      loco.mode = mode
      loco.axis = axis
      loco.gazeDir = gazeDir
    }

    // world.updater.add(update)
    const emotes = {
      // [url]: {
      //   url: String
      //   loading: Boolean
      //   action: AnimationAction
      // }
    }
    const attackEmotes = [Emotes.ATTACK_LEFT, Emotes.ATTACK_RIGHT, Emotes.ATTACK_HIGH, Emotes.ATTACK_LOW, Emotes.BLOCK, Emotes.BLOCK_LEFT, Emotes.BLOCK_RIGHT, Emotes.BLOCK_HIGH, Emotes.BLOCK_LOW, Emotes.KICK]
    const attackUrlToKey = {
      [Emotes.ATTACK_LEFT]: 'attackLeft',
      [Emotes.ATTACK_RIGHT]: 'attackRight',
      [Emotes.ATTACK_HIGH]: 'attackHigh',
      [Emotes.ATTACK_LOW]: 'attackLow',
      [Emotes.BLOCK]: 'block',
      [Emotes.BLOCK_LEFT]: 'blockLeft',
      [Emotes.BLOCK_RIGHT]: 'blockRight',
      [Emotes.BLOCK_HIGH]: 'blockHigh',
      [Emotes.BLOCK_LOW]: 'blockLow',
      [Emotes.KICK]: 'kick',
    }
    
    // Death emotes should be treated specially - full body animations
    const deathEmotes = [Emotes.DEATH_FALL, Emotes.DEAD, Emotes.GETUP]
    const deathUrlToKey = {
      [Emotes.DEATH_FALL]: 'deathFall',
      [Emotes.DEAD]: 'dead',
      [Emotes.GETUP]: 'getup',
    }
    
    let currentAttack = null
    let kickVisualComplete = false // kick played once; ignore effect ticks until cleared
    
    let currentEmote
    let isInDeathState = false // Track if player is dead (affects locomotion)

    const isCombatActionFinished = (action, poseKey) => {
      if (!action?.isRunning()) return true
      const clip = action.getClip()
      if (!clip?.duration) return false
      const trim =
        poseKey &&
        !poseKey.startsWith('block') &&
        poseKey !== 'kick' &&
        poseKey !== 'deathFall' &&
        poseKey !== 'getup' &&
        poseKey !== 'dead'
          ? AttackTiming.recoveryTrim
          : 0
      return action.time >= clip.duration - 0.03 - trim
    }

    const syncCurrentAttack = () => {
      if (!currentAttack) return
      const action = poses[currentAttack]?.action
      if (isCombatActionFinished(action, currentAttack)) {
        if (currentAttack.startsWith('block')) {
          // Held blocks clamp at the end until the effect clears
          poses[currentAttack].target = 1
          return
        }
        if (currentAttack === 'kick') {
          // Kick plays once, then blend back to locomotion (no end-pose hold)
          kickVisualComplete = true
          stopCombatPose('kick')
          currentAttack = null
          return
        }
        stopCombatPose(currentAttack)
        currentAttack = null
      } else {
        poses[currentAttack].target = 1
      }
    }
    
    const stopCombatPose = (poseKey, { immediate = false } = {}) => {
      const pose = poses[poseKey]
      if (!pose) return
      pose.target = 0
      pose.active = false
      if (immediate) {
        pose.fadingOut = false
        pose.weight = 0
        pose.setWeight(0)
        if (pose.action) {
          pose.action.stop()
        }
      } else if (pose.action) {
        // Freeze the clip so a canceled swing doesn't keep playing (e.g. a
        // charge-hold resuming into the strike), then fade it out in
        // EFFECTIVE weight space via the mixer. The regular weight lerp is
        // skipped while fadingOut — combat poses carry a 5x effective weight
        // multiplier, which makes the lerp read as an instant snap.
        pose.fadingOut = true
        pose.weight = 0
        pose.action.paused = true
        pose.action.fadeOut(0.25)
      }
    }

    const clearCurrentCombatPose = ({ immediate = false } = {}) => {
      if (!currentAttack) return
      const prevKey = currentAttack
      currentAttack = null
      stopCombatPose(prevKey, { immediate })
    }
    
    const setDeathState = (isDead) => {
      isInDeathState = isDead
      if (isDead) {
        mixer.timeScale = 1
        clearCurrentCombatPose({ immediate: true })
        for (const key in poses) {
          if (poses[key].upperBodyOnly) {
            poses[key].target = 0
            poses[key].weight = 0
            poses[key].setWeight(0)
            if (poses[key].action) {
              poses[key].action.stop()
            }
          }
        }
      }
    }
    
    const setEmote = (url, duration, options = {}) => {
      // Check if this is a death effect (fall or getup) - treat like attacks
      if (url && (url === Emotes.DEATH_FALL || url === Emotes.GETUP)) {
        const deathKey = deathUrlToKey[url]
        
        // Check if already playing this death animation - DON'T restart it!
        if (currentEmote?.url === url) {
          return
        }
        
        // CRITICAL: Ensure mixer is running at normal speed (charged attack may have paused it)
        mixer.timeScale = 1
        
        // Simple handling like old version - just set currentEmote and play
        currentEmote = { url }
        
        if (poses[deathKey]) {
          if (poses[deathKey].action) {
            poses[deathKey].action.reset()
            poses[deathKey].action.time = 0
            poses[deathKey].action.enabled = true
            poses[deathKey].action.setEffectiveWeight(10.0)
            poses[deathKey].action.play()
          }
          poses[deathKey].target = 1
          poses[deathKey].weight = 1
          poses[deathKey].setWeight(1)
        }
        return
      } else if (!url) {
        // Clear emote
        currentEmote = null
        // Clear any death effect animations
        if (poses.deathFall) poses.deathFall.target = 0
        if (poses.getup) poses.getup.target = 0
        // Clear emote — blend attack poses back to locomotion (recovery is
        // trimmed via AttackTiming.recoveryTrim in syncCurrentAttack).
        clearCurrentCombatPose()
        kickVisualComplete = false
      }
      
      // Check if this is an attack animation
      if (url && attackEmotes.includes(url)) {
        if (isInDeathState) return
        const attackKey = attackUrlToKey[url]
        const attackDuration = duration || 1.0 // Use provided duration or default to 1 second
        
        // Skip if same attack is already playing with same duration
        if (currentAttack === attackKey) {
          return // Same attack — let the clip play out; don't reset or re-time from network ticks
        }

        // Kick effect duration can outlive the clip — don't replay after one pass
        if (attackKey === 'kick' && kickVisualComplete) {
          return
        }

        if (currentAttack) {
          clearCurrentCombatPose({ immediate: true })
        }

        mixer.timeScale = 1
        
        console.log('[VRM] Attack detected:', attackKey, 'duration:', attackDuration, 'pose exists:', !!poses[attackKey])
        if (poses[attackKey]) {
          currentAttack = attackKey
          poses[attackKey].fadingOut = false
          if (attackKey === 'kick') {
            kickVisualComplete = false
          }
          if (poses[attackKey].action) {
            // Reset and restart the attack animation with high priority
            poses[attackKey].action.reset()
            poses[attackKey].action.time = 0
            poses[attackKey].action.enabled = true
            poses[attackKey].action.setEffectiveWeight(5.0) // Much higher weight to override locomotion
            poses[attackKey].action.play()
            poses[attackKey].active = true
            console.log('[VRM] Attack action reset and playing with very high priority')
          } else {
            console.log('[VRM] Attack action not loaded yet')
          }
        } else {
          console.log('[VRM] Attack pose not found in poses')
        }
        return // Don't treat as regular emote
      }
      
      if (currentEmote?.url === url) return
      if (currentEmote) {
        currentEmote.action?.fadeOut(0.15)
        currentEmote = null
      }
      if (!url) return
      const opts = getQueryParams(url)
      const loop = opts.l !== '0'
      const speed = parseFloat(opts.s || 1)
      const gaze = opts.g == '1'

      if (emotes[url]) {
        currentEmote = emotes[url]
        if (currentEmote.action) {
          currentEmote.action.clampWhenFinished = !loop
          currentEmote.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce)
          currentEmote.action.reset().fadeIn(0.15).play()
          clearLocomotion()
        }
      } else {
        const emote = {
          url,
          loading: true,
          action: null,
          gaze,
        }
        emotes[url] = emote
        currentEmote = emote
        hooks.loader.load('emote', url).then(emo => {
          const clip = emo.toClip({
            rootToHips,
            version,
            getBoneName,
          })
          const action = mixer.clipAction(clip)
          action.timeScale = speed
          emote.action = action
          // if its still this emote, play it!
          if (currentEmote === emote) {
            action.clampWhenFinished = !loop
            action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce)
            action.play()
            clearLocomotion()
          }
        })
      }
    }

    // IDEA: we should use a global frame "budget" to distribute across avatars
    // https://chatgpt.com/c/4bbd469d-982e-4987-ad30-97e9c5ee6729

    let elapsed = 0
    let rate = 0
    let rateCheck = true
    let distance

    const updateRate = () => {
      const vrmPos = v1.setFromMatrixPosition(vrm.scene.matrix)
      const camPos = v2.setFromMatrixPosition(hooks.camera.matrixWorld) // prettier-ignore
      distance = vrmPos.distanceTo(camPos)
      const clampedDistance = Math.max(distance - DIST_MIN, 0)
      const normalizedDistance = Math.min(clampedDistance / (DIST_MAX - DIST_MIN), 1) // prettier-ignore
      rate = DIST_MAX_RATE + normalizedDistance * (DIST_MIN_RATE - DIST_MAX_RATE) // prettier-ignore
      // console.log('distance', distance)
      // console.log('rate per second', 1 / rate)
    }

    const update = delta => {
      elapsed += delta
      const should = rateCheck ? elapsed >= rate : true
      if (should) {
        mixer.update(elapsed)
        skeleton.bones.forEach(bone => bone.updateMatrixWorld())
        skeleton.update = THREE.Skeleton.prototype.update
        // Check if current emote is a death effect (full body animations that override everything)
        const isDeathEffect = currentEmote?.url === Emotes.DEATH_FALL || currentEmote?.url === Emotes.GETUP
        
        if (isDeathEffect) {
          // Death effects completely override locomotion - turn off all locomotion
          for (const key in poses) {
            if (!poses[key].upperBodyOnly && key !== 'deathFall' && key !== 'getup') {
              poses[key].target = 0
            }
          }
        } else if (!currentEmote) {
          // No emote playing - update normal locomotion
          updateLocomotion(delta)
        }
        // If there's a non-death emote playing, skip locomotion updates
        
        // Update attack and death effect weights (they play on top of or replace locomotion)
        syncCurrentAttack()
        
        // Update ALL pose weights
        const lerpSpeed = 16
        for (const key in poses) {
          const pose = poses[key]
          const weight = THREE.MathUtils.lerp(pose.weight, pose.target, 1 - Math.exp(-lerpSpeed * delta))
          pose.setWeight(weight)
        }
        if (loco.gazeDir && distance < MAX_GAZE_DISTANCE && (currentEmote ? currentEmote.gaze : true)) {
          // aimBone('chest', loco.gazeDir, delta, {
          //   minAngle: -90,
          //   maxAngle: 90,
          //   smoothing: 0.7,
          //   weight: 0.7,
          // })
          aimBone('neck', loco.gazeDir, delta, {
            minAngle: -30,
            maxAngle: 30,
            smoothing: 0.4,
            weight: 0.6,
          })
          aimBone('head', loco.gazeDir, delta, {
            minAngle: -30,
            maxAngle: 30,
            smoothing: 0.4,
            weight: 0.6,
          })
        }
        // tvrm.humanoid.update(elapsed)
        elapsed = 0
      } else {
        skeleton.update = noop
      }
    }

    const aimBone = (() => {
      const smoothedRotations = new Map()
      const normalizedDir = new THREE.Vector3()
      const parentWorldMatrix = new THREE.Matrix4()
      const parentWorldRotationInverse = new THREE.Quaternion()
      const localDir = new THREE.Vector3()
      const currentAimDir = new THREE.Vector3()
      const rot = new THREE.Quaternion()
      const worldUp = new THREE.Vector3()
      const localUp = new THREE.Vector3()
      const rotatedUp = new THREE.Vector3()
      const projectedUp = new THREE.Vector3()
      const upCorrection = new THREE.Quaternion()
      const cross = new THREE.Vector3()
      const targetRotation = new THREE.Quaternion()
      const restToTarget = new THREE.Quaternion()

      return function aimBone(boneName, targetDir, delta, options = {}) {
        // default options
        const {
          aimAxis = AimAxis.NEG_Z,
          upAxis = UpAxis.Y,
          smoothing = 0.7, // smoothing factor (0-1)
          weight = 1.0,
          maintainOffset = false,
          minAngle = -180,
          maxAngle = 180,
        } = options
        const bone = findBone(boneName)
        const parentBone = glb.userData.vrm.humanoid.humanBones[boneName].node.parent
        if (!bone) return console.warn(`aimBone: missing bone (${boneName})`)
        if (!parentBone) return console.warn(`aimBone: no parent bone`)
        // get or create smoothed state for this bone
        const boneId = bone.uuid
        if (!smoothedRotations.has(boneId)) {
          smoothedRotations.set(boneId, {
            current: bone.quaternion.clone(),
            target: new THREE.Quaternion(),
          })
        }
        const smoothState = smoothedRotations.get(boneId)
        // normalize target direction
        normalizedDir.copy(targetDir).normalize()
        // get parent's world matrix
        parentWorldMatrix.multiplyMatrices(vrm.scene.matrixWorld, parentBone.matrixWorld)
        // extract parent's world rotation
        parentWorldMatrix.decompose(v1, parentWorldRotationInverse, v2)
        parentWorldRotationInverse.invert()
        // convert world direction to parent's local space
        localDir.copy(normalizedDir).applyQuaternion(parentWorldRotationInverse)
        // store initial offset if needed
        if (maintainOffset && !bone.userData.initialRotationOffset) {
          bone.userData.initialRotationOffset = bone.quaternion.clone()
        }
        // calc rotation needed to align aimAxis with localDir
        currentAimDir.copy(aimAxis)
        if (maintainOffset && bone.userData.initialRotationOffset) {
          currentAimDir.applyQuaternion(bone.userData.initialRotationOffset)
        }
        // create rotation
        rot.setFromUnitVectors(aimAxis, localDir)
        // get up direction in parent's local space
        worldUp.copy(upAxis)
        localUp.copy(worldUp).applyQuaternion(parentWorldRotationInverse)
        // apply up axis correction
        rotatedUp.copy(upAxis).applyQuaternion(rot)
        projectedUp.copy(localUp)
        projectedUp.sub(v1.copy(localDir).multiplyScalar(localDir.dot(localUp)))
        projectedUp.normalize()
        if (projectedUp.lengthSq() > 0.001) {
          upCorrection.setFromUnitVectors(rotatedUp, projectedUp)
          const angle = rotatedUp.angleTo(projectedUp)
          cross.crossVectors(rotatedUp, projectedUp)
          if (cross.dot(localDir) < 0) {
            upCorrection.setFromAxisAngle(localDir, -angle)
          } else {
            upCorrection.setFromAxisAngle(localDir, angle)
          }
          rot.premultiply(upCorrection)
        }
        // apply initial offset if maintaining it
        targetRotation.copy(rot)
        if (maintainOffset && bone.userData.initialRotationOffset) {
          targetRotation.multiply(bone.userData.initialRotationOffset)
        }
        // apply angle limits
        if (minAngle > -180 || maxAngle < 180) {
          if (!bone.userData.restRotation) {
            bone.userData.restRotation = bone.quaternion.clone()
          }
          restToTarget.copy(bone.userData.restRotation).invert().multiply(targetRotation)
          const w = restToTarget.w
          const angle = 2 * Math.acos(Math.min(Math.max(w, -1), 1))
          const angleDeg = THREE.MathUtils.radToDeg(angle)
          if (angleDeg > maxAngle || angleDeg < minAngle) {
            const clampedAngleDeg = THREE.MathUtils.clamp(angleDeg, minAngle, maxAngle)
            const clampedAngleRad = THREE.MathUtils.degToRad(clampedAngleDeg)
            const scale = clampedAngleRad / angle
            q1.copy(targetRotation)
            targetRotation.slerpQuaternions(bone.userData.restRotation, q1, scale)
          }
        }
        // apply weight
        if (weight < 1.0) {
          targetRotation.slerp(bone.quaternion, 1.0 - weight)
        }
        // update smooth state target
        smoothState.target.copy(targetRotation)
        // smoothly interpolate from current to target
        smoothState.current.slerp(smoothState.target, smoothing)
        // apply smoothed rotation to bone
        bone.quaternion.copy(smoothState.current)
        bone.updateMatrixWorld(true)
      }
    })()

    // position target equivalent of aimBone()
    const aimBoneDir = new THREE.Vector3()
    function aimBoneAt(boneName, targetPos, delta, options = {}) {
      const bone = findBone(boneName)
      if (!bone) return console.warn(`aimBone: missing bone (${boneName})`)
      const boneWorldMatrix = getBoneTransform(boneName)
      const boneWorldPos = v1.setFromMatrixPosition(boneWorldMatrix)
      aimBoneDir.subVectors(targetPos, boneWorldPos).normalize()
      aimBone(boneName, aimBoneDir, delta, options)
    }

    // hooks.loader.load('emote', 'asset://rifle-aim.glb').then(emo => {
    //   const clip = emo.toClip({
    //     rootToHips,
    //     version,
    //     getBoneName,
    //   })
    //   // THREE.AnimationUtils.makeClipAdditive(clip, 0, clipI)
    //   // clip.blendMode = THREE.AdditiveAnimationBlendMode
    //   const action = mixer.clipAction(clip)
    //   action.setLoop(THREE.LoopRepeat)
    //   action.setEffectiveWeight(6)
    //   action.reset().fadeIn(0.1).play()
    //   console.log('hi2')
    // })

    const poses = {}
    
    function addPose(key, url, upperBodyOnly = false, clipOptions = {}) {
      const opts = getQueryParams(url)
      const speed = parseFloat(opts.s || 1)
      const fullBodyCombat = clipOptions.fullBodyCombat === true
      const pose = {
        loading: true,
        active: false,
        action: null,
        weight: 0,
        target: 0,
        upperBodyOnly,
        fullBodyCombat,
        setWeight: value => {
          if (pose.fadingOut) {
            // A canceled combat pose is being faded out by the mixer —
            // setEffectiveWeight would cancel that fade, so leave it alone
            // until it completes (the fade disables the action at weight 0).
            if (pose.action && pose.action.enabled && pose.action.getEffectiveWeight() > 0.001) {
              return
            }
            pose.fadingOut = false
            pose.action?.stop()
          }
          pose.weight = value
          if (pose.action) {
            // Attacks get much higher effective weight to override locomotion
            const effectiveWeight = upperBodyOnly || fullBodyCombat ? value * 5.0 : value
            pose.action.weight = value
            pose.action.setEffectiveWeight(effectiveWeight)
            // Auto-start only while the pose is being driven IN (target > 0).
            // A canceled pose fades out with weight > 0 and active = false —
            // restarting it here would replay the clip from frame 0.
            if (!pose.active && value > 0 && pose.target > 0) {
              if (upperBodyOnly) {
                // For attacks, reset and play immediately
                pose.action.reset().play()
              } else {
                pose.action.reset().fadeIn(0.15).play()
              }
              pose.active = true
            }
            // Enable the action
            if (value > 0 && pose.target > 0 && !pose.action.isRunning()) {
              pose.action.play()
            }
          }
        },
        fadeOut: () => {
          pose.weight = 0
          pose.action?.fadeOut(0.15)
          pose.active = false
        },
      }
      hooks.loader.load('emote', url).then(emo => {
        const clip = emo.toClip({
          rootToHips,
          version,
          getBoneName,
          inPlace: clipOptions.inPlace ?? upperBodyOnly,
          ...clipOptions,
        })
        
        // Combat: no horizontal root slide; hips Y is scaled to this avatar's height in toClip().
        
        pose.action = mixer.clipAction(clip)
        pose.action.timeScale = speed
        pose.action.weight = pose.weight
        
        // Configure attack animations to play once
        if (upperBodyOnly || fullBodyCombat) {
          pose.action.clampWhenFinished = true
          pose.action.setLoop(THREE.LoopOnce, 1)
          console.log('[VRM] Attack animation loaded for:', key, 'with FULL animation -', clip.tracks.length, 'tracks')
        } else if (key === 'deathFall' || key === 'getup') {
          // Death fall and getup animations should clamp at end
          pose.action.clampWhenFinished = true
          pose.action.setLoop(THREE.LoopOnce, 1)
          console.log('[VRM] Death animation loaded for:', key, 'with FULL body (clamped) -', clip.tracks.length, 'tracks')
        } else if (key === 'dead') {
          // Dead animation should loop
          pose.action.clampWhenFinished = false
          pose.action.setLoop(THREE.LoopRepeat)
          console.log('[VRM] Dead animation loaded for:', key, 'with FULL body (looping) -', clip.tracks.length, 'tracks')
        } else {
          console.log('[VRM] Locomotion animation loaded for:', key, 'with FULL body -', clip.tracks.length, 'tracks')
        }
        
        pose.action.play()
        pose.loading = false
      })
      poses[key] = pose
    }
    // Locomotion animations - full body (arms swing, head moves naturally)
    addPose('idle', Emotes.IDLE)
    addPose('walk', Emotes.WALK)
    addPose('walkLeft', Emotes.WALK_LEFT)
    addPose('walkBack', Emotes.WALK_BACK)
    addPose('walkRight', Emotes.WALK_RIGHT)
    addPose('run', Emotes.RUN)
    addPose('runLeft', Emotes.RUN_LEFT)
    addPose('runBack', Emotes.RUN_BACK)
    addPose('runRight', Emotes.RUN_RIGHT)
    addPose('jump', Emotes.JUMP)
    addPose('fall', Emotes.FALL)
    addPose('fly', Emotes.FLY)
    addPose('talk', Emotes.TALK)
    // Attack animations - full body, higher weight to override locomotion
    addPose('attackLeft', Emotes.ATTACK_LEFT, true)
    addPose('attackRight', Emotes.ATTACK_RIGHT, true)
    addPose('attackHigh', Emotes.ATTACK_HIGH, true)
    addPose('attackLow', Emotes.ATTACK_LOW, true, {
      handRotationOffset: CombatHandOffsets.attackLow,
    })
    addPose('block', Emotes.BLOCK, true)
    addPose('blockLeft', Emotes.BLOCK_LEFT, true)
    addPose('blockRight', Emotes.BLOCK_RIGHT, true)
    addPose('blockHigh', Emotes.BLOCK_HIGH, true)
    addPose('blockLow', Emotes.BLOCK_LOW, true)
    addPose('kick', Emotes.KICK, false, {
      inPlace: true,
      fullBodyCombat: true,
      trimStart: KickTiming.trimStart,
    })
    addPose('deathFall', Emotes.DEATH_FALL, false) // Full body animation
    addPose('dead', Emotes.DEAD, false) // Full body looping animation
    addPose('getup', Emotes.GETUP, false) // Full body animation
    
    function clearLocomotion() {
      for (const key in poses) {
        // Clear locomotion poses (not attacks)
        if (!poses[key].upperBodyOnly) {
          poses[key].fadeOut()
        }
      }
    }
    function updateLocomotion(delta) {
      const { mode, axis } = loco
      
      // Clear locomotion pose targets (keep attacks separate)
      for (const key in poses) {
        if (!poses[key].upperBodyOnly) {
          poses[key].target = 0
        }
      }
      
      // Handle attacks independently — end when the clip finishes, not on a wall clock
      syncCurrentAttack()
      
      // Update locomotion (legs only)
      // If in death state, use dead animation as locomotion
      const fullBodyAttackActive =
        currentAttack && poses[currentAttack]?.fullBodyCombat && !isCombatActionFinished(poses[currentAttack]?.action, currentAttack)
      if (fullBodyAttackActive) {
        // Full-body combat (kick) replaces locomotion entirely
      } else if (isInDeathState) {
        poses.dead.target = 1
      } else if (mode === Modes.IDLE) {
        poses.idle.target = 1
      } else if (mode === Modes.WALK || mode === Modes.RUN) {
        const angle = Math.atan2(axis.x, -axis.z)
        const angleDeg = ((angle * 180) / Math.PI + 360) % 360
        const prefix = mode === Modes.RUN ? 'run' : 'walk'
        const forwardKey = prefix // This should be "walk" or "run"
        const leftKey = `${prefix}Left`
        const backKey = `${prefix}Back`
        const rightKey = `${prefix}Right`
        if (axis.length() > 0.01) {
          if (angleDeg >= 337.5 || angleDeg < 22.5) {
            // Pure forward
            poses[forwardKey].target = 1
          } else if (angleDeg >= 22.5 && angleDeg < 67.5) {
            // Forward-right blend
            const blend = (angleDeg - 22.5) / 45
            poses[forwardKey].target = 1 - blend
            poses[rightKey].target = blend
          } else if (angleDeg >= 67.5 && angleDeg < 112.5) {
            // Pure right
            poses[rightKey].target = 1
          } else if (angleDeg >= 112.5 && angleDeg < 157.5) {
            // Right-back blend
            const blend = (angleDeg - 112.5) / 45
            poses[rightKey].target = 1 - blend
            poses[backKey].target = blend
          } else if (angleDeg >= 157.5 && angleDeg < 202.5) {
            // Pure back
            poses[backKey].target = 1
          } else if (angleDeg >= 202.5 && angleDeg < 247.5) {
            // Back-left blend
            const blend = (angleDeg - 202.5) / 45
            poses[backKey].target = 1 - blend
            poses[leftKey].target = blend
          } else if (angleDeg >= 247.5 && angleDeg < 292.5) {
            // Pure left
            poses[leftKey].target = 1
          } else if (angleDeg >= 292.5 && angleDeg < 337.5) {
            // Left-forward blend
            const blend = (angleDeg - 292.5) / 45
            poses[leftKey].target = 1 - blend
            poses[forwardKey].target = blend
          }
        }
      } else if (mode === Modes.JUMP) {
        poses.jump.target = 1
      } else if (mode === Modes.FALL) {
        poses.fall.target = 1
      } else if (mode === Modes.FLY) {
        poses.fly.target = 1
      } else if (mode === Modes.TALK) {
        poses.talk.target = 1
      }
      
      // Update all pose weights (both locomotion and attacks)
      const lerpSpeed = 16
      for (const key in poses) {
        const pose = poses[key]
        const weight = THREE.MathUtils.lerp(pose.weight, pose.target, 1 - Math.exp(-lerpSpeed * delta))
        pose.setWeight(weight)
      }
    }

    // console.log('=== vrm ===')
    // console.log('vrm', vrm)
    // console.log('skeleton', skeleton)

    let firstPersonActive = false
    const setFirstPerson = active => {
      if (firstPersonActive === active) return
      const head = findBone('neck')
      head.scale.setScalar(active ? 0 : 1)
      firstPersonActive = active
    }

    // Per-instance materials (lazily cloned) so tint/flash affect only THIS
    // avatar — instances from cloneGLB share materials by default.
    const TEST_TINT = new THREE.Color(0x4488ff)
    let ownMaterials = null
    const ensureOwnMaterials = () => {
      if (ownMaterials) return ownMaterials
      ownMaterials = []
      vrm.scene.traverse(obj => {
        if (obj.isMesh && obj.material) {
          const isArray = Array.isArray(obj.material)
          const source = isArray ? obj.material : [obj.material]
          const clones = source.map(m => {
            const c = m.clone()
            c.shadowSide = THREE.BackSide
            setupMaterial(c)
            return c
          })
          obj.material = isArray ? clones : clones[0]
          for (const c of clones) {
            ownMaterials.push({
              mat: c,
              baseColor: c.color ? c.color.clone() : null,
              baseEmissive: c.emissive ? c.emissive.clone() : null,
              baseEmissiveIntensity: c.emissiveIntensity ?? 1,
            })
          }
        }
      })
      return ownMaterials
    }

    let tintActive = false
    const applyTint = () => {
      for (const t of ownMaterials) {
        if (!t.baseColor) continue
        if (tintActive) {
          t.mat.color.copy(t.baseColor).lerp(TEST_TINT, 0.45)
        } else {
          t.mat.color.copy(t.baseColor)
        }
      }
    }

    const setTint = active => {
      if (tintActive === !!active && !ownMaterials) return
      tintActive = !!active
      ensureOwnMaterials()
      applyTint()
    }

    // Hit flash — brief emissive override (receiver hit confirm, 2-4 frames)
    let flashTimeout = null
    const flash = (color = 0xff3020, durationMs = 90) => {
      const mats = ensureOwnMaterials()
      for (const t of mats) {
        if (t.mat.emissive) {
          t.mat.emissive.setHex(color)
          t.mat.emissiveIntensity = 1.4
        } else if (t.mat.color) {
          t.mat.color.setHex(color)
        }
      }
      if (flashTimeout) clearTimeout(flashTimeout)
      flashTimeout = setTimeout(() => {
        flashTimeout = null
        for (const t of mats) {
          if (t.mat.emissive && t.baseEmissive) {
            t.mat.emissive.copy(t.baseEmissive)
            t.mat.emissiveIntensity = t.baseEmissiveIntensity
          }
        }
        applyTint() // restore correct base/tinted colors
      }, durationMs)
    }

    /** Snap a live avatar to the final on-ground dead pose before freezing as a corpse. */
    const snapCorpsePose = () => {
      mixer.timeScale = 1
      currentEmote = null
      currentAttack = null
      isInDeathState = true

      if (poses.deathFall?.action) {
        const clip = poses.deathFall.action.getClip()
        if (clip?.duration) {
          poses.deathFall.action.time = clip.duration
        }
        poses.deathFall.target = 0
        poses.deathFall.setWeight(0)
      }
      if (poses.getup) {
        poses.getup.target = 0
        poses.getup.setWeight(0)
      }

      for (const key in poses) {
        if (poses[key].upperBodyOnly) {
          poses[key].target = 0
          poses[key].setWeight(0)
        }
      }

      poses.dead.target = 1
      poses.dead.weight = 1
      if (poses.dead.action) {
        poses.dead.action.reset()
        poses.dead.action.play()
        poses.dead.setWeight(1)
      }

      mixer.update(0.001)
    }

    return {
      raw: vrm,
      mixer, // Expose mixer for direct animation control
      height,
      headToHeight,
      setEmote,
      setDeathState,
      snapCorpsePose,
      setFirstPerson,
      setTint,
      flash,
      update,
      updateRate,
      getBoneTransform,
      setLocomotion,
      setVisible(visible) {
        vrm.scene.traverse(o => {
          o.visible = visible
        })
      },
      move(_matrix) {
        matrix.copy(_matrix)
        hooks.octree?.move(sItem)
      },
      disableRateCheck() {
        rateCheck = false
      },
      destroy() {
        if (flashTimeout) clearTimeout(flashTimeout)
        hooks.scene.remove(vrm.scene)
        // world.updater.remove(update)
        hooks.octree?.remove(sItem)
      },
    }
  }
}

function cloneGLB(glb) {
  // returns a shallow clone of the gltf but a deep clone of the scene.
  // uses SkeletonUtils.clone which is the same as Object3D.clone except also clones skinned meshes etc
  return { ...glb, scene: SkeletonUtils.clone(glb.scene) }
}

function getSkinnedMeshes(scene) {
  let meshes = []
  scene.traverse(o => {
    if (o.isSkinnedMesh) {
      meshes.push(o)
    }
  })
  return meshes
}

function createCapsule(radius, height) {
  const fullHeight = radius + height + radius
  const geometry = new THREE.CapsuleGeometry(radius, height)
  geometry.translate(0, fullHeight / 2, 0)
  return geometry
}

let queryParams = {}
function getQueryParams(url) {
  if (!queryParams[url]) {
    url = new URL(url)
    const params = {}
    for (const [key, value] of url.searchParams.entries()) {
      params[key] = value
    }
    queryParams[url] = params
  }
  return queryParams[url]
}

