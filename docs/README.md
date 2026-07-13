# Hyperfy PvP Fork — Documentation

This repo is a fork of the open-source [Hyperfy](https://github.com/hyperfy-xyz/hyperfy) MMO template with **directional sword fighting PvP** added at the engine level (`PlayerLocal` / `PlayerRemote`).

Use this index before changing networking, combat, or player code.

---

## Core Architecture (read these first)

| Doc | Contents |
|-----|----------|
| [architecture.md](architecture.md) | Stack, directory map, World tick loop, systems, entities, physics layers |
| [server-client.md](server-client.md) | Authority model, WebSocket protocol, connection lifecycle, packet reference |
| [character-sync.md](character-sync.md) | Player state sync, interpolation, animation fields, avatar loading |
| [combat.md](combat.md) | Sword attacks, blocks, hit detection, damage, death/respawn, combat packets |
| [arena-rating.md](arena-rating.md) | Paid BR wallet ratings, lifetime K/D/wins, leaderboard API, Heroku Postgres |

---

## Creator / Scripting Docs

For building world apps and assets (upstream Hyperfy content):

| Doc | Contents |
|-----|----------|
| [commands.md](commands.md) | In-world slash commands |
| [scripting/README.md](scripting/README.md) | App scripting API index |
| [scripting/Networking.md](scripting/Networking.md) | App-level `app.send()` / `app.on()` events |
| [supported-files/models.md](supported-files/models.md) | Supported 3D model formats |
| [supported-files/hyp-format.md](supported-files/hyp-format.md) | `.hyp` blueprint format |

---

## Quick Reference

### Build & run

```bash
npm install
npm run dev          # builds client + server, starts dev server
```

Four runtimes share `src/core/`: server, browser client, headless node-client, offline viewer.

### Key constants

| Constant | Value | File |
|----------|-------|------|
| Network sync | 8 Hz | `src/core/World.js` |
| Physics | 50 Hz | `src/core/World.js` |
| Server tick | 30 Hz | `src/core/systems/Server.js` |
| Max health | 100 | `src/core/systems/ServerNetwork.js` |
| Sword damage | 25 | `src/core/entities/PlayerLocal.js` |

### Combat input

| Input | Action |
|-------|--------|
| Keys 1–4 | Instant attacks: left, right, high, low |
| Key 5 | Generic block |
| Key F / mobile KICK | Kick (breaks block) |
| Left mouse drag ≥ 30px | Charged directional attack |
| Right mouse drag ≥ 30px | Held directional block |

### Where to look in code

| Concern | Primary file |
|---------|-------------|
| Local player (combat + sync) | `src/core/entities/PlayerLocal.js` |
| Remote player (interpolation) | `src/core/entities/PlayerRemote.js` |
| Server networking | `src/core/systems/ServerNetwork.js` |
| Client networking | `src/core/systems/ClientNetwork.js` |
| Packet definitions | `src/core/packets.js` |
| VRM animation | `src/core/extras/createVRMFactory.js` |

---

## Keeping Docs Current

When you change behavior in the areas above, update the matching doc in the same PR/commit. See `.cursor/skills/hyperfy-project/SKILL.md` for agent standing orders.
