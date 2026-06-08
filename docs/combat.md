# Combat System

## Overview

Combat is **client-predicted for hits and blocks, server-validated for health only**:

1. Attacker's client detects sword contact locally (PhysX trigger)
2. Block vs damage is decided on the attacker's client (tag match) — **no server packet for blocks**
3. On damage only: client sends `playerHit` → server applies health → broadcasts `entityModified`
4. All clients update health bars / death state from server; VFX (sparks/blood) from local PhysX

---

## Attack System

### Input → Attack

| Input | Action |
|-------|--------|
| Key 1 | Instant attack left |
| Key 2 | Instant attack right |
| Key 3 | Instant attack high |
| Key 4 | Instant attack low |
| Left mouse drag ≥ 30px (pointer locked) | Charged directional attack — drag starts backswing; release triggers swing (early release waits for windup) |

Drag direction picks emote (dominant axis: horizontal vs vertical, sign of dx/dy). Guards: not sprinting, not already charging, not committed mid-swing.

Instant attacks (`startAttack(emote, false)`) skip the hold phase and activate the sword collider at 500 ms.

Emote maps to attack tag:

| Emote | Tag |
|-------|-----|
| `ATTACK_HIGH` | `high` |
| `ATTACK_LEFT` | `left` |
| `ATTACK_RIGHT` | `right` |
| `ATTACK_LOW` | `low` |

### Timing Phases

```
t = 0ms       Mouse drag triggers startAttack()
              Animation plays to backswing and PAUSES (charged mode)
              swordColliderActive = false
              isInWindup = true

              [Player holds mouse button...]

t = release   completeChargedAttack() OR pendingChargedRelease
  ├─ before 500ms windup → finish windup, pause at backswing 500ms, then auto-swing
  └─ after 500ms windup (holding click) → swing immediately on release

t = 500ms     Animation reaches backswing pose
              ├─ still holding click → pause until release (can swing right away)
              └─ released early → pause 500ms, then auto-swing
              hitPlayersThisSwing = new Set()
              
t = 1000ms    Sword collider DEACTIVATES
              Attack over, return to idle
```

### Sword Collider

Defined in `PlayerLocal.initSwordCollider()`:

```
Shape:   Box  0.1w × 1.0h × 0.05d  (blade dimensions)
Type:    TRIGGER_SHAPE (no physics push, only enter/exit callbacks)
Layer:   weapon  →  masks with: player
Initial: DISABLED
```

`setSwordColliderActive(active)`:
- Sets `eTRIGGER_SHAPE` flag on the PhysX shape
- When activating: sets `swordColliderReady = false`, waits 16ms before setting `true` — prevents phantom hits from residual overlap

### `onSwordHit(otherHandle)`

Called on the **attacker's client** when the sword trigger overlaps another collider.

```
1. Guard: collider active? collider ready?
2. If otherHandle.tag === 'block':
   a. Read attacker's currentAttackTag vs blocker's currentBlockTag
   b. Match → disable sword, sparks/audio (no server packet)
   c. Mismatch → fall through — treat blocker as hit target (damage through wrong block)
3. Guard: already hit this player this swing?
4. spawnBloodParticles + playHitAudio
5. network.send('playerHit', { attackerId, targetId, damage: 25 })
```

Server receives `playerHit`, validates, applies damage, broadcasts `entityModified`.

---

## Block System

Blocking is **fully client-authoritative** — the server is not involved in block outcomes. Only **`playerHit`** touches the server (when damage goes through).

Blocking is **directional**: your block pose must match the incoming attack direction. A wrong block does not stop the sword — the attack deals damage as if it passed through the shield.

### Input → Block

| Input | Action |
|-------|--------|
| Key 5 | Generic block (`Emotes.BLOCK`) — `currentBlockTag = null`, blocks **all** directions |
| Right mouse drag ≥ 30px (pointer locked) | Held directional block — animation freezes at block pose until release |

