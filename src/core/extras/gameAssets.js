import { AVATAR_CRUSADER, AVATAR_SARACEN } from './playerAvatars'
import { ARENA_SRC, loadArenaEnvironment } from './arenaEnvironment'
import { BLOOD_SPLATTER_SRC } from './bloodEffects'
import { emoteUrls } from './playerEmotes'

export const SWORD_SRC = 'asset://sword.glb'

export function queueClientGamePreloads(world, data) {
  const loader = world.loader

  loader.preload('model', ARENA_SRC)
  loader.preload('model', SWORD_SRC)
  loader.preload('avatar', AVATAR_CRUSADER)
  loader.preload('avatar', AVATAR_SARACEN)
  loader.preload('texture', BLOOD_SPLATTER_SRC)

  for (const url of emoteUrls) {
    loader.preload('emote', url)
  }

  const base = world.environment?.base
  if (base?.model) loader.preload('model', base.model)
  if (base?.hdr) loader.preload('hdr', base.hdr)
  if (base?.bg) loader.preload('texture', base.bg)

  if (data.settings.avatar) {
    loader.preload('avatar', data.settings.avatar.url)
  }

  for (const item of data.blueprints) {
    if (item.preload && !item.disabled) {
      if (item.model) {
        const type = item.model.endsWith('.vrm') ? 'avatar' : 'model'
        loader.preload(type, item.model)
      }
      if (item.script) {
        loader.preload('script', item.script)
      }
      for (const value of Object.values(item.props || {})) {
        if (value === undefined || value === null || !value?.url || !value?.type) continue
        loader.preload(value.type, value.url)
      }
    }
  }

  for (const item of data.entities) {
    if (item.type !== 'player') continue
    const url = item.sessionAvatar || item.avatar
    if (url) loader.preload('avatar', url)
  }
}

export async function prepareClientGameAssets(world, data) {
  queueClientGamePreloads(world, data, data.id)
  await world.loader.execPreload()
  await loadArenaEnvironment(world)
}
