import { createNode } from './createNode'
import { Emotes } from './playerEmotes'
import { AVATAR_CRUSADER } from './playerAvatars'

const MAX_CORPSES = 50
const corpses = []

export function spawnCorpse(world, { position, quaternion, sessionAvatar }) {
  if (!world.loader || !world.isClient) return

  const group = createNode('group')
  group.position.fromArray(position)
  group.quaternion.fromArray(quaternion)

  const avatarUrl = sessionAvatar || AVATAR_CRUSADER
  world.loader.load('avatar', avatarUrl).then(src => {
    const avatar = src.toNodes().get('avatar')
    group.add(avatar)
    group.activate({ world })
    group.setDirty()
    world.stage?.clean()

    const applyDeadPose = () => {
      if (avatar.instance?.setDeathState) {
        avatar.instance.setDeathState(true)
        avatar.instance.setEmote(Emotes.DEAD)
        return
      }
      requestAnimationFrame(applyDeadPose)
    }
    applyDeadPose()
  })

  corpses.push(group)
  while (corpses.length > MAX_CORPSES) {
    corpses.shift()?.deactivate()
  }
}

export function clearCorpses() {
  while (corpses.length) {
    corpses.pop()?.deactivate()
  }
}
