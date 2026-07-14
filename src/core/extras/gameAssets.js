import { AVATAR_CRUSADER, AVATAR_SARACEN } from './playerAvatars'
import { ARENA_SRC, loadArenaEnvironment } from './arenaEnvironment'
import { ARENA_FIRE_SRC } from './arenaFireFx.js'
import { ARENA_GENERAL_SRC } from './arenaGeneral.js'
import { clearPrefetch } from './assetPrefetch'
import { BLOOD_SPLATTER_SRC } from './bloodEffects'
import { emoteUrls } from './playerEmotes'

export const SWORD_SRC = 'asset://sword.glb'

export function queueClientGamePreloads(world, data) {
  const loader = world.loader

  // Arena GLB is loaded first in prepareClientGameAssets — omit it here so it
  // is not raced against every other large download.
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
  // Load the large arena model alone first — concurrent fetches of this + VRMs
  // on a Heroku dyno often fail with net::ERR_FAILED and leave an empty desert.
  // Progress: 0–55% is the arena (previously silent, so the bar looked stuck
  // until the video finished); 55–100% is the remaining preload queue.
  const emitProgress = pct => world.emit('progress', pct)
  emitProgress(3)

  let lastErr = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) {
        // Bypass HTTP cache — retries after a dropped download often get stuck on
        // net::ERR_FAILED 304 (Not Modified) until a full page refresh.
        clearPrefetch(ARENA_SRC)
        world.loader.bust(ARENA_SRC)
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
      clearPrefetch(ARENA_SRC)
      world.loader.bust(ARENA_SRC)
      console.warn(`[gameAssets] arena setup attempt ${attempt}/3 failed:`, err.message || err)
    }
  }
  if (lastErr) {
    throw new Error(
      `Arena failed to load. Check your connection and try again. (${lastErr.message || lastErr})`
    )
  }

  queueClientGamePreloads(world, data)
  await world.loader.execPreload({ progressStart: 55, progressEnd: 100 })
}