Mouse drag picks block emote the same way as attacks (dominant axis + sign).

Key 5 uses **normal mode** (1 s timed block). Mouse drag uses **hold mode** (collider stays up until release).

| Block emote | `currentBlockTag` | Blocks attack tag |
|-------------|-------------------|-------------------|
| `BLOCK_HIGH` | `high` | `high` |
| `BLOCK_LOW` | `low` | `low` |
| `BLOCK_LEFT` | `left` | `right` (mirror) |
| `BLOCK_RIGHT` | `right` | `left` (mirror) |
| `BLOCK` (key 5) | `null` | all directions |

Left/right mirror: you block left to stop a swing coming from your right.

### Starting a block (`startBlock`)

1. Sets `isBlocking = true` and `currentBlockTag` from emote
2. Activates block collider immediately (`setBlockColliderActive(true)`)
3. Sends `entityModified` with `ef` (effect) so remote clients mirror the block animation and tag

**Hold mode** (mouse drag): effect duration 999 s, animation pauses at 500 ms via mixer `timeScale = 0`. Released via `stopBlock()` → collider off, tags cleared, `setEffect(null)`.

**Normal mode** (key 5): effect duration 1 s, collider auto-deactivates after `blockDuration`.

### Block collider design

```
Shape:   Box  ~0.9w × ~1.6h × 0.3d  (in front of player at chest height)
Type:    SIMULATION_SHAPE  (not a trigger — sword triggers can detect it)
Layer:   player group, weapon mask
Position: 0.5 m in front of player, 60% of capsule height (lateUpdate)
```

Sword colliders are **triggers**; block colliders are **simulation shapes** because PhysX does not fire trigger–trigger overlaps. The sword trigger detects the block simulation shape.

Remote players get the same block collider (`PlayerRemote.initBlockCollider`) but **no** `onBlockHit` callback — only the attacker-side sword trigger drives block resolution.

### Tag matching algorithm

Used identically in `PlayerLocal.onSwordHit` and `PlayerLocal.onBlockHit`:

```js
// null blockTag (key 5 generic block) → blocks everything
if (!blockTag) blocked = true
else if (blockTag === 'high' && attackTag === 'high') blocked = true
else if (blockTag === 'low'  && attackTag === 'low')  blocked = true
else if (blockTag === 'left' && attackTag === 'right') blocked = true  // mirror
else if (blockTag === 'right'&& attackTag === 'left')  blocked = true  // mirror
else blocked = false  // wrong direction — attack goes through
```

Blocker's `currentBlockTag` on the attacker's machine comes from synced `ef` effect emote (`PlayerRemote.update()` sets tags from emote URL).

### How a block is detected (two clients, one attacker-side decision)

Each client runs its own PhysX scene with all players' colliders. When player A swings at blocking player B:

```mermaid
sequenceDiagram
    participant A as Attacker client (A)
    participant B as Blocker client (B)
    participant S as Server

    Note over A,B: B's block collider active, tags synced via entityModified(ef)

    A->>A: A's sword trigger hits B's block shape
    A->>A: PlayerLocal.onSwordHit — tag match?
    alt Tags match
        A->>A: Disable A's sword, sparks/audio
        Note over A,S: No network — block is client-only
    else Tags mismatch
        A->>S: playerHit {attackerId:A, targetId:B, damage:25}
        S->>S: Apply health
        S->>A: entityModified health
        S->>B: entityModified health
    end

    B->>B: B's block hit by A's remote sword
    B->>B: PlayerRemote.onSwordHit — VFX only (no network)
```

**Per swing on the attacker, at most one server packet:**

| Outcome | Server packet | When |
|---------|---------------|------|
| Successful block | *(none)* | Tags match — sword disabled locally only |
| Damage | `playerHit` | Wrong block or body hit |

