import { AVATAR_CRUSADER, AVATAR_SARACEN } from './playerAvatars'
import { ARENA_SRC, loadArenaEnvironment } from './arenaEnvironment'
import { ARENA_FIRE_SRC } from './arenaFireFx.js'
import { ARENA_GENERAL_SRC } from './arenaGeneral.js'
import { BLOOD_SPLATTER_SRC } from './bloodEffects'
import { emoteUrls } from './playerEmotes'

export const SWORD_SRC = 'asset://sword.glb'

export function queueClientGamePreloads(world, data) {
  const loader = world.loader

  loader.preload('model', ARENA_SRC)
  loader.preload('model', ARENA_FIRE_SRC)
  loader.preload('model', ARENA_GENERAL_SRC)
  loader.preload('model', SWORD_SRC)
  loader.preload('avatar', AVATAR_CRUSADER)
  loader.preload('avatar', AVATAR_SARACEN)
  loader.preload('texture', BLOOD_SPLATTER_SRC)

  for (const url of emoteUrls) {
    loader.preload('emote', url)
  }

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
  queueClientGamePreloads(world, data)
  const preload = world.loader.execPreload()

  let arenaSetup = Promise.resolve()
  try {
    await world.loader.waitFor('model', ARENA_SRC)
    arenaSetup = loadArenaEnvironment(world)
  } catch (err) {
    console.warn('[gameAssets] arena setup failed:', err)
  }

  await Promise.all([preload, arenaSetup])
}
