---
name: hyperfy-project
description: >-
  Hyperfy PvP fork — sword fighting MMO built on the Hyperfy engine.
  Use when working in this repository on server/client architecture,
  networking, player sync, combat, PlayerLocal/PlayerRemote, VRM avatars,
  or any src/core/ engine code. Read project docs before implementing changes
  and update docs when behavior changes.
---

# Hyperfy PvP Fork — Project Skill

## Standing Orders

1. **Read before coding.** Before changing networking, combat, player entities, or core systems, read the relevant doc(s) in `docs/` (see index below).
2. **Update docs with code.** When you change behavior in a documented area, update the matching doc in the same session. Do not leave docs stale.
3. **Match the code.** Docs describe this fork's actual behavior — verify against source if unsure. Key files: `PlayerLocal.js`, `PlayerRemote.js`, `ServerNetwork.js`, `ClientNetwork.js`.
4. **Minimal doc scope.** Update only the sections affected. Do not rewrite unrelated docs or add new doc files unless the user asks or a major new subsystem needs coverage.

## Doc Index

| Topic | Path |
|-------|------|
| Index / quick reference | `docs/README.md` |
| Engine architecture | `docs/architecture.md` |
| Server ↔ client networking | `docs/server-client.md` |
| Character sync & interpolation | `docs/character-sync.md` |
| Sword combat | `docs/combat.md` |
| App scripting (upstream) | `docs/scripting/README.md` |

## Architecture Summary

Single npm package (not a monorepo). Shared engine in `src/core/`; four entry points:

| Entry | Factory | Role |
|-------|---------|------|
| `src/server/index.js` | `createServerWorld()` | Authoritative relay + persistence |
| `src/client/index.js` | `createClientWorld()` | Browser 3D + React UI |
| `src/node-client/index.js` | `createNodeClientWorld()` | Headless bots |
| viewer build | `createViewerWorld()` | Offline preview |

Transport: WebSocket binary MessagePack (`src/core/packets.js`).

## Authority Model (do not confuse)

| Client-authoritative | Server-authoritative |
|---------------------|---------------------|
| Movement (p, q) | Health / damage |
| Locomotion (m, a, g, e) | Combat hit validation (identity only) |
| Combat effects (ef) | Spawn, ranks, persistence |
| Hit detection (PhysX triggers) | Teleport / push routing |

Movement is **not** server-validated. Damage is **server-authoritative** via `playerHit`. Blocking is **fully client-authoritative** — no server packet.

## Combat Quick Facts

- Damage: 25 per hit, max health 100
- Sword collider: trigger, `weapon` layer, 16 ms phantom-hit guard
- Block collider: simulation shape (not trigger), directional tag matching on **attacker's client**
- Block: client-only on tag match (no server packet); `playerHit` only on damage / wrong block
- Input: keys 1–4 attacks, 5 generic block; mouse drag ≥ 30px for charged attack / held directional block
- Death: fall anim → 5 s → getup → heal via `playerHit` with `damage: -100`

## Sync Quick Facts

- Network rate: 8 Hz (`entityModified` deltas)
- Remote interpolation: `BufferedLerp*` with ~187 ms buffer (`networkRate * 1.5`)
- Animation: mode/axis/gaze/emote/effect fields — no bone sync
- Effects (`ef`): sent immediately via `setEffect()`, not batched at 8 Hz

## When to Update Which Doc

| You changed… | Update… |
|--------------|---------|
| Packets, connection, authority | `docs/server-client.md` |
| Player sync, interpolation, avatars | `docs/character-sync.md` |
| Attacks, blocks, damage, death | `docs/combat.md` |
| Systems, tick loop, physics layers | `docs/architecture.md` |
| New top-level subsystem | `docs/README.md` index + new doc if warranted |
