import { AVATAR_CRUSADER } from './playerAvatars'
import { ARENA_SRC, loadArenaEnvironment } from './arenaEnvironment'
import { BLOOD_SPLATTER_SRC } from './bloodEffects'
import { criticalEmoteUrls, lazyEmoteUrls } from './playerEmotes'

export const SWORD_SRC = 'asset://sword.glb'

function getLocalPlayerAvatarUrl(data) {
  const local = data.entities?.find(item => item.id === data.id)
  return local?.sessionAvatar || local?.avatar || data.settings?.avatar?.url || AVATAR_CRUSADER
}

/**
 * Assets needed before the loading screen ends (move / fight).
 * Arena, fire, general, and crowd are already loaded in prepareClientGameAssets.
 */
export function queueCriticalClientGamePreloads(world, data) {
  const loader = world.loader
  const avatarUrl = getLocalPlayerAvatarUrl(data)

  loader.preload('model', SWORD_SRC)
  loader.preload('avatar', avatarUrl)

  for (const url of criticalEmoteUrls) {
    loader.preload('emote', url)
  }
}

/**
 * Secondary assets — warm cache after ready without blocking entry.
 * Fire/general are already fetched during arena setup via loadGlbViaLoader.
 */
export function queueLazyClientGamePreloads(world, data) {
  const loader = world.loader
  const localAvatar = getLocalPlayerAvatarUrl(data)

  loader.preload('texture', BLOOD_SPLATTER_SRC)

  for (const url of lazyEmoteUrls) {
    loader.preload('emote', url)
  }

  if (data.settings.avatar?.url && data.settings.avatar.url !== localAvatar) {
    loader.preload('avatar', data.settings.avatar.url)
  }

  for (const item of data.blueprints || []) {
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

  for (const item of data.entities || []) {
    if (item.type !== 'player') continue
    if (item.id === data.id) continue
    const url = item.sessionAvatar || item.avatar
    if (url) loader.preload('avatar', url)
  }
}

/** @deprecated Prefer queueCriticalClientGamePreloads + queueLazyClientGamePreloads */
export function queueClientGamePreloads(world, data) {
  queueCriticalClientGamePreloads(world, data)
  queueLazyClientGamePreloads(world, data)
}

export async function prepareClientGameAssets(world, data) {
  // Load the large arena model alone first — concurrent fetches of this + VRMs
  // on a Heroku dyno often fail with net::ERR_FAILED and leave an empty desert.
  // Progress: 0–55% is the arena; 55–100% is the critical preload queue only.
  // Lazy assets (death emotes, blood, other avatars) warm in the background.
  const emitProgress = pct => world.emit('progress', pct)
  emitProgress(3)

  let lastErr = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) {
        emitProgress(5)
        await new Promise(r => setTimeout(r, 500 * attempt))
      }
      emitProgress(8)
      await world.loader.load('model', ARENA_SRC)
      emitProgress(40)
      await loadArenaEnvironment(world)
      emitProgress(55)
      lastErr = null
      break
    } catch (err) {
      lastErr = err
      console.warn(`[gameAssets] arena setup attempt ${attempt}/3 failed:`, err.message || err)
    }
  }
  if (lastErr) {
    throw new Error(
      `Arena failed to load. Check your connection and try again. (${lastErr.message || lastErr})`
    )
  }

  queueCriticalClientGamePreloads(world, data)
  await world.loader.execPreload({ progressStart: 55, progressEnd: 100 })

  queueLazyClientGamePreloads(world, data)
  world.loader.execBackgroundPreload()
}