**Primary resolution path:** the **attacker's** `PlayerLocal.onSwordHit` when the sword trigger hits a `block`-tagged collider. Tag matching, sword disable, and whether to send `playerHit` all happen here.

**Blocker-side VFX (no network packet):** On the blocker's client, PhysX runs the same sword-vs-block overlap locally. The callback fires on the **attacker's** `PlayerRemote` entity (`PlayerRemote.onSwordHit`), not on the blocker's `PlayerLocal`. That handler re-runs the same tag match using:

- `this.currentAttackTag` — attack direction synced onto the attacker's remote entity
- `blocker.currentBlockTag` — the local blocker's own tag (from their active block)

| Tag match on blocker's machine | What the blocker sees |
|-------------------------------|------------------------|
| Success | Spark particles + `audioblock.mp3` at chest height |
| Failure | Blood particles + `audiohit.mp3` at chest height |
| Failure (health) | Nametag drops when `entityModified { health }` arrives from server |

The server is **not** in the block path. Blocker VFX comes from local PhysX immediately — same as the attacker.

**Third-party spectators (player C):** C's client also simulates A's remote sword vs B's remote block. The same `PlayerRemote(A).onSwordHit` path runs on C's machine for VFX.

**`PlayerLocal.onBlockHit`:** If this ever fired on the blocker, it would duplicate the same tag logic using `blocker.base` for VFX position. In practice PhysX invokes the sword trigger callback instead; the `PlayerRemote` path is what blockers rely on today.

### Successful block (tags match)

On **attacker's client** (`PlayerLocal.onSwordHit`):

1. Add blocker to `hitPlayersThisSwing` (prevent double-processing)
2. `setSwordColliderActive(false)` — end the swing immediately
3. Spark particles + block audio at blocker's position
4. **No server packet** — blocking is client-authoritative

On **blocker's client** (`PlayerRemote` for the attacker, when its sword hits the local block): same tag match → sparks + block audio, or blood + hit audio on mismatch. No network send.

On **attacker's client**: VFX at blocker's synced position; send `playerHit` to server **only** if tags mismatch (wrong block).

### Failed block (tags mismatch)

The sword is considered to pass through the block collider:

- **Attacker's client:** `onSwordHit` falls through to the normal hit path using the blocker's `playerId` → blood VFX + `playerHit` to server
- **Blocker's client:** `PlayerRemote.onSwordHit` shows blood VFX locally

Wrong block = full 25 damage. There is no partial block or chip damage.

### Directional combat matrix

```
                     ATTACKER
              HIGH  LEFT  RIGHT  LOW
           ┌─────────────────────────
B  HIGH    │  ✓    ✗     ✗      ✗
L  LEFT    │  ✗    ✗     ✓      ✗
O  RIGHT   │  ✗    ✓     ✗      ✗
C  LOW     │  ✗    ✗     ✗      ✓
K
```

Key 5 generic block (`blockTag = null`) matches all columns.

---

## Particle & Audio Feedback

### Blood Particles (hit)

```
Count:     50 particles
Color:     #aa0000 (dark red)
Shape:     small boxes
Velocity:  ±2 m/s horizontal, +1–4 m/s vertical (random)
Lifetime:  0.6 seconds
Gravity:   yes
Emissive:  yes (fades over lifetime)
```

### Blood Splatters (ground)

```
Texture:   asset://bloodsplatter.png
Count:     3–5 per hit
Placement: Raycast down from hit X/Z to ground (not at hit height)
Scale:     0.5–1.2 m, random rotation
Persist:   Session-long decals (cap 200, oldest removed)
```

### Spark Particles (block)

```
Count:     10 particles
Color:     #ffff00 (yellow)
Shape:     small boxes
Velocity:  ±3 m/s horizontal, +2–6 m/s vertical
Lifetime:  0.5 seconds
Emissive:  4.0 intensity (bright flash)
```

### Audio

```
Hit sound:   asset://audiohit.mp3   — volume 0.5, spatial, 20m max
Block sound: asset://audioblock.mp3 — same settings
```

