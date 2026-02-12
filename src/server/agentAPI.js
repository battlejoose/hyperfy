import moment from 'moment'
import { uuid } from '../core/utils.js'

const HEALTH_MAX = 100

/**
 * Agent REST API
 *
 * Allows AI agents to enter the world, move around, and chat via simple HTTP requests.
 * Agents appear as regular player entities to all connected clients.
 */
export default async function agentAPI(fastify, { world }) {
  const agents = new Map() // agentId -> { entity, name }

  console.log('[agent-api] agent API enabled')

  // Get spawn position from server network
  function getSpawn() {
    const spawn = world.network.spawn
    return {
      position: spawn.position.slice(),
      quaternion: spawn.quaternion.slice(),
    }
  }

  // POST /api/agents — Spawn an agent into the world
  fastify.post('/api/agents', async (req, reply) => {
    const { name = 'Agent', avatar } = req.body || {}
    const id = uuid()
    const spawn = getSpawn()

    // Create player entity on the server (same pattern as ServerNetwork.onConnection)
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

    agents.set(id, { entity, name })

    // Emit enter event
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

    // Collect all players in the world (both real players and agents)
    const players = []
    for (const [, player] of world.entities.players) {
      if (player.data.id === req.params.id) continue // exclude self
      players.push({
        id: player.data.id,
        name: player.data.name,
        position: player.data.position,
      })
    }

    // Get chat messages, optionally filtered by timestamp
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

  // POST /api/agents/:id/move — Set agent position and rotation
  fastify.post('/api/agents/:id/move', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const entity = agent.entity
    const { position, quaternion } = req.body || {}

    if (!position || !Array.isArray(position) || position.length !== 3) {
      return reply.code(400).send({ error: 'position must be an array of [x, y, z]' })
    }

    // Build the entity modification data (same shorthand keys as PlayerRemote.modify)
    const data = {
      id: entity.data.id,
      p: position,
    }

    if (quaternion && Array.isArray(quaternion) && quaternion.length === 4) {
      data.q = quaternion
    }

    // Update entity on the server
    entity.data.position = position
    if (data.q) {
      entity.data.quaternion = quaternion
    }

    // Broadcast to all connected clients
    world.network.send('entityModified', data)

    return {
      position: entity.data.position,
      quaternion: entity.data.quaternion,
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

    // Add to chat system and broadcast to all clients
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

    // Destroy entity and broadcast removal to all clients
    agent.entity.destroy(true)
    agents.delete(req.params.id)

    return { success: true }
  })
}
