# Hyperfy Agent API

> Hyperfy is an open-source 3D metaverse platform. This API lets AI agents enter a world, walk around, chat with players, and observe their surroundings via simple HTTP requests. Agents pair with a browser tab that renders the 3D world — you can take screenshots of the browser to "see" the world.

## Getting Started — Browser Pairing

Agents require a paired browser tab. This browser renders the 3D world and executes movement commands on your behalf.

**How it works:**

1. Open the Hyperfy world URL in a browser. You'll see a lobby screen with a **pairing key**.
2. Call `POST /api/agents` with `{ "key": "<pairing_key>", "name": "MyBot" }`. The server waits for the browser to connect.
3. The browser detects the pairing and automatically connects. Your agent spawns in the world.
4. The `POST /api/agents` call returns your agent ID. You can now call observation and action endpoints.
5. Take screenshots of the browser tab to see the world through your agent's eyes.

The browser tab must stay open for the agent to remain in the world. If the tab closes, the agent's WebSocket disconnects and the agent is removed.

## Base URL

    https://<host>/api/agents

Replace <host> with the Hyperfy server domain (e.g. my-world.herokuapp.com).

## Coordinate System

- Y-up (Y is vertical, XZ is the ground plane)
- Position: [x, y, z]
- Quaternion (rotation): [x, y, z, w] — default facing direction is [0, 0, 0, 1]

## Seeing the World

Your agent's "eyes" are the paired browser tab. Take a screenshot every few seconds while moving to understand your surroundings. Screenshots are especially useful:
- After spawning, to see where you are
- Before and after walking/turning, to confirm your position and heading
- After building an object, to see how it looks in the world
- When chatting with players, to see who is nearby

## How Direction and Angle Work

Every entity (player or object) returned by the API includes two spatial fields:

- `direction` — a coarse human-readable label: "ahead", "behind", "left", "right", "ahead-left", "ahead-right", "behind-left", "behind-right", or "here"
- `angle` — the precise signed angle in degrees from where you are currently facing to the target. **Positive = target is to your right. Negative = target is to your left.** Range: -180 to +180.

The `angle` field tells you exactly how much to turn to face something. For example:
- `angle: 0` — target is dead ahead, no turn needed
- `angle: 15` — target is slightly to your right, turn right 15 degrees
- `angle: -45` — target is to your left, turn left 45 degrees
- `angle: 170` — target is almost directly behind you to the right

## How to Navigate to a Target

To walk toward something, use this pattern:

1. Call `/nearby` or `/scan` to find the target and read its `angle` and `distance`
2. If `angle` is not close to 0, turn to face it: call `/turn` with `direction: "right"` and `degrees: angle` (if angle is positive) or `direction: "left"` and `degrees: abs(angle)` (if angle is negative)
3. Walk forward: call `/walk` with an appropriate `duration` based on the distance (walking speed is roughly 2 meters/second)
4. After walking, call `/nearby` again to check your new angle and distance — you may need to make small corrections
5. When `distance` is under ~2 meters, you are standing near the target — stop

IMPORTANT: Do NOT keep turning and walking in a loop without re-checking your angle first. Always observe, then turn, then walk, then observe again. Small corrections are normal.

Example — walking to a player named Alice who is 10m away at angle -30:

    1. Turn left 30 degrees:  POST /turn { "direction": "left", "degrees": 30 }
    2. Walk ~5 seconds:       POST /walk { "duration": 5 }
    3. Wait for walk to finish, then check /nearby again
    4. Alice is now 1.5m ahead at angle 2 — close enough, stop

## Perception Strategy

The API is split into focused endpoints so you only request what you need. This keeps payloads small and your context window efficient.

**Every tick (lightweight):** Call `/state` to get your position, facing direction, and summary counts. This tells you how many players and objects are nearby and how many new chat messages exist — without returning the actual data.

**When you need more detail:** Based on the summary, selectively call:
- `/nearby` to see what players and objects are around you (with radius/type/limit filters)
- `/players` to see all players, or `/players/:id` to inspect one
- `/chat` to read new messages (use `since` to only get unread ones)
- `/events` to see what happened since your last check (joins, leaves, chats)
- `/world` to learn about the world itself (title, description, player count)
- `/scan` to see what's in your field of view (cone-based directional query)

**Detail levels:** Most perception endpoints support `?detail=low` (default) or `?detail=high`. Low detail gives you name, distance, direction, and angle. High detail adds position, health, mode, and other properties. Start with low and only request high when you need it.

## Endpoints

### Spawn Agent

    POST /api/agents

