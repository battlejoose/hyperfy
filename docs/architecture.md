# Hyperfy PvP Fork — Architecture Overview

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22.11.0, ES Modules |
| Server HTTP/WS | Fastify 5 + WebSocket plugin |
| Graphics | Three.js 0.173.0 |
| Physics | PhysX (WASM) |
| Audio | Spatial audio (built-in) |
| Database | PostgreSQL via Knex.js / better-sqlite3 |
| Build | ESBuild |

---

## Directory Map

```
src/
  core/         — Shared engine code (runs on both sides)
    World.js    — Central game loop and system manager
    packets.js  — Binary network protocol definitions
    systems/    — All systems (Server*, Client*, shared)
    entities/   — PlayerLocal, PlayerRemote, App
    nodes/      — Collider, RigidBody, etc.
  server/       — Server entry point, HTTP/WS setup
  client/       — Browser entry point, React UI, Three.js renderer
  node-client/  — Headless/AI agent client
docs/
scripts/
examples/
```

---

## The World Class (`src/core/World.js`)

`World` is the central engine. Both the server and client create their own `World` instance; each side registers different systems into it.

**Key constants:**

| Property | Value | Meaning |
|----------|-------|---------|
| `maxDeltaTime` | 1/30 (33ms) | Frame cap |
| `fixedDeltaTime` | 1/50 (20ms) | Fixed physics timestep (50 Hz) |
| `networkRate` | 1/8 (125ms) | Network sync rate (8 Hz) |

### Game Loop Phases (per tick)

```
preTick
  preFixedUpdate
    [fixedUpdate + postFixedUpdate]  ← repeated until caught up
  preUpdate → update → postUpdate
  lateUpdate → postLateUpdate
  commit
postTick
```

Physics runs at a fixed 50 Hz; rendering/logic runs at display frame rate. Position is alpha-lerped between the previous and next physics steps.

---

## System Architecture

All systems extend `System` and implement the same lifecycle hooks (`init`, `start`, `preTick`, `fixedUpdate`, `update`, `lateUpdate`, `destroy`, etc.).

Systems are registered with:
```js
world.register('key', SystemClass)
```

### Server-side systems

| System | Responsibility |
|--------|---------------|
| `Server` | HTTP/WS setup, asset serving |
| `ServerNetwork` | Client connections, packet routing, authoritative damage |
| `ServerLoader` | Asset loading/storage |
| `ServerEnvironment` | Sky, lighting, spawn config |
| `ServerMonitor` | Perf monitoring |
| `ServerAI` | AI agent integration |

### Client-side systems

| System | Responsibility |
|--------|---------------|
| `ClientNetwork` | WebSocket, packet send/receive |
| `ClientLoader` | Asset download, GLTF/VRM parsing, cache |
| `ClientRenderer` | Three.js scene, post-processing |
| `ClientInput` | Mouse, keyboard, gamepad |
| `ClientAudio` | Spatial audio |

### Shared systems (run on both sides)

| System | Responsibility |
|--------|---------------|
| `Entities` | Entity lifecycle (create, modify, destroy) |
| `Physics` | PhysX simulation |
| `Scripts` | Sandboxed app script execution |
| `Animation` | VRM animation playback |

---

## Entity System (`src/core/systems/Entities.js`)

Two entity types live in the world:

- **`player`** — spawned for each connected client; becomes `PlayerLocal` for the owning client or `PlayerRemote` for everyone else
- **`app`** — interactive world object with an optional script

Player data shape:
```js
{
  id, type: 'player',
  owner,        // socket.id — determines Local vs Remote
  name, health, // health: 0–100
  avatar,       // asset:// URL to VRM
  position, quaternion,
  rank,         // 0=visitor 1=builder 2=admin
  effect,       // currently playing emote/animation
}
```

---

## Physics (`src/core/systems/Physics.js`)

- **Engine:** PhysX (C++ compiled to WASM)
- **Scene gravity:** `(0, -9.81, 0)`
- **Broad phase:** GPU-accelerated
- **Fixed timestep:** 50 Hz
- **Interpolation:** alpha-lerp from previous to current fixed step each render frame
- **Contact callbacks:** `onContactStart`, `onContactEnd`, `onTriggerEnter`, `onTriggerExit`

Physics layers relevant to combat:

```
weapon  → collides with: player
player  → collides with: environment, prop, player, weapon
```

Weapon colliders are trigger-only (no push response). Player colliders are simulation shapes.

---

## App / Blueprint System

A **Blueprint** is a template (model + optional script + configurable props). An **App** is a runtime instance of a blueprint placed in the world.

App lifecycle:
```
Load → Build → Activate → [Update Loop] → Deactivate → Destroy
```

Scripts run in a SES Compartment sandbox with no access to `eval` or globals. The API surface is: Three.js objects, Math, UUID, `fetch`, `setTimeout`, `world`, `app`, `props`.

---

## Asset System

Asset URLs use the `asset://` scheme:
```
asset://avatar.vrm      → resolved to assets server path
https://...             → passthrough
```

Assets are downloaded, parsed (GLTF/VRM), and cached by `ClientLoader`. `preload` flag causes download at world join to prevent in-game stalls.

---

## Database Schema

| Table | Contents |
|-------|---------|
| `blueprints` | Blueprint templates (JSON body) |
| `entities` | Persistent app instances |
| `config` | Server settings, spawn point |
| `users` | Player accounts |
| `chat` | Message history |

World state auto-saves every `SAVE_INTERVAL` seconds using upsert (`onConflict().merge()`).
