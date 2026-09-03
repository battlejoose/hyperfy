# Colosseum generator

`src/world/assets/colosseum-v1.glb` is built entirely from code in this folder.
No third-party assets are involved: geometry is generated with three.js
primitives, textures are seeded procedural noise, and the file is written by a
small glTF 2.0 writer.

```bash
node scripts/colosseum/build.mjs                 # -> src/world/assets/colosseum-v1.glb
node scripts/colosseum/preview-textures.mjs out  # dump the textures as PNG
node scripts/verify-arena-glb.mjs                # parse with the server's loader
```

If `sharp` is installed the textures are encoded as WebP (smaller file);
otherwise they fall back to PNG. Both are supported by the game.

## Files

| File | Purpose |
| --- | --- |
| `build.mjs` | Layout constants + assembly of every part of the arena |
| `geo.mjs` | Geometry helpers: sweeps (lathes with hard edges), bent wall modules, arches, columns, statues, eagles |
| `textures.mjs` | Tileable sandstone, ashlar masonry, travertine marble, cloth, wood, and the eagle banner |
| `noise.mjs` | Seeded, tileable gradient / cellular noise |
| `image.mjs` | PNG encoder (zero deps) with optional WebP via `sharp` |
| `glb.mjs` | Minimal `.glb` writer (materials, embedded textures, node instancing, hyperfy `extras`) |

## Gameplay contract

The layout mirrors constants in `src/core/extras`; change both sides together.

| Constant | Value | Used by |
| --- | --- | --- |
| Podium wall / arena radius | 12.2 m | `ARENA_RING_WALL_RADIUS` (invisible wall around the sand) |
| Walkway outer edge | 17.0 m | `ARENA_OUTER_RING_WALL_RADIUS` (keeps spectators on the walkway) |
| Crowd rows | r = 13.7 + 0.5k, y = 3.0 + 0.45k | `CROWD_RINGS` in `arenaCrowd.js` |
| Royal box floor | y = 3.2 | `GENERAL_Y_OFFSET` in `arenaGeneral.js` |
| Brazier nodes | `barrizer`, `barrizer_2` | `BARRIZER_IDS` in `arenaFireFx.js` — fire FX spawns on each, Proximo stands at their midpoint |
| Ground meshes | names contain `ground` | `glbToNodes` swaps in the desert sand shader |
| Colliders | nodes with `extras.node = collider` under a static `rigidbody` | PhysX uses these instead of cooking the visual meshes |

The royal box is centered at gameplay angle -64 degrees; the main gate sits
opposite at 116 degrees. Angles use `atan2(z, x)` like the crowd code.

## Rendering notes

- Repeated parts (arch bays, columns, seats, sail panels, statues) are one
  mesh referenced by many nodes, so hyperfy's stage batches them into
  instanced draws. ~270k triangles on screen, ~70k unique.
- Materials are plain PBR: sandstone and masonry carry normal maps, cloth is
  double-sided, gold/bronze/iron are metallic factors only.
- Everything below the sand is avoided on purpose: `loadArenaEnvironment`
  re-centers the model so its lowest vertex sits at y = 0.
