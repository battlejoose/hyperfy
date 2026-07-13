import { AVATAR_CRUSADER, AVATAR_SARACEN } from './playerAvatars'
import { ARENA_SRC } from './arenaEnvironment'
import { BLOOD_SPLATTER_SRC } from './bloodEffects'

const SWORD_SRC = 'asset://sword.glb'

const prefetchCache = new Map()

export function assetUrlToPath(url) {
  const bare = url.split('?')[0]
  if (bare.startsWith('asset://')) return bare.replace('asset:/', '/assets')
  if (bare.startsWith('/')) return bare
  return bare
}

export function prefetchAsset(url) {
  const path = assetUrlToPath(url)
  if (prefetchCache.has(path)) return prefetchCache.get(path)

  const promise = fetch(path)
    .then(resp => {
      if (!resp.ok) throw new Error(`prefetch failed: ${path} (${resp.status})`)
      return resp.blob()
    })
    .catch(err => {
      prefetchCache.delete(path)
      console.warn('[prefetch]', path, err.message || err)
      throw err
    })

  prefetchCache.set(path, promise)
  return promise
}

/**
 * Warm the browser cache before entering the arena.
 * Title screen must stay LIGHT — prefetching the arena + VRMs while the
 * Proximo video plays saturates Heroku and causes net::ERR_FAILED, so the arena
 * never loads.
 */
export function prefetchGameAssets({ avatar, light = false } = {}) {
  const urls = light
    ? [SWORD_SRC, BLOOD_SPLATTER_SRC]
    : [ARENA_SRC, SWORD_SRC, AVATAR_CRUSADER, AVATAR_SARACEN, BLOOD_SPLATTER_SRC]
  if (!light && avatar && !urls.includes(avatar)) urls.push(avatar)
  return Promise.allSettled(urls.map(prefetchAsset))
}

export async function getPrefetchedBlob(resolvedUrl) {
  const path = resolvedUrl.split('?')[0]
  const pending = prefetchCache.get(path)
  if (!pending) return null
  try {
    return await pending
  } catch {
    prefetchCache.delete(path)
    return null
  }
}
