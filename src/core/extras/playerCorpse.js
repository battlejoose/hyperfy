import { createNode } from './createNode'
import { Emotes } from './playerEmotes'
import { AVATAR_CRUSADER } from './playerAvatars'

const MAX_CORPSES = 50
const corpses = []

function reparentWithoutDeactivate(node, newParent) {
  if (node.parent) {
    const idx = node.parent.children.indexOf(node)
    if (idx !== -1) node.parent.children.splice(idx, 1)
    node.parent = null
  }
  node.parent = newParent
  newParent.children.push(node)
  node.setTransformed()
}

function freezeCorpseAvatar(world, avatar) {
  if (!avatar?.instance) return
  avatar.visible = true
  const { instance } = avatar
  instance.mixer.update(0)
  instance.mixer.timeScale = 0
  world.avatars?.remove(instance)
}

function trimCorpses(world) {
  while (corpses.length > MAX_CORPSES) {
    corpses.shift()?.deactivate()
  }
}

function applyDeadPose(avatar) {
  const setPose = () => {
    if (avatar.instance?.snapCorpsePose) {
      avatar.instance.snapCorpsePose()
      return true
    }
    if (avatar.instance?.setDeathState) {
      avatar.instance.setDeathState(true)
      avatar.instance.setEmote(Emotes.DEAD)
      avatar.instance.mixer?.update(0.001)
      return true
    }
    requestAnimationFrame(setPose)
    return false
  }
  setPose()
}

function settleCorpseAvatar(world, avatar) {
  if (avatar?.instance?.isCorpsePoseReady?.()) {
    // Observer path: remote was already lying dead — don't reset the pose
    requestAnimationFrame(() => freezeCorpseAvatar(world, avatar))
    return
  }

  applyDeadPose(avatar)
  // One frame lets pose weights settle before the mixer is frozen
  requestAnimationFrame(() => {
    avatar?.instance?.mixer?.update(0.05)
    requestAnimationFrame(() => freezeCorpseAvatar(world, avatar))
  })
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
      settleCorpseAvatar(world, avatar)
    })
    .catch(err => console.error('[Corpse] failed to load avatar:', err))
}

export function spawnCorpse(world, { position, quaternion, sessionAvatar, avatar }) {
  if (!world.stage) return

  const group = createNode('group')
  group.position.fromArray(position)
  group.quaternion.fromArray(quaternion)
  group.activate({ world })

  if (avatar) {
    reparentWithoutDeactivate(avatar, group)
    group.setDirty()
    world.stage.clean()
    settleCorpseAvatar(world, avatar)
  } else {
    loadCorpseAvatar(world, group, sessionAvatar)
  }

  corpses.push(group)
  trimCorpses(world)
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
