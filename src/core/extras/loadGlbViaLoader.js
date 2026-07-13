/**
 * Load a GLB through ClientLoader's file cache + shared GLTFLoader.
 * Prefer this over raw fetch so arena FX / props don't re-download assets
 * that the loader already has (or will preload).
 */
export async function loadGlbViaLoader(world, src) {
  const url = world.resolveURL(src)
  if (url.startsWith('asset://')) {
    throw new Error(`url not resolved: ${src}`)
  }
  const file = await world.loader.loadFile(src)
  const buffer = await file.arrayBuffer()
  return world.loader.gltfLoader.parseAsync(buffer)
}
