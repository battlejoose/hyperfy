import moment from 'moment'
import { uuid } from '../core/utils.js'
import { createNodeClientWorld } from '../core/createNodeClientWorld.js'
import { storage } from '../core/storage.js'

/**
 * Agent REST API
 *
 * Allows AI agents to enter the world, walk around, and chat via simple HTTP requests.
 * Each agent runs a full node-client world internally, using the exact same movement
 * and animation system as real players.
 */
export default async function agentAPI(fastify, { world }) {
  // agentId -> { world, name, walkTimer }
  const agents = new Map()
  const wsUrl = `ws://localhost:${process.env.PORT}/ws`

  console.log('[agent-api] agent API enabled')

  // Movement key names
  const directionKeys = {
    forward: 'keyW',
    backward: 'keyS',
    left: 'keyA',
    right: 'keyD',
  }

  function releaseAllMovement(agent) {
    for (const key of Object.values(directionKeys)) {
      agent.world.controls.simulateButton(key, false)
    }
    if (agent.walkTimer) {
      clearTimeout(agent.walkTimer)
      agent.walkTimer = null
    }
  }

  // --- Endpoints ---

  // POST /api/agents — Spawn an agent into the world
  fastify.post('/api/agents', async (req, reply) => {
    const { name = 'Agent', avatar } = req.body || {}

    // Create a node-client world for this agent (same system as real players)
    const agentWorld = createNodeClientWorld()

    // Clear authToken so this agent gets a fresh identity
    storage.set('authToken', null)

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        agentWorld.destroy()
        reject(new Error('Agent spawn timed out'))
      }, 15000)

      agentWorld.once('ready', () => {
        clearTimeout(timeout)
        const player = agentWorld.entities.player
        resolve({
          id: agentWorld.network.id,
          name: player.data.name,
          position: player.data.position.slice(),
          quaternion: player.data.quaternion.slice(),
        })
      })

      agentWorld.on('kick', () => {
        clearTimeout(timeout)
        agentWorld.destroy()
        reject(new Error('Agent was kicked'))
      })

      agentWorld.init({ wsUrl, name, avatar })
    })

    agents.set(result.id, { world: agentWorld, name, walkTimer: null })

    return result
  })

  // GET /api/agents — List all active agents
  fastify.get('/api/agents', async (req, reply) => {
    const list = []
    for (const [id, agent] of agents) {
      const entity = world.entities.get(id)
      list.push({
        id,
        name: agent.name,
        position: entity?.data.position || [0, 0, 0],
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

    // Read from the server world for authoritative state
    const entity = world.entities.get(req.params.id)
    if (!entity) {
      return reply.code(404).send({ error: 'Agent entity not found' })
    }

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

    const { direction = 'forward', duration = 1 } = req.body || {}

    const key = directionKeys[direction]
    if (!key) {
      return reply.code(400).send({
        error: `direction must be one of: ${Object.keys(directionKeys).join(', ')}`,
      })
    }

    if (typeof duration !== 'number' || duration <= 0 || duration > 30) {
      return reply.code(400).send({ error: 'duration must be a number between 0 and 30 seconds' })
    }

    // Release any existing movement first
    releaseAllMovement(agent)

    // Press the movement key
    agent.world.controls.simulateButton(key, true)

    // Schedule key release after duration
    agent.walkTimer = setTimeout(() => {
      agent.world.controls.simulateButton(key, false)
      agent.walkTimer = null
    }, duration * 1000)

    return { direction, duration }
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

    const player = agent.world.entities.player
    const radians = (degrees * Math.PI) / 180
    player.cam.rotation.y += direction === 'left' ? radians : -radians

    return { direction, degrees }
  })

  // POST /api/agents/:id/stop — Stop walking immediately
  fastify.post('/api/agents/:id/stop', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    releaseAllMovement(agent)

    const entity = world.entities.get(req.params.id)
    return {
      position: entity?.data.position || [0, 0, 0],
      quaternion: entity?.data.quaternion || [0, 0, 0, 1],
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

    // Use the agent's own chat system (same as real players)
    agent.world.chat.send(message)

    return {
      from: agent.name,
      body: message,
      createdAt: moment().toISOString(),
    }
  })

  // POST /api/agents/:id/build — Create a 3D object with an AI prompt
  fastify.post('/api/agents/:id/build', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const { prompt } = req.body || {}
    if (!prompt || typeof prompt !== 'string') {
      return reply.code(400).send({ error: 'prompt must be a non-empty string' })
    }

    // Check if AI is enabled on this server
    if (!world.ai || !world.ai.enabled) {
      return reply.code(400).send({ error: 'AI generation is not enabled on this server (set AI_PROVIDER, AI_MODEL, AI_API_KEY in .env)' })
    }

    // Get agent entity for position
    const entity = world.entities.get(req.params.id)
    if (!entity) {
      return reply.code(404).send({ error: 'Agent entity not found' })
    }

    // Calculate spawn position (3 units in front of agent)
    const pos = entity.data.position
    const [qx, qy, qz, qw] = entity.data.quaternion
    // Rotate [0, 0, -1] (forward) by the agent's quaternion
    const fx = -2 * (qx * qz + qw * qy)
    const fz = -(1 - 2 * (qx * qx + qy * qy))
    const spawnPos = [pos[0] + fx * 3, pos[1], pos[2] + fz * 3]

    // Create blueprint (same structure as ClientAI.create)
    const blueprintId = uuid()
    const blueprint = {
      id: blueprintId,
      version: 0,
      name: 'Model',
      image: null,
      author: 'AI Agent',
      url: null,
      desc: null,
      model: 'asset://ai.glb',
      script: 'asset://ai.js',
      props: {
        prompt: prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt,
        createdAt: world.network.getTime(),
      },
      preload: false,
      public: false,
      locked: false,
      unique: false,
      disabled: false,
    }

    // Add blueprint on server and broadcast to all clients
    world.blueprints.add(blueprint)
    world.network.send('blueprintAdded', blueprint)
    world.network.dirtyBlueprints.add(blueprint.id)

    // Create entity (app) at position in front of agent
    const appId = uuid()
    const appData = {
      id: appId,
      type: 'app',
      blueprint: blueprintId,
      position: spawnPos,
      quaternion: entity.data.quaternion.slice(),
      scale: [1, 1, 1],
      mover: null,
      uploader: null,
      pinned: false,
      state: {},
    }
    world.entities.add(appData)
    world.network.send('entityAdded', appData)
    world.network.dirtyApps.add(appId)

    // Trigger AI code generation (runs in background)
    world.ai.onAction({
      name: 'create',
      blueprintId,
      appId,
      prompt,
    })

    return {
      blueprintId,
      appId,
      prompt,
      position: spawnPos,
    }
  })

  // DELETE /api/agents/:id — Remove agent from the world
  fastify.delete('/api/agents/:id', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    releaseAllMovement(agent)
    agent.world.destroy()
    agents.delete(req.params.id)

    return { success: true }
  })
}
