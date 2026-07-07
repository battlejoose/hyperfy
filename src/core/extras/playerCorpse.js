import * as THREE from 'three'
import { createNode } from './createNode'
import { AVATAR_CRUSADER } from './playerAvatars'

const MAX_CORPSES = 50
const corpses = []

const _v1 = new THREE.Vector3()
const _q1 = new THREE.Quaternion()
const _s1 = new THREE.Vector3()

function ensureTransformsFresh(world, ...nodes) {
  for (const node of nodes) {
    if (!node) continue
    let n = node
    while (n) {
      if (n.isDirty) n.setDirty()
      n = n.parent
    }
  }
  world.stage?.clean()
}

/** Reparent while keeping the node's world transform — group absorbs world pose, child goes local identity. */
function reparentPreserveWorld(node, newParent) {
  node.matrixWorld.decompose(_v1, _q1, _s1)

  if (node.parent) {
    const idx = node.parent.children.indexOf(node)
    if (idx !== -1) node.parent.children.splice(idx, 1)
    node.parent = null
  }

  newParent.position.copy(_v1)
  newParent.quaternion.copy(_q1)
  newParent.scale.copy(_s1)
  newParent.setTransformed()

  node.parent = newParent
  newParent.children.push(node)

  node.position.set(0, 0, 0)
  node.quaternion.set(0, 0, 0, 1)
  node.scale.set(1, 1, 1)
  node.setTransformed()
}

function syncCorpseAvatarMatrix(avatar) {
  avatar.instance?.move(avatar.matrixWorld)
}

function freezeCorpseAvatar(world, avatar, { skipMixerUpdate = false } = {}) {
  if (!avatar?.instance) return
  avatar.visible = true
  const { instance } = avatar
  if (!skipMixerUpdate) {
    instance.mixer.update(0)
  }
  instance.mixer.timeScale = 0
  world.avatars?.remove(instance)
}

function trimCorpses(world) {
  while (corpses.length > MAX_CORPSES) {
    corpses.shift()?.deactivate()
  }
}

/** Joiner corpses: orient the group first, then step the fall clip like a live client. */
function settleCorpseAvatar(world, group, avatar) {
  const trySettle = () => {
    const instance = avatar?.instance
    if (!instance) {
      requestAnimationFrame(trySettle)
      return
    }

    world.avatars?.remove(instance)
    syncCorpseAvatarMatrix(avatar)

    if (!instance.playReplayDeathFall?.()) {
      requestAnimationFrame(trySettle)
      return
    }

    syncCorpseAvatarMatrix(avatar)
    requestAnimationFrame(() => freezeCorpseAvatar(world, avatar))
  }

  trySettle()
}

function loadCorpseAvatar(world, group, sessionAvatar) {
  if (!world.loader) return

  const avatarUrl = sessionAvatar || AVATAR_CRUSADER
  world.loader
    .load('avatar', avatarUrl)
    .then(src => {
      const avatar = src.toNodes().get('avatar')
      group.add(avatar)
      group.setDirty()
      world.stage?.clean()
      settleCorpseAvatar(world, group, avatar)
    })
    .catch(err => console.error('[Corpse] failed to load avatar:', err))
}

/** Steal a live avatar in-place — preserve world transform and current pose exactly. */
function spawnLiveCorpse(world, group, avatar) {
  ensureTransformsFresh(world, avatar)
  group.activate({ world })
  reparentPreserveWorld(avatar, group)
  group.setDirty()
  ensureTransformsFresh(world, group)
  syncCorpseAvatarMatrix(avatar)
  freezeCorpseAvatar(world, avatar, { skipMixerUpdate: true })
}

export function spawnCorpse(world, { position, quaternion, sessionAvatar, avatar }) {
  if (!world.stage) return null

  const group = createNode('group')

  if (avatar) {
    spawnLiveCorpse(world, group, avatar)
  } else {
    group.position.fromArray(position)
    group.quaternion.fromArray(quaternion)
    group.activate({ world })
    loadCorpseAvatar(world, group, sessionAvatar)
  }

  corpses.push(group)
  trimCorpses(world)
  return group
}

export function replayCorpses(world, corpseList) {
  if (!Array.isArray(corpseList)) return
  for (const corpse of corpseList) {
    spawnCorpse(world, {
      position: corpse.p,
      quaternion: corpse.q,
      sessionAvatar: corpse.sessionAvatar,
    })
  }
}

export function clearCorpses() {
  while (corpses.length) {
    corpses.pop()?.deactivate()
  }
}
