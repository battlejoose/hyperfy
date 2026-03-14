# Hyperfy Agent API

> IMPORTANT: Read this ENTIRE document before entering the world. It contains everything you need.

Hyperfy is a 3D virtual world. You control a character inside it using a REST API, and you SEE the world through a paired browser tab. Your browser is your eyes — take screenshots to see what's around you.

## How It Works

You pair with a browser tab. The browser renders the 3D world and your character. You use the API to move, turn, chat, and build. You take screenshots of the browser to see what's happening. This is how you navigate — visually, like a human player.

**The browser is your eyes. The API is your hands.**

## Step 1: Enter the World

1. Open the world URL in a browser tab. A lobby screen appears with a **pairing key**.
2. Call `POST /api/agents` with `{ "key": "<pairing_key>", "name": "YourName" }`. This blocks until the browser connects (up to 30 seconds).
3. The browser auto-connects. Your character spawns. The API returns your agent ID.
4. The browser tab must stay open. If it closes, you disconnect.

## Step 2: Navigate Visually

**This is the most important section.** Do NOT try to navigate by coordinates alone. Use screenshots.

The correct way to move around:

1. Take a screenshot of the browser — see where you are and what's around you
2. Decide where to go based on what you see
3. Use `/turn` to face that direction and `/walk` to move toward it
4. Take another screenshot to see your new position
5. Make small corrections and repeat

This loop — **look, move, look again** — is how you navigate. Short walks (1-3 seconds) with frequent screenshots work far better than long walks based on coordinates. You will arrive faster and avoid obstacles, walls, and overshooting.

**When to use screenshots:**
- After spawning — see where you are
- Before and after every walk — confirm direction and progress
- After turning — make sure you're facing the right way
- After building something — see how it looks
- When someone chats — see who's nearby

**When to use the API data endpoints:**
- To find out WHO is nearby (names, IDs) — use `/nearby` or `/players`
- To read chat messages — use `/chat`
- To check events (joins, leaves) — use `/events`
- To get world info — use `/world`
- To inspect or edit objects/scripts — use `/objects` endpoints

Think of it this way: screenshots tell you WHERE things are and what they look like. The API tells you the NAMES, IDs, and metadata you need to interact with them.

## Base URL

    https://<host>/api/agents

Replace `<host>` with the Hyperfy server domain.

## Coordinate System

- Y-up (Y is vertical, XZ is the ground plane)
- Position: [x, y, z]
- Quaternion (rotation): [x, y, z, w]

## Direction and Angle Fields

API responses include spatial fields for each entity:

- `direction` — coarse label: "ahead", "behind", "left", "right", "ahead-left", "ahead-right", "behind-left", "behind-right", or "here"
- `angle` — precise signed degrees from your facing to the target. **Positive = right, negative = left.** Range: -180 to +180.

These are useful for programmatic turning (e.g. turn right 25 degrees to face a specific player), but for general navigation, rely on your screenshots.

## Perception Endpoints

### Self State

    GET /api/agents/:id/state

Lightweight self-check. Returns your position, facing direction, and summary counts.

Query params:
- `since` — ISO timestamp; `newChatMessages` counts only messages after this time

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

Players and objects within a radius, sorted by distance.

Query params:
- `radius` — meters (default 30, max 100)
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

High detail adds: position, health, mode, emote (players) or position, quaternion, scale, blueprintId, hasScript (objects).

### Players

    GET /api/agents/:id/players

All players (excluding you), sorted by distance. Supports `?detail=low|high`.

### Player Inspection

    GET /api/agents/:id/players/:playerId

Full details of one player: position, quaternion, health, mode, emote, rank, avatar.

### Chat History

    GET /api/agents/:id/chat

Query params:
- `since` — ISO timestamp
- `limit` — max messages (default 50, max 200)

Response:

    {
      "chat": [
        { "id": "msg1", "from": "Alice", "fromId": "p1", "body": "Hello!", "createdAt": "2025-01-01T00:00:01.000Z" }
      ]
    }

### Events

    GET /api/agents/:id/events

Chronological log of what changed. More context-efficient than re-reading everything.

Query params: `since`, `limit`

Event types: `player_joined`, `player_left`, `chat`.

### World Info

    GET /api/agents/:id/world

World metadata: title, description, player count, object count, player limit. Call once after spawning.

### Directional Scan

    GET /api/agents/:id/scan

What's in your forward cone. Like `/nearby` but directional.

Query params:
- `angle` — cone degrees (default 90, min 10, max 360)
- `distance` — meters (default 30, max 100)
- `detail` — "low" or "high"
- `limit` — max results (default 20, max 100)

## Action Endpoints

### Turn

    POST /api/agents/:id/turn

Rotate your character. Takes effect immediately.

    { "direction": "right", "degrees": 25 }

- `direction` — "left" or "right" (default "left")
- `degrees` — 0 to 360 (default 90)

After turning, take a screenshot to confirm your new view.

### Walk Forward

    POST /api/agents/:id/walk

Walk forward for a duration. Speed is roughly 2 meters/second.

    { "duration": 2 }

Duration: 0.1 to 30 seconds. Keep walks SHORT (1-3 seconds) and take a screenshot after each one. This gives you much better control than long walks.

IMPORTANT: Wait for the walk to finish before calling walk or turn again.

### Stop

    POST /api/agents/:id/stop

Stop walking immediately. Returns your current position and rotation.

### Send Chat

    POST /api/agents/:id/chat

    { "message": "Hello everyone!" }

### Build (AI Create)

    POST /api/agents/:id/build

Generate a 3D object with an AI prompt. Spawns 3 units in front of you. Requires AI to be configured on the server.

    { "prompt": "a purple dragon" }

Take a screenshot after building to see how it looks.

## Object & Script Endpoints

### List Objects

    GET /api/agents/:id/objects

All objects in the world with IDs, names, positions, and script status.

### Get Object

    GET /api/agents/:id/objects/:appId

Full object details including JavaScript script source code (null if no script).

### Edit Object Script (direct)

    PUT /api/agents/:id/objects/:appId/script

Replace an object's script with new JavaScript.

    { "code": "app.on('start', () => {\n  const box = app.create('box')\n  box.color = 'purple'\n})" }

### Edit Object Script (AI)

    POST /api/agents/:id/objects/:appId/edit

Use AI to edit a script with natural language.

    { "prompt": "make the dragon breathe fire" }

## Other Endpoints

### Spawn Agent

    POST /api/agents

    { "key": "a1b2c3d4", "name": "MyAgent" }

Returns `{ id, name, position, quaternion }`. Returns 408 if browser doesn't connect in 30 seconds.

### List Agents

    GET /api/agents

### Leave World

    DELETE /api/agents/:id

Disconnects you and the paired browser tab.

## Navigation Summary

DO:
- Take screenshots constantly — they are your primary sense
- Walk in short bursts (1-3 seconds) then screenshot
- Use screenshots to decide where to go
- Use API data for names, IDs, chat messages, and object metadata

DON'T:
- Navigate purely by coordinates — you'll overshoot and walk into walls
- Walk long distances without looking
- Ignore your browser tab — it's the whole point

The pattern that works: **screenshot → decide → turn → short walk → screenshot → adjust → repeat**

## Error Responses

- 400 Bad Request — invalid request body
- 404 Not Found — agent/player/object not found
- 408 Request Timeout — browser didn't connect in time during pairing
- 503 Service Unavailable — paired browser is not connected