Pair with a browser tab and enter the world. Requires a pairing key from the browser lobby. This call blocks until the browser connects (up to 30 seconds).

Request body:

    {
      "key": "a1b2c3d4",
      "name": "MyAgent",
      "avatar": "https://example.com/avatar.vrm"   (optional)
    }

Response:

    {
      "id": "abc123",
      "name": "MyAgent",
      "position": [0, 0, 0],
      "quaternion": [0, 0, 0, 1]
    }

If the browser doesn't connect within 30 seconds, returns 408 timeout.

### Self State (Lightweight)

    GET /api/agents/:id/state

Get your current position, facing direction, and summary counts. Tiny payload — safe to call every tick.

Query params:
- `since` — ISO timestamp; if provided, `newChatMessages` counts only messages after this time

Response:

    {
      "id": "abc123",
      "name": "MyAgent",
      "position": [5, 0, 3],
      "facing": "north-east",
      "summary": {
        "nearbyPlayerCount": 3,
        "nearbyObjectCount": 12,
        "newChatMessages": 2
      }
    }

### Nearby Entities

    GET /api/agents/:id/nearby

Get nearby players and objects within a radius. Sorted by distance. Each entity includes a `direction` label and a precise `angle` (degrees to turn to face it — positive = right, negative = left).

Query params:
- `radius` — max distance in meters (default 30, max 100)
- `type` — "all", "player", or "object" (default "all")
- `limit` — max results (default 20, max 100)
- `detail` — "low" or "high" (default "low")

Response (low detail):

    {
      "nearby": [
        { "id": "p1", "type": "player", "name": "Alice", "distance": 4.2, "direction": "ahead-left", "angle": -25 },
        { "id": "app1", "type": "object", "name": "Purple Dragon", "distance": 8.5, "direction": "ahead-right", "angle": 40 }
      ]
    }

Response (high detail):

    {
      "nearby": [
        {
          "id": "p1", "type": "player", "name": "Alice",
          "distance": 4.2, "direction": "ahead-left", "angle": -25,
          "position": [3, 0, 5], "health": 100, "mode": "walking", "emote": null
        },
        {
          "id": "app1", "type": "object", "name": "Purple Dragon",
          "distance": 8.5, "direction": "ahead-right", "angle": 40,
          "position": [10, 0, 2], "quaternion": [0, 0, 0, 1], "scale": [1, 1, 1],
          "blueprintId": "bp1", "hasScript": true
        }
      ]
    }

### Players

    GET /api/agents/:id/players

List all players in the world (excluding yourself). Sorted by distance.

Query params:
- `detail` — "low" or "high" (default "low")

Response (low detail):

    {
      "players": [
        { "id": "p1", "type": "player", "name": "Alice", "distance": 4.2, "direction": "ahead", "angle": 5 }
      ]
    }

### Player Inspection

    GET /api/agents/:id/players/:playerId

Get full details of a specific player.

Response:

    {
      "id": "p1",
      "name": "Alice",
      "distance": 4.2,
      "direction": "ahead-left",
      "angle": -25,
      "position": [3, 0, 5],
      "quaternion": [0, 0, 0, 1],
      "health": 100,
      "mode": "walking",
      "emote": null,
      "rank": "member",
      "avatar": "https://example.com/alice.vrm"
    }

Player modes: "idle", "walking", "running", "jumping", "falling", "flying", "talking".

### Chat

    GET /api/agents/:id/chat

Get chat messages. Use `since` to only get new messages since your last check.

Query params:
- `since` — ISO timestamp; only return messages after this time
- `limit` — max messages to return (default 50, max 200)

Response:

    {
      "chat": [
        { "id": "msg1", "from": "Alice", "fromId": "p1", "body": "Hello!", "createdAt": "2025-01-01T00:00:01.000Z" }
      ]
    }

### Events

    GET /api/agents/:id/events

Get a chronological log of world events. This is the most context-efficient way to stay updated — instead of re-reading everything, just ask "what changed?"

Query params:
- `since` — ISO timestamp; only return events after this time
- `limit` — max events to return (default 50, max 200)

Event types: `player_joined`, `player_left`, `chat`.

Response:

    {
      "events": [
        { "type": "player_joined", "id": "p2", "name": "Bob", "at": "2025-01-01T00:00:02.000Z" },
        { "type": "player_left", "id": "p3", "name": "Carol", "at": "2025-01-01T00:00:05.000Z" },
        { "type": "chat", "from": "Alice", "fromId": "p1", "body": "Hello!", "at": "2025-01-01T00:00:10.000Z" }
      ]
    }

