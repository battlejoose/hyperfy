# Combat System

## Overview

Combat is **client-predicted with server validation**:

1. Attacker's client detects the hit locally (physics trigger)
2. Client sends `playerHit` packet to server
3. Server validates the hit is legitimate, applies damage, broadcasts to all
4. All clients update health bars / death state

This means visual feedback (particles, audio) is instant on the attacker's machine; the actual health number comes a round-trip later from the server.

---

## Attack System

### Input → Attack

Mouse drag downward ≥ 50px triggers `startAttack(emote, chargeMode=true)`.

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

t = release   completeChargedAttack() called
  ├─ held < 500ms → attackCanceled sent, no collider, cancel animation
  └─ held ≥ 500ms → animation resumes, proceed to active phase

t = 500ms     Sword collider ACTIVATES (after 16ms phantom-hit delay)
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

Called by PhysX trigger when sword enters another collider.

```
1. Guard: collider active? collider ready?
2. Guard: is the other shape a block collider?
   └─ yes → onBlockHit() — may cancel the sword
3. Guard: already hit this player this swing?
   └─ yes → return (one hit per swing per target)
4. Add target to hitPlayersThisSwing
5. spawnBloodParticles(contactPosition)
6. playHitAudio(contactPosition)
7. network.send('playerHit', { attackerId, targetId, damage: 25 })
```

Server receives `playerHit`, validates, applies damage, broadcasts `entityModified`.

---

## Block System

### Input → Block

Mouse drag right ≥ 50px triggers `startBlock(emote, holdMode=true)`.

Block tag mirrors incoming attack:

| Emote | Tag | Blocks |
|-------|-----|--------|
| `BLOCK_HIGH` | `high` | `high` attacks |
| `BLOCK_LOW` | `low` | `low` attacks |
| `BLOCK_LEFT` | `left` | `right` attacks |
| `BLOCK_RIGHT` | `right` | `left` attacks |

Note the left/right mirror — you raise your shield on your LEFT to block a swing coming from your RIGHT.

### Timing (Hold Mode)

```
t = 0ms       startBlock() called
              blockColliderActive = true
              isBlocking = true
              Animation starts playing

t = 500ms     Animation PAUSES at block pose
              [Player holds indefinitely]

t = release   stopBlock() called
              blockColliderActive = false
              isBlocking = false
              Animation resumes from paused frame
              Brief recovery before next action
```

### Block Collider

Defined in `PlayerLocal.initBlockCollider()`:

```
Shape:   Box  1.5× capsule_width × 90% height × 0.3d
Type:    SIMULATION_SHAPE (physical, stops incoming triggers)
Layer:   player  with weapon.mask filter
Initial: DISABLED
```

### `onBlockHit(otherHandle)`

Called when the block collider is entered by a weapon trigger.

```
1. Guard: isBlocking = true?
2. Read attacker's currentAttackTag
3. Check tag match:
   ┌─ high   ↔ high   ✓
   ├─ low    ↔ low    ✓
   ├─ left   ↔ right  ✓  (mirror)
   ├─ right  ↔ left   ✓  (mirror)
   └─ mismatch → attack continues through, no block
4. Block success:
   a. setSwordColliderActive(false)  — stop the swing locally
   b. spawnSparkParticles(contactPosition)
   c. playBlockAudio(contactPosition)
   d. network.send('blockHit', { blockerId, attackerId })
```

Server receives `blockHit`, finds attacker's socket, sends `swordBlocked` back to attacker.

Attacker's client receives `swordBlocked` → calls `setSwordColliderActive(false)` remotely, ensuring the sword is disabled even if network latency would have allowed more contacts.

---

## Directional Combat Matrix

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

A mismatched direction means the block collider is in the wrong orientation and the sword passes through to deal damage.

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
- Server broadcasts `entityModified` with `health: 0`
- `PlayerLocal` sets `isDead = true`
- Death animation plays
- After `deathTimeout` ms: player respawns at spawn point (position reset, health reset)

---

## Network Packets (Combat)

### `playerHit`  (Client → Server)
```js
{ attackerId: playerId, targetId: playerId, damage: 25 }
```
Server validation: `attackerId` must be the sender's player. Applies damage, broadcasts `entityModified`.

### `blockHit`  (Client → Server)
```js
{ blockerId: playerId, attackerId: playerId }
```
Server sends `swordBlocked` directly to attacker's socket.

### `swordBlocked`  (Server → Client, point-to-point)
```js
{ blockerId: playerId }
```
Received only by the attacker. Immediately disables their sword collider.

### `attackCanceled`  (Server → all other Clients)
```js
{ playerId: playerId }
```
Broadcast when a charged attack is released before the 500ms threshold. Remote clients clear the player's attack state.

---

## Key Source Files

| File | What's here |
|------|------------|
| `src/core/entities/PlayerLocal.js` | All local player logic: input, physics, attack, block, particles, audio |
| `src/core/entities/PlayerRemote.js` | Remote player: interpolation, animation sync, combat state display |
| `src/core/systems/ServerNetwork.js` | `onPlayerHit`, `onBlockHit`, `onAttackCanceled` — authoritative validation |
| `src/core/systems/ClientNetwork.js` | `onSwordBlocked`, `onAttackCanceled` receive-side handlers |
| `src/core/packets.js` | Packet name constants |
| `src/core/nodes/Collider.js` | PhysX collider node definition |

---

## Combat Timing Summary

```
ATTACK (charged):
─────────────────────────────────────────────────────────────
0ms     Windup — animation pauses at backswing
        [hold mouse...]
<500ms  Release early → attackCanceled, nothing happens
≥500ms  Release → animation resumes
+16ms   Sword collider ACTIVE + ready
+500ms  Sword collider DEACTIVATES
─────────────────────────────────────────────────────────────

BLOCK (hold mode):
─────────────────────────────────────────────────────────────
0ms     Block starts — collider active immediately
500ms   Animation pauses at block pose
∞       Held until mouse release
        On release: collider off, brief recovery
─────────────────────────────────────────────────────────────
```