---

## Damage Values

| Event | Damage |
|-------|--------|
| Sword hit | 25 HP |
| Max health | 100 HP |
| Min health | 0 HP (death) |

Health is clamped server-side: `Math.max(0, Math.min(100, health - damage))`.

---

## Death & Respawn

When health reaches 0:
1. Server broadcasts `entityModified` with `health: 0`
2. `PlayerLocal.onDeath()` — cancels attacks/blocks, sets `isDead = true`
3. `DEATH_FALL` effect (1.5 s) → dead locomotion pose
4. After 5 s: client sends `playerRespawn` with corpse position
5. Server broadcasts `playerCorpse` to other clients, teleports player to team spawn (Crusader/Saracen), restores health to 100 HP
6. Live player gets a fresh avatar at spawn; dead body stays at death location (no networking)

---

## Network Packets (Combat)

Only **`playerHit`** is used for combat damage today. **`attackCanceled`** remains in the protocol but is no longer sent by mouse charged attacks. Blocking uses local PhysX only.

### `playerHit`  (Client → Server)
```js
{ attackerId: playerId, targetId: playerId, damage: 25 }
```
Server validation: `attackerId` must be the sender's player. Applies damage, broadcasts `entityModified`.

Not sent on a successful block (tags match).

### `playerRespawn`  (Client → Server)
```js
{ p: [x, y, z], q: [x, y, z, w] }
```
Sent when death timer completes. Server spawns corpse for other clients, teleports player to team spawn, restores health.

### `playerCorpse`  (Server → Clients)
```js
{ playerId, p, q, sessionAvatar }
```
Spawns a static dead avatar at the death location. Not sent back to the respawning client (they spawn it locally).

### `attackCanceled`  (Client → Server → all other Clients)
```js
{ playerId: playerId }
```
Legacy packet for clearing remote attack state. Not sent by mouse charged attacks anymore (early release completes the swing instead).

---

## Key Source Files

| File | What's here |
|------|------------|
| `src/core/entities/PlayerLocal.js` | All local player logic: input, physics, attack, block, particles, audio |
| `src/core/entities/PlayerRemote.js` | Remote player: interpolation, animation sync, combat state display |
| `src/core/systems/ServerNetwork.js` | `onPlayerHit`, `onAttackCanceled` — health validation |
| `src/core/systems/ClientNetwork.js` | `onAttackCanceled` receive-side handler |
| `src/core/packets.js` | Packet name constants |
| `src/core/nodes/Collider.js` | PhysX collider node definition (world apps; combat uses inline PhysX actors) |

---

## Related Docs

- [Character synchronization](character-sync.md) — how `ef` effects sync to remote players
- [Server / client networking](server-client.md) — packet reference
- [Documentation index](README.md)

---

## Combat Timing Summary

```
ATTACK (charged):
─────────────────────────────────────────────────────────────
0ms     Windup — animation plays to backswing
        [hold click to pause at backswing, release to swing]

Early release (before 500ms windup):
  windup completes → pause at backswing 500ms → auto-swing
  (~1000ms from attack start minimum)

Hold past windup, release immediately:
  pause at 500ms → swing on release (~500ms+ from start)

+500ms  Sword collider ACTIVE (after 16ms ready delay) on swing
+1000ms Sword collider DEACTIVATES (total attack duration from swing)
─────────────────────────────────────────────────────────────

BLOCK (key 5, normal mode):
─────────────────────────────────────────────────────────────
0ms     Block starts — collider active immediately
1000ms  Collider off, block ends
─────────────────────────────────────────────────────────────

BLOCK (mouse hold mode):
─────────────────────────────────────────────────────────────
0ms     Block starts — collider active immediately
500ms   Animation pauses at block pose
∞       Held until mouse release
        On release: collider off, tags cleared
─────────────────────────────────────────────────────────────
```
