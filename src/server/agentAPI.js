import moment from 'moment'
import { uuid } from '../core/utils.js'
import { hashFile } from '../core/utils-server.js'
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
  // agentId -> { world, name, walkTimer, lastActivity, events, eventCleanups }
  const agents = new Map()
  const wsUrl = `ws://localhost:${process.env.PORT}/ws`
  const INACTIVITY_TIMEOUT = 60 * 1000
  const MAX_EVENTS = 200

  const MODE_NAMES = ['idle', 'walking', 'running', 'jumping', 'falling', 'flying', 'talking']

  console.log('[agent-api] agent API enabled')

  function releaseAllMovement(agent) {
    agent.world.controls.simulateButton('keyW', false)
    if (agent.walkTimer) {
      clearTimeout(agent.walkTimer)
      agent.walkTimer = null
    }
  }

  function removeAgent(id) {
    const agent = agents.get(id)
    if (!agent) return
    releaseAllMovement(agent)
    teardownEventListeners(agent)
    agent.world.destroy()
    agents.delete(id)
    console.log(`[agent-api] agent ${id} removed`)
  }

  function touchAgent(agent) {
    agent.lastActivity = Date.now()
  }

  // --- Event ring buffer ---

  function pushEvent(agent, event) {
    event.at = moment().toISOString()
    agent.events.push(event)
    if (agent.events.length > MAX_EVENTS) {
      agent.events.shift()
    }
  }

  function setupEventListeners(agent, agentId) {
    const onEnter = ({ playerId }) => {
      if (playerId === agentId) return
      const player = world.entities.getPlayer(playerId)
      pushEvent(agent, { type: 'player_joined', id: playerId, name: player?.data.name || 'Unknown' })
    }
    const onLeave = ({ playerId }) => {
      if (playerId === agentId) return
      const player = world.entities.getPlayer(playerId)
      pushEvent(agent, { type: 'player_left', id: playerId, name: player?.data.name || 'Unknown' })
    }
    const onChat = (msg) => {
      if (msg.fromId === agentId) return
      pushEvent(agent, { type: 'chat', from: msg.from, fromId: msg.fromId, body: msg.body })
    }

    world.events.on('enter', onEnter)
    world.events.on('leave', onLeave)
    world.events.on('chat', onChat)

    agent.eventCleanups = () => {
      world.events.off('enter', onEnter)
      world.events.off('leave', onLeave)
      world.events.off('chat', onChat)
    }
  }

  function teardownEventListeners(agent) {
    if (agent.eventCleanups) {
      agent.eventCleanups()
      agent.eventCleanups = null
    }
  }

  // --- Spatial awareness helpers ---

  function getForwardVector(quaternion) {
    const [qx, qy, qz, qw] = quaternion
    const fx = -2 * (qx * qz + qw * qy)
    const fz = -(1 - 2 * (qx * qx + qy * qy))
    return [fx, fz]
  }

  function getDistance(a, b) {
    const dx = b[0] - a[0]
    const dz = b[2] - a[2]
    return Math.round(Math.sqrt(dx * dx + dz * dz) * 10) / 10
  }

  function getDotProduct(agentPos, forward, targetPos) {
    const dx = targetPos[0] - agentPos[0]
    const dz = targetPos[2] - agentPos[2]
    const len = Math.sqrt(dx * dx + dz * dz)
    if (len < 0.01) return 1
    const nx = dx / len
    const nz = dz / len
    return forward[0] * nx + forward[1] * nz
  }

  function getRelativeDirection(agentPos, forward, targetPos) {
    const dx = targetPos[0] - agentPos[0]
    const dz = targetPos[2] - agentPos[2]
    const len = Math.sqrt(dx * dx + dz * dz)
    if (len < 0.01) return 'here'
    const nx = dx / len
    const nz = dz / len
    // dot product: positive = ahead, negative = behind
    const dot = forward[0] * nx + forward[1] * nz
    // cross product (2D): positive = right, negative = left
    const cross = forward[0] * nz - forward[1] * nx
    const fb = dot > 0.4 ? 'ahead' : dot < -0.4 ? 'behind' : ''
    const lr = cross > 0.4 ? 'right' : cross < -0.4 ? 'left' : ''
    if (fb && lr) return `${fb}-${lr}`
    if (fb) return fb
    if (lr) return lr
    return 'ahead'
  }

  function getCompassFacing(forward) {
    const angle = Math.atan2(-forward[0], -forward[1])
    const deg = ((angle * 180) / Math.PI + 360) % 360
    if (deg < 22.5 || deg >= 337.5) return 'north'
    if (deg < 67.5) return 'north-west'
    if (deg < 112.5) return 'west'
    if (deg < 157.5) return 'south-west'
    if (deg < 202.5) return 'south'
    if (deg < 247.5) return 'south-east'
    if (deg < 292.5) return 'east'
    return 'north-east'
  }

  function getModeName(mode) {
    return MODE_NAMES[mode] || 'idle'
  }

  // --- Shared entity helpers for building response objects ---

  function buildPlayerInfo(player, agentPos, forward, detail) {
    const dist = getDistance(agentPos, player.data.position)
    const info = {
      id: player.data.id,
      type: 'player',
      name: player.data.name,
      distance: dist,
      direction: getRelativeDirection(agentPos, forward, player.data.position),
    }
    if (detail === 'high') {
      info.position = player.data.position
      info.health = player.data.health ?? 100
      info.mode = getModeName(player.data.mode ?? 0)
      info.emote = player.data.emote || null
    }
    return info
  }

  function buildObjectInfo(item, blueprint, agentPos, forward, detail) {
    const dist = getDistance(agentPos, item.data.position)
    const info = {
      id: item.data.id,
      type: 'object',
      name: blueprint?.name || 'Unknown',
      distance: dist,
      direction: getRelativeDirection(agentPos, forward, item.data.position),
    }
    if (detail === 'high') {
      info.position = item.data.position
      info.quaternion = item.data.quaternion
      info.scale = item.data.scale
      info.blueprintId = item.data.blueprint
      info.hasScript = !!blueprint?.script
    }
    return info
  }

  // --- Lifecycle ---

  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [id, agent] of agents) {
      if (now - agent.lastActivity > INACTIVITY_TIMEOUT) {
        console.log(`[agent-api] agent ${id} timed out (no activity for ${INACTIVITY_TIMEOUT / 1000}s)`)
        removeAgent(id)
      }
    }
  }, 10000)

  fastify.addHook('onClose', () => {
    clearInterval(cleanupInterval)
    for (const [id] of agents) {
      removeAgent(id)
    }
  })

  fastify.addHook('preHandler', (req, reply, done) => {
    const id = req.params?.id
    if (id) {
      const agent = agents.get(id)
      if (agent) touchAgent(agent)
    }
    done()
  })

  // --- Endpoints ---

  // POST /api/agents — Spawn an agent into the world
  fastify.post('/api/agents', async (req, reply) => {
    const { name = 'Agent', avatar } = req.body || {}

    const agentWorld = createNodeClientWorld()
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

    const agent = { world: agentWorld, name, walkTimer: null, lastActivity: Date.now(), events: [], eventCleanups: null }
    agents.set(result.id, agent)
    setupEventListeners(agent, result.id)

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

  // =====================
  // PERCEPTION ENDPOINTS
  // =====================

  // GET /api/agents/:id/state — Lightweight self-state + summary counts
  fastify.get('/api/agents/:id/state', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const entity = world.entities.get(req.params.id)
    if (!entity) {
      return reply.code(404).send({ error: 'Agent entity not found' })
    }

    const forward = getForwardVector(entity.data.quaternion)

    const since = req.query.since ? new Date(req.query.since) : null

    let nearbyPlayerCount = 0
    for (const [, player] of world.entities.players) {
      if (player.data.id === req.params.id) continue
      nearbyPlayerCount++
    }

    let nearbyObjectCount = 0
    for (const [, item] of world.entities.items) {
      if (item.isApp) nearbyObjectCount++
    }

    let newChatMessages = world.chat.msgs.length
    if (since) {
      newChatMessages = world.chat.msgs.filter(msg => new Date(msg.createdAt) > since).length
    }

    return {
      id: entity.data.id,
      name: entity.data.name,
      position: entity.data.position,
      facing: getCompassFacing(forward),
      summary: {
        nearbyPlayerCount,
        nearbyObjectCount,
        newChatMessages,
      },
    }
  })

  // GET /api/agents/:id/nearby — Nearby entities with filtering
  fastify.get('/api/agents/:id/nearby', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const entity = world.entities.get(req.params.id)
    if (!entity) {
      return reply.code(404).send({ error: 'Agent entity not found' })
    }

    const radius = Math.min(Math.max(parseFloat(req.query.radius) || 30, 1), 100)
    const type = req.query.type || 'all'
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100)
    const detail = req.query.detail === 'high' ? 'high' : 'low'

    const agentPos = entity.data.position
    const forward = getForwardVector(entity.data.quaternion)

    const results = []

    if (type === 'all' || type === 'player') {
      for (const [, player] of world.entities.players) {
        if (player.data.id === req.params.id) continue
        const dist = getDistance(agentPos, player.data.position)
        if (dist <= radius) {
          results.push(buildPlayerInfo(player, agentPos, forward, detail))
        }
      }
    }

    if (type === 'all' || type === 'object') {
      for (const [, item] of world.entities.items) {
        if (!item.isApp) continue
        const dist = getDistance(agentPos, item.data.position)
        if (dist <= radius) {
          const blueprint = world.blueprints.get(item.data.blueprint)
          results.push(buildObjectInfo(item, blueprint, agentPos, forward, detail))
        }
      }
    }

    results.sort((a, b) => a.distance - b.distance)
    if (results.length > limit) results.length = limit

    return { nearby: results }
  })

  // GET /api/agents/:id/players — All players with detail levels
  fastify.get('/api/agents/:id/players', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const entity = world.entities.get(req.params.id)
    if (!entity) {
      return reply.code(404).send({ error: 'Agent entity not found' })
    }

    const detail = req.query.detail === 'high' ? 'high' : 'low'
    const agentPos = entity.data.position
    const forward = getForwardVector(entity.data.quaternion)

    const players = []
    for (const [, player] of world.entities.players) {
      if (player.data.id === req.params.id) continue
      players.push(buildPlayerInfo(player, agentPos, forward, detail))
    }
    players.sort((a, b) => a.distance - b.distance)

    return { players }
  })

  // GET /api/agents/:id/players/:playerId — Full details for one player
  fastify.get('/api/agents/:id/players/:playerId', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const entity = world.entities.get(req.params.id)
    if (!entity) {
      return reply.code(404).send({ error: 'Agent entity not found' })
    }

    const player = world.entities.getPlayer(req.params.playerId)
    if (!player) {
      return reply.code(404).send({ error: 'Player not found' })
    }

    const agentPos = entity.data.position
    const forward = getForwardVector(entity.data.quaternion)
    const dist = getDistance(agentPos, player.data.position)

    return {
      id: player.data.id,
      name: player.data.name,
      distance: dist,
      direction: getRelativeDirection(agentPos, forward, player.data.position),
      position: player.data.position,
      quaternion: player.data.quaternion,
      health: player.data.health ?? 100,
      mode: getModeName(player.data.mode ?? 0),
      emote: player.data.emote || null,
      rank: player.data.rank || 'member',
      avatar: player.data.sessionAvatar || player.data.avatar || null,
    }
  })

  // GET /api/agents/:id/chat — Chat history with since/limit filtering
  fastify.get('/api/agents/:id/chat', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const since = req.query.since ? new Date(req.query.since) : null
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200)

    let msgs = world.chat.msgs
    if (since) {
      msgs = msgs.filter(msg => new Date(msg.createdAt) > since)
    }
    if (msgs.length > limit) {
      msgs = msgs.slice(msgs.length - limit)
    }

    return {
      chat: msgs.map(msg => ({
        id: msg.id,
        from: msg.from,
        fromId: msg.fromId,
        body: msg.body,
        createdAt: msg.createdAt,
      })),
    }
  })

  // GET /api/agents/:id/events — Event log since timestamp
  fastify.get('/api/agents/:id/events', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const since = req.query.since ? new Date(req.query.since) : null
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200)

    let events = agent.events
    if (since) {
      events = events.filter(e => new Date(e.at) > since)
    }
    if (events.length > limit) {
      events = events.slice(events.length - limit)
    }

    return { events }
  })

  // GET /api/agents/:id/world — World metadata
  fastify.get('/api/agents/:id/world', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    let playerCount = 0
    for (const [,] of world.entities.players) {
      playerCount++
    }

    let objectCount = 0
    for (const [, item] of world.entities.items) {
      if (item.isApp) objectCount++
    }

    return {
      title: world.settings.title || null,
      description: world.settings.desc || null,
      playerCount,
      objectCount,
      playerLimit: world.settings.playerLimit || null,
    }
  })

  // GET /api/agents/:id/scan — Directional cone scan
  fastify.get('/api/agents/:id/scan', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const entity = world.entities.get(req.params.id)
    if (!entity) {
      return reply.code(404).send({ error: 'Agent entity not found' })
    }

    const angle = Math.min(Math.max(parseFloat(req.query.angle) || 90, 10), 360)
    const distance = Math.min(Math.max(parseFloat(req.query.distance) || 30, 1), 100)
    const detail = req.query.detail === 'high' ? 'high' : 'low'
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100)

    const agentPos = entity.data.position
    const forward = getForwardVector(entity.data.quaternion)

    // Convert half-angle to dot product threshold: cos(angle/2)
    // At angle=360 we want everything (threshold = -1)
    const halfAngleRad = (angle / 2) * Math.PI / 180
    const dotThreshold = Math.cos(halfAngleRad)

    const results = []

    for (const [, player] of world.entities.players) {
      if (player.data.id === req.params.id) continue
      const dist = getDistance(agentPos, player.data.position)
      if (dist > distance) continue
      const dot = getDotProduct(agentPos, forward, player.data.position)
      if (dot >= dotThreshold) {
        results.push(buildPlayerInfo(player, agentPos, forward, detail))
      }
    }

    for (const [, item] of world.entities.items) {
      if (!item.isApp) continue
      const dist = getDistance(agentPos, item.data.position)
      if (dist > distance) continue
      const dot = getDotProduct(agentPos, forward, item.data.position)
      if (dot >= dotThreshold) {
        const blueprint = world.blueprints.get(item.data.blueprint)
        results.push(buildObjectInfo(item, blueprint, agentPos, forward, detail))
      }
    }

    results.sort((a, b) => a.distance - b.distance)
    if (results.length > limit) results.length = limit

    return { scan: results }
  })

  // =====================
  // ACTION ENDPOINTS
  // =====================

  // POST /api/agents/:id/walk — Walk forward for a duration
  fastify.post('/api/agents/:id/walk', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const { duration = 1 } = req.body || {}

    if (typeof duration !== 'number' || duration <= 0 || duration > 30) {
      return reply.code(400).send({ error: 'duration must be a number between 0 and 30 seconds' })
    }

    releaseAllMovement(agent)
    agent.world.controls.simulateButton('keyW', true)
    agent.walkTimer = setTimeout(() => {
      agent.world.controls.simulateButton('keyW', false)
      agent.walkTimer = null
    }, duration * 1000)

    return { duration }
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

    if (!world.ai || !world.ai.enabled) {
      return reply.code(400).send({ error: 'AI generation is not enabled on this server (set AI_PROVIDER, AI_MODEL, AI_API_KEY in .env)' })
    }

    const entity = world.entities.get(req.params.id)
    if (!entity) {
      return reply.code(404).send({ error: 'Agent entity not found' })
    }

    const pos = entity.data.position
    const [qx, qy, qz, qw] = entity.data.quaternion
    const fx = -2 * (qx * qz + qw * qy)
    const fz = -(1 - 2 * (qx * qx + qy * qy))
    const spawnPos = [pos[0] + fx * 3, pos[1], pos[2] + fz * 3]

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

    world.blueprints.add(blueprint)
    world.network.send('blueprintAdded', blueprint)
    world.network.dirtyBlueprints.add(blueprint.id)

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

  // --- Object / Script Endpoints ---

  // GET /api/agents/:id/objects — List all app objects in the world
  fastify.get('/api/agents/:id/objects', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const objects = []
    for (const [, entity] of world.entities.items) {
      if (!entity.isApp) continue
      const blueprint = world.blueprints.get(entity.data.blueprint)
      objects.push({
        id: entity.data.id,
        name: blueprint?.name || 'Unknown',
        blueprintId: entity.data.blueprint,
        position: entity.data.position,
        quaternion: entity.data.quaternion,
        scale: entity.data.scale,
        hasScript: !!blueprint?.script,
      })
    }

    return { objects }
  })

  // GET /api/agents/:id/objects/:appId — Get object details including script code
  fastify.get('/api/agents/:id/objects/:appId', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const entity = world.entities.get(req.params.appId)
    if (!entity || !entity.isApp) {
      return reply.code(404).send({ error: 'Object not found' })
    }

    const blueprint = world.blueprints.get(entity.data.blueprint)
    if (!blueprint) {
      return reply.code(404).send({ error: 'Blueprint not found' })
    }

    // Load the script code if available
    let code = null
    if (blueprint.script) {
      try {
        let script = world.loader.get('script', blueprint.script)
        if (!script) script = await world.loader.load('script', blueprint.script)
        code = script.code
      } catch (err) {
        console.error('[agent-api] failed to load script:', err.message)
      }
    }

    return {
      id: entity.data.id,
      name: blueprint.name,
      blueprintId: blueprint.id,
      position: entity.data.position,
      quaternion: entity.data.quaternion,
      scale: entity.data.scale,
      script: code,
    }
  })

  // PUT /api/agents/:id/objects/:appId/script — Write new script code to an object
  fastify.put('/api/agents/:id/objects/:appId/script', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const entity = world.entities.get(req.params.appId)
    if (!entity || !entity.isApp) {
      return reply.code(404).send({ error: 'Object not found' })
    }

    const { code } = req.body || {}
    if (!code || typeof code !== 'string') {
      return reply.code(400).send({ error: 'code must be a non-empty string containing the JavaScript script' })
    }

    const blueprint = world.blueprints.get(entity.data.blueprint)
    if (!blueprint) {
      return reply.code(404).send({ error: 'Blueprint not found' })
    }

    // Create file from code, hash it, and upload
    const file = new File([code], 'script.js', { type: 'text/plain' })
    const fileContent = await file.arrayBuffer()
    const hash = await hashFile(Buffer.from(fileContent))
    const filename = `${hash}.js`
    const url = `asset://${filename}`

    // Upload the script asset
    await world.ai.assets.upload(file)

    // Update the blueprint with the new script
    const version = blueprint.version + 1
    const change = { id: blueprint.id, version, script: url }
    world.blueprints.modify(change)
    world.network.send('blueprintModified', change)
    world.network.dirtyBlueprints.add(change.id)

    return {
      id: entity.data.id,
      blueprintId: blueprint.id,
      version,
      script: url,
    }
  })

  // POST /api/agents/:id/objects/:appId/edit — Use AI to edit an object's script
  fastify.post('/api/agents/:id/objects/:appId/edit', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    const entity = world.entities.get(req.params.appId)
    if (!entity || !entity.isApp) {
      return reply.code(404).send({ error: 'Object not found' })
    }

    const { prompt } = req.body || {}
    if (!prompt || typeof prompt !== 'string') {
      return reply.code(400).send({ error: 'prompt must be a non-empty string' })
    }

    if (!world.ai || !world.ai.enabled) {
      return reply.code(400).send({ error: 'AI generation is not enabled on this server' })
    }

    const blueprint = world.blueprints.get(entity.data.blueprint)
    if (!blueprint) {
      return reply.code(404).send({ error: 'Blueprint not found' })
    }

    // Trigger AI edit (runs in background)
    world.ai.onAction({
      name: 'edit',
      blueprintId: blueprint.id,
      appId: entity.data.id,
      prompt,
    })

    return {
      id: entity.data.id,
      blueprintId: blueprint.id,
      prompt,
    }
  })

  // DELETE /api/agents/:id — Remove agent from the world
  fastify.delete('/api/agents/:id', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    removeAgent(req.params.id)

    return { success: true }
  })
}
