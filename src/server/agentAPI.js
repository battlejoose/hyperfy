import moment from 'moment'
import { uuid } from '../core/utils.js'

const HEALTH_MAX = 100
const TICK_RATE = 1 / 8 // 8Hz, matches game networkRate
const WALK_SPEED = 3 // units per second
const RUN_SPEED = 6 // units per second

// Locomotion modes (must match PlayerLocal.js)
const Modes = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
}

// Direction name -> local axis (relative to player facing)
const Directions = {
  forward: [0, 0, -1],
  backward: [0, 0, 1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
}

/**
 * Agent REST API
 *
 * Allows AI agents to enter the world, move around, and chat via simple HTTP requests.
 * Agents appear as regular player entities to all connected clients.
 */
export default async function agentAPI(fastify, { world }) {
  // agentId -> { entity, name, yaw, movement }
  const agents = new Map()

  console.log('[agent-api] agent API enabled')

  // --- Helpers ---

  function getSpawn() {
    const spawn = world.network.spawn
    return {
      position: spawn.position.slice(),
      quaternion: spawn.quaternion.slice(),
    }
  }

  function yawToQuaternion(yaw) {
    return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]
  }

  function quaternionToYaw(q) {
    // Extract Y rotation from quaternion [x, y, z, w]
    return 2 * Math.atan2(q[1], q[3])
  }

  // Rotate a local direction [x, 0, z] by yaw around Y axis
  function rotateByYaw(axis, yaw) {
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    return [
      axis[0] * cos + axis[2] * sin,
      0,
      -axis[0] * sin + axis[2] * cos,
    ]
  }

  function getGazeFromYaw(yaw) {
    // Forward direction in world space
    return [Math.sin(yaw), 0, -Math.cos(yaw)]
  }

  function broadcastAgent(agent) {
    const entity = agent.entity
    const mode = agent.movement ? agent.movement.mode : Modes.IDLE
    const axis = agent.movement ? agent.movement.axis : [0, 0, 0]
    const gaze = getGazeFromYaw(agent.yaw)
    const q = yawToQuaternion(agent.yaw)

    entity.data.quaternion = q

    world.network.send('entityModified', {
      id: entity.data.id,
      p: entity.data.position,
      q,
      m: mode,
      a: axis,
      g: gaze,
    })
  }

  function stopAgent(agent) {
    agent.movement = null
    broadcastAgent(agent)
  }

  // --- Movement tick at 8Hz ---

  const tickInterval = setInterval(() => {
    const now = performance.now()
    for (const [, agent] of agents) {
      const mv = agent.movement
      if (!mv) continue

      // Check if duration expired
      if (now >= mv.endTime) {
        stopAgent(agent)
        continue
      }

      // Calculate elapsed since last tick
      const elapsed = (now - mv.lastTick) / 1000 // seconds
      mv.lastTick = now

      // Move in world-space direction
      const worldDir = rotateByYaw(mv.axis, agent.yaw)
      const pos = agent.entity.data.position
      pos[0] += worldDir[0] * mv.speed * elapsed
      pos[1] += worldDir[1] * mv.speed * elapsed
      pos[2] += worldDir[2] * mv.speed * elapsed

      broadcastAgent(agent)
    }
  }, TICK_RATE * 1000)

  // Clean up on server shutdown
  fastify.addHook('onClose', () => {
    clearInterval(tickInterval)
  })

  // --- Endpoints ---

  // POST /api/agents — Spawn an agent into the world
  fastify.post('/api/agents', async (req, reply) => {
    const { name = 'Agent', avatar } = req.body || {}
    const id = uuid()
    const spawn = getSpawn()

    const entity = world.entities.add(
      {
        id,
        type: 'player',
        position: spawn.position,
        quaternion: spawn.quaternion,
        owner: id,
        userId: id,
        name,
        health: HEALTH_MAX,
        avatar: avatar || world.settings.avatar?.url || 'asset://avatar.vrm',
        sessionAvatar: null,
        rank: 0,
        enteredAt: Date.now(),
      },
      true
    )

    const yaw = quaternionToYaw(spawn.quaternion)
    agents.set(id, { entity, name, yaw, movement: null })

    world.events.emit('enter', { playerId: id })

    return {
      id,
      name,
      position: spawn.position,
      quaternion: spawn.quaternion,
    }
  })

  // GET /api/agents — List all active agents
  fastify.get('/api/agents', async (req, reply) => {
    const list = []
    for (const [id, agent] of agents) {
      list.push({
        id,
        name: agent.name,
        position: agent.entity.data.position,
      })
    }
    return { agents: list }
  })

  // GET /api/agents/:id — Get agent state + world observations
  fastify.get('/api/agents/:id', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const entity = agent.entity
    const since = req.query.since ? new Date(req.query.since) : null

    const players = []
    for (const [, player] of world.entities.players) {
      if (player.data.id === req.params.id) continue
      players.push({
        id: player.data.id,
        name: player.data.name,
        position: player.data.position,
      })
    }

    let chat = world.chat.msgs
    if (since) {
      chat = chat.filter(msg => new Date(msg.createdAt) > since)
    }

    return {
      id: entity.data.id,
      name: entity.data.name,
      position: entity.data.position,
      quaternion: entity.data.quaternion,
      players,
      chat: chat.map(msg => ({
        id: msg.id,
        from: msg.from,
        fromId: msg.fromId,
        body: msg.body,
        createdAt: msg.createdAt,
      })),
    }
  })

  // POST /api/agents/:id/walk — Walk in a direction for a duration
  fastify.post('/api/agents/:id/walk', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const { direction = 'forward', duration = 1, run = false } = req.body || {}

    const axis = Directions[direction]
    if (!axis) {
      return reply.code(400).send({
        error: `direction must be one of: ${Object.keys(Directions).join(', ')}`,
      })
    }

    if (typeof duration !== 'number' || duration <= 0 || duration > 30) {
      return reply.code(400).send({ error: 'duration must be a number between 0 and 30 seconds' })
    }

    const now = performance.now()
    agent.movement = {
      axis: axis.slice(),
      speed: run ? RUN_SPEED : WALK_SPEED,
      mode: run ? Modes.RUN : Modes.WALK,
      endTime: now + duration * 1000,
      lastTick: now,
    }

    // Broadcast immediately so animation starts right away
    broadcastAgent(agent)

    return {
      direction,
      duration,
      run,
      speed: agent.movement.speed,
    }
  })

  // POST /api/agents/:id/turn — Turn the agent left or right
  fastify.post('/api/agents/:id/turn', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const { direction = 'left', degrees = 90 } = req.body || {}

    if (direction !== 'left' && direction !== 'right') {
      return reply.code(400).send({ error: 'direction must be "left" or "right"' })
    }

    if (typeof degrees !== 'number' || degrees <= 0 || degrees > 360) {
      return reply.code(400).send({ error: 'degrees must be a number between 0 and 360' })
    }

    const radians = (degrees * Math.PI) / 180
    agent.yaw += direction === 'left' ? radians : -radians

    // Update entity quaternion and broadcast
    agent.entity.data.quaternion = yawToQuaternion(agent.yaw)
    broadcastAgent(agent)

    return {
      direction,
      degrees,
      quaternion: agent.entity.data.quaternion,
    }
  })

  // POST /api/agents/:id/stop — Stop walking immediately
  fastify.post('/api/agents/:id/stop', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    stopAgent(agent)

    return {
      position: agent.entity.data.position,
      quaternion: agent.entity.data.quaternion,
    }
  })

  // POST /api/agents/:id/move — Direct position set (teleport)
  fastify.post('/api/agents/:id/move', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const { position, quaternion } = req.body || {}

    if (!position || !Array.isArray(position) || position.length !== 3) {
      return reply.code(400).send({ error: 'position must be an array of [x, y, z]' })
    }

    // Stop any active movement
    agent.movement = null

    // Update position
    agent.entity.data.position = position

    // Update rotation if provided
    if (quaternion && Array.isArray(quaternion) && quaternion.length === 4) {
      agent.entity.data.quaternion = quaternion
      agent.yaw = quaternionToYaw(quaternion)
    }

    broadcastAgent(agent)

    return {
      position: agent.entity.data.position,
      quaternion: agent.entity.data.quaternion,
    }
  })

  // POST /api/agents/:id/chat — Send a chat message
  fastify.post('/api/agents/:id/chat', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const { message } = req.body || {}
    if (!message || typeof message !== 'string') {
      return reply.code(400).send({ error: 'message must be a non-empty string' })
    }

    const msg = {
      id: uuid(),
      from: agent.entity.data.name,
      fromId: agent.entity.data.id,
      body: message,
      createdAt: moment().toISOString(),
    }

    world.chat.add(msg, false)
    world.network.send('chatAdded', msg)

    return msg
  })

  // DELETE /api/agents/:id — Remove agent from the world
  fastify.delete('/api/agents/:id', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    agent.movement = null
    agent.entity.destroy(true)
    agents.delete(req.params.id)

    return { success: true }
  })
}
