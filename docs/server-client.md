# Server / Client Relations & Networking

## Authority Model

The server is **authoritative**. The client predicts locally for responsiveness, but the server validates and broadcasts the canonical result.

| Who decides | What |
|-------------|------|
| Server | Health changes, damage validation, spawn positions, ranks, persistence |
| Client | Local input, animation playback, particle/audio feedback, rendering |

---

## Connection Lifecycle

```
Browser connects via WebSocket
         │
         ▼
ServerNetwork.onConnection()
  ├─ Create player entity (spawn position from config)
  ├─ Send SNAPSHOT to new client (all blueprints + entities + settings)
  └─ Broadcast entityAdded to all other clients
         │
         ▼
Client receives snapshot
  ├─ Instantiate all entities
  ├─ Create PlayerLocal for own player
  └─ Create PlayerRemote for every other player
         │
         ▼
[Game runs — incremental packets only]
         │
         ▼
Disconnect → destroy player entity → broadcast to others
```

---

## Binary Packet Protocol

Transport: **WebSocket binary frames** encoded with **msgpackr** (MessagePack).

All packet names are defined in `src/core/packets.js`.

### Packet Reference

| Packet | Direction | Purpose |
|--------|-----------|---------|
| `snapshot` | S→C | Full world state on join |
| `command` | C→S | Generic command |
| `chatAdded` | S→C | Chat message broadcast |
| `entityAdded` | S→C | New entity spawned |
| `entityModified` | S→C | Property update (health, position, effect…) |
| `entityEvent` | S→C | Custom app event |
| `playerTeleport` | S→C | Force-move a player |
| `playerPush` | S→C | Apply impulse to a player |
| `playerSessionAvatar` | S→C | Temporarily swap avatar |
| `modifyRank` | S→C | Change player rank |
| `kick` | S→C | Disconnect a player |
| `ping` / `pong` | both | Latency measurement |
| `playerHit` | **C→S** | Client reports a sword hit |
| `blockHit` | **C→S** | Client reports a successful block |
| `swordBlocked` | **S→C** | Tell attacker their sword was blocked |
| `attackCanceled` | **S→C** | Broadcast: player canceled their attack |

### Sending Packets

```js
// Client → Server
network.send('playerHit', { attackerId, targetId, damage })

// Server → one client
network.sendTo(socketId, 'swordBlocked', { blockerId })

// Server → all clients
network.broadcast('entityModified', { id, health })
```

---

## State Sync Rate

- **Network rate:** 8 Hz (every 125 ms) — position, rotation, animation state
- **Physics rate:** 50 Hz — local simulation only, not sent per-frame
- **Interpolation:** `BufferedLerpVector3` / `BufferedLerpQuaternion` smooth remote players between network packets

---

## Snapshot (Initial World State)

Sent once to each client on join:

```js
{
  id: clientSocketId,
  serverTime: ms,           // used for clock offset correction
  collections: [],
  settings: { ... },
  blueprints: [{ ... }],    // all blueprint templates
  entities: [{ ... }],      // all live entities (players + apps)
  livekit: { ... },
  authToken: JWT,
}
```

After the snapshot, only incremental packets are sent.

---

## Incremental Updates

| Update type | When sent |
|-------------|-----------|
| `entityAdded` | New player joins, new app placed |
| `entityModified` | Health changes, effect/animation changes, position drift correction |
| `entityEvent` | App script fires a custom event |

`entityModified` is the workhorse — every server-side state change (health, death, animation effect) goes through it and triggers `onEntityModified` on all clients.

---

## Server Network Handlers (`src/core/systems/ServerNetwork.js`)

### `onConnection(ws, params)`
- Validates auth token
- Creates player entity at spawn position
- Sends snapshot to new client
- Broadcasts `entityAdded` to everyone else

### `onPlayerHit(socket, { attackerId, targetId, damage })`
1. Assert `attackerId` belongs to this socket (prevents spoofing)
2. Find `targetId` entity
3. `health = Math.max(0, Math.min(100, health - damage))`
4. Call `entity.modify({ health })`
5. Broadcast `entityModified` to all clients

### `onBlockHit(socket, { blockerId, attackerId })`
1. Assert `blockerId` belongs to this socket
2. Find attacker's socket
3. Send `swordBlocked` packet to attacker's socket only

### `onAttackCanceled(socket, { playerId })`
1. Assert `playerId` belongs to this socket
2. Broadcast `attackCanceled` to all other clients

---

## Client Network Handlers (`src/core/systems/ClientNetwork.js`)

### `onSnapshot(data)`
Builds the initial world from the full state package.

### `onEntityModified(data)`
Finds the entity by `id` and calls `entity.modify(data)` — this propagates to the player's health bar, death state, animation, etc.

### `onPlayerHit(attackerId, targetId, damage)`
Client-side reaction to receiving a hit confirmation (particles, audio — these are often already spawned locally).

### `onSwordBlocked(blockerId)`
Calls `playerLocal.setSwordColliderActive(false)` — stops the sword even if it hasn't physically contacted the defender yet.

### `onAttackCanceled(playerId)`
Finds the remote player and clears their attack animation/state.

---

## Player Entity Ownership

When `entityAdded` or `entityModified` arrives, the Entities system inspects `data.owner`:

```
data.owner === network.id  →  instantiate as PlayerLocal
data.owner !== network.id  →  instantiate as PlayerRemote
```

`PlayerLocal` runs full physics, input handling, and sends packets to the server.  
`PlayerRemote` is purely visual — kinematic body, interpolated position, animations driven by incoming `entityModified` packets.

---

## Clock Synchronization

On each `pong` reply the client computes:
```
offset = serverTime - localTime - (roundTripTime / 2)
```
`network.getTime()` returns `Date.now() + offset` for server-synchronized timestamps.