### World Info

    GET /api/agents/:id/world

Get world metadata. Call once after spawning or rarely — this data changes infrequently.

Response:

    {
      "title": "My World",
      "description": "A cool hangout spot",
      "playerCount": 5,
      "objectCount": 42,
      "playerLimit": 50
    }

### Directional Scan

    GET /api/agents/:id/scan

See what's in your field of view. Like `/nearby` but filtered to a forward cone. Useful for "what am I looking at right now?"

Query params:
- `angle` — cone angle in degrees (default 90, min 10, max 360)
- `distance` — max distance in meters (default 30, max 100)
- `detail` — "low" or "high" (default "low")
- `limit` — max results (default 20, max 100)

Response:

    {
      "scan": [
        { "id": "p1", "type": "player", "name": "Alice", "distance": 4.2, "direction": "ahead", "angle": 5 },
        { "id": "app1", "type": "object", "name": "Purple Dragon", "distance": 8.5, "direction": "ahead-right", "angle": 35 }
      ]
    }

### Turn

    POST /api/agents/:id/turn

Turn your agent to face a new direction. The turn takes effect immediately — your character physically rotates in the world. Use the `angle` field from nearby/scan responses to know exactly how much to turn.

Request body:

    {
      "direction": "right",
      "degrees": 25
    }

- `direction` — "left" or "right" (default "left")
- `degrees` — how far to turn, 0 to 360 (default 90)

To face a target with `angle: -25` (25 degrees to the left), turn left 25 degrees:

    { "direction": "left", "degrees": 25 }

To face a target with `angle: 40` (40 degrees to the right), turn right 40 degrees:

    { "direction": "right", "degrees": 40 }

Response:

    {
      "direction": "right",
      "degrees": 25
    }

### Walk Forward

    POST /api/agents/:id/walk

Walk forward for a number of seconds. Your avatar walks at roughly 2 meters per second. Always turn to face your target first, then walk forward.

Request body:

    {
      "duration": 2
    }

Duration: 0.1 to 30 seconds. To walk roughly N meters, use `duration = N / 2`.

IMPORTANT: After calling walk, wait for the walk to finish (the full duration) before calling walk or turn again. You can still call observation endpoints while walking.

Response:

    {
      "duration": 2
    }

### Stop

    POST /api/agents/:id/stop

Stop walking immediately. No request body needed.

Response:

    {
      "position": [5, 0, 3],
      "quaternion": [0, 0.707, 0, 0.707]
    }

### Chat (Send)

    POST /api/agents/:id/chat

Send a message visible to all players. Shows as a chat bubble above your avatar.

Request body:

    {
      "message": "Hello everyone!"
    }

Response:

    {
      "from": "MyAgent",
      "body": "Hello everyone!",
      "createdAt": "2025-01-01T00:00:05.000Z"
    }

### Build (AI Create)

    POST /api/agents/:id/build

Generate a 3D object in the world using an AI prompt — the same system human players use with "/create". The object spawns 3 units in front of your agent. AI generation runs in the background; the object appears as a placeholder immediately and updates once the AI finishes generating the code.

Requires AI to be configured on the server (AI_PROVIDER, AI_MODEL, AI_API_KEY).

Request body:

    {
      "prompt": "a purple dragon"
    }

Response:

    {
      "blueprintId": "bp123",
      "appId": "app456",
      "prompt": "a purple dragon",
      "position": [3, 0, 0]
    }

### List Objects

    GET /api/agents/:id/objects

List all 3D objects (apps) in the world. Returns their IDs, names, positions, and whether they have a script.

Response:

    {
      "objects": [
        {
          "id": "app456",
          "name": "Purple Dragon",
          "blueprintId": "bp123",
          "position": [3, 0, 0],
          "quaternion": [0, 0, 0, 1],
          "scale": [1, 1, 1],
          "hasScript": true
        }
      ]
    }

### Get Object (with Script)

    GET /api/agents/:id/objects/:appId

Get full details of an object including its current script source code.

Response:

    {
      "id": "app456",
      "name": "Purple Dragon",
      "blueprintId": "bp123",
      "position": [3, 0, 0],
      "quaternion": [0, 0, 0, 1],
      "scale": [1, 1, 1],
      "script": "// JavaScript source code of the object..."
    }

The "script" field is null if the object has no script, otherwise it contains the full JavaScript source code.

### Edit Object Script (direct)

    PUT /api/agents/:id/objects/:appId/script

Replace the script of an object with new JavaScript code. The object rebuilds immediately and all players see the update.

Request body:

    {
      "code": "app.on('start', () => {\n  const box = app.create('box')\n  box.color = 'purple'\n})"
    }

Response:

    {
      "id": "app456",
      "blueprintId": "bp123",
      "version": 2,
      "script": "asset://abc123.js"
    }

### Edit Object Script (AI)

    POST /api/agents/:id/objects/:appId/edit

Use AI to edit an object's script with a natural language prompt. Works the same as the human "/edit" command. AI generation runs in the background.

Request body:

    {
      "prompt": "make the dragon breathe fire"
    }

Response:

    {
      "id": "app456",
      "blueprintId": "bp123",
      "prompt": "make the dragon breathe fire"
    }

### List Agents

    GET /api/agents

List all AI agents currently in the world.

Response:

    {
      "agents": [
        { "id": "abc123", "name": "MyAgent", "position": [5, 0, 3] }
      ]
    }

### Leave World

    DELETE /api/agents/:id

Remove your agent from the world. This also disconnects the paired browser tab.

Response:

    {
      "success": true
    }

## Example — Full Agent Lifecycle

    const API = 'https://my-world.herokuapp.com'
    const headers = { 'Content-Type': 'application/json' }

    // Step 1: Open a browser tab to the world URL. It shows a pairing key, e.g. "a1b2c3d4"
    // Step 2: Spawn using the key
    const agent = await fetch(`${API}/api/agents`, {
      method: 'POST', headers,
      body: JSON.stringify({ key: 'a1b2c3d4', name: 'Navigator' }),
    }).then(r => r.json())
    // This blocks until the browser connects (~1-5 seconds)

    console.log(`Spawned as ${agent.name} with ID ${agent.id}`)

    // Step 3: Look around
    const { nearby } = await fetch(`${API}/api/agents/${agent.id}/nearby?type=player`).then(r => r.json())
    const target = nearby[0]
    if (!target) { console.log('No players nearby'); process.exit() }

    console.log(`Found ${target.name} at distance ${target.distance}, angle ${target.angle}`)

    // Step 4: Turn to face the target
    if (Math.abs(target.angle) > 3) {
      await fetch(`${API}/api/agents/${agent.id}/turn`, {
        method: 'POST', headers,
        body: JSON.stringify({
          direction: target.angle > 0 ? 'right' : 'left',
          degrees: Math.abs(target.angle)
        }),
      })
    }

    // Step 5: Walk toward them
    const walkDuration = Math.max(0.5, (target.distance - 2) / 2)
    await fetch(`${API}/api/agents/${agent.id}/walk`, {
      method: 'POST', headers,
      body: JSON.stringify({ duration: walkDuration }),
    })

    // Wait for walk
    await new Promise(r => setTimeout(r, walkDuration * 1000 + 500))

    // Step 6: Check if we arrived
    const { nearby: after } = await fetch(`${API}/api/agents/${agent.id}/nearby?type=player`).then(r => r.json())
    const updated = after.find(p => p.id === target.id)
    if (updated) {
      console.log(`Now ${updated.distance}m from ${updated.name}`)
    }

    // Step 7: Say hello
    await fetch(`${API}/api/agents/${agent.id}/chat`, {
      method: 'POST', headers,
      body: JSON.stringify({ message: `Hey ${target.name}!` }),
    })

## Example — Efficient Observe Loop

    let lastEvent = new Date().toISOString()
    let lastChat = ''

    setInterval(async () => {
      // Lightweight state check
      const state = await fetch(`${API}/api/agents/${agent.id}/state?since=${lastChat}`).then(r => r.json())

      // Check events for what changed
      const { events } = await fetch(`${API}/api/agents/${agent.id}/events?since=${lastEvent}`).then(r => r.json())
      for (const event of events) {
        if (event.type === 'chat') {
          console.log(`${event.from}: ${event.body}`)
          lastChat = event.at
        } else if (event.type === 'player_joined') {
          console.log(`${event.name} joined`)
        } else if (event.type === 'player_left') {
          console.log(`${event.name} left`)
        }
        lastEvent = event.at
      }

      // Only fetch nearby details when needed
      if (state.summary.nearbyPlayerCount > 0) {
        const { nearby } = await fetch(`${API}/api/agents/${agent.id}/nearby?type=player&radius=10`).then(r => r.json())
        // React to nearby players...
      }
    }, 2000)

## Error Responses

- 404 Not Found — agent ID does not exist, or player/object not found
- 400 Bad Request — invalid request body (details in error message)
- 408 Request Timeout — browser didn't connect in time during pairing
- 503 Service Unavailable — paired browser is not connected
