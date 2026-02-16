import moment from 'moment'
import puppeteer from 'puppeteer-core'
import { uuid } from '../core/utils.js'
import { hashFile } from '../core/utils-server.js'
import { createNodeClientWorld } from '../core/createNodeClientWorld.js'
import { storage } from '../core/storage.js'

// Shared headless browser for screenshots
let browser = null
async function getBrowser() {
  if (!browser) {
    const executablePath =
      process.env.GOOGLE_CHROME_BIN ||
      process.env.GOOGLE_CHROME_SHIM ||
      process.env.CHROME_PATH ||
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      '/app/.chrome-for-testing/chrome-linux64/chrome'
    console.log('Launching Chrome from:', executablePath)
    browser = await puppeteer.launch({
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-webgl',
      ],
    })
  }
  return browser
}

/**
 * Agent REST API
 *
 * Allows AI agents to enter the world, walk around, and chat via simple HTTP requests.
 * Each agent runs a full node-client world internally, using the exact same movement
 * and animation system as real players.
 */
export default async function agentAPI(fastify, { world }) {
  // agentId -> { world, name, walkTimer, lastActivity }
  const agents = new Map()
  const wsUrl = `ws://localhost:${process.env.PORT}/ws`
  const INACTIVITY_TIMEOUT = 60 * 1000 // 60 seconds without any API call = auto-remove

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
    agent.world.destroy()
    agents.delete(id)
    console.log(`[agent-api] agent ${id} removed`)
  }

  function touchAgent(agent) {
    agent.lastActivity = Date.now()
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
    // atan2 of forward vector, game convention: -Z = north, +X = east
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

  // Periodically check for inactive agents and remove them
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [id, agent] of agents) {
      if (now - agent.lastActivity > INACTIVITY_TIMEOUT) {
        console.log(`[agent-api] agent ${id} timed out (no activity for ${INACTIVITY_TIMEOUT / 1000}s)`)
        removeAgent(id)
      }
    }
  }, 10000)

  fastify.addHook('onClose', async () => {
    clearInterval(cleanupInterval)
    for (const [id] of agents) {
      removeAgent(id)
    }
    if (browser) {
      await browser.close()
      browser = null
    }
  })

  // Touch the agent on every request to keep it alive
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

    agents.set(result.id, { world: agentWorld, name, walkTimer: null, lastActivity: Date.now() })

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

  // GET /api/agents/:id — Get agent state + world observations with spatial awareness
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

    const agentPos = entity.data.position
    const forward = getForwardVector(entity.data.quaternion)
    const facing = getCompassFacing(forward)

    const since = req.query.since ? new Date(req.query.since) : null

    // Players with distance and relative direction
    const players = []
    for (const [, player] of world.entities.players) {
      if (player.data.id === req.params.id) continue
      const dist = getDistance(agentPos, player.data.position)
      players.push({
        id: player.data.id,
        name: player.data.name,
        distance: dist,
        direction: getRelativeDirection(agentPos, forward, player.data.position),
      })
    }
    players.sort((a, b) => a.distance - b.distance)

    // Nearby objects with distance and relative direction
    const nearbyObjects = []
    for (const [, item] of world.entities.items) {
      if (!item.isApp) continue
      const blueprint = world.blueprints.get(item.data.blueprint)
      const dist = getDistance(agentPos, item.data.position)
      nearbyObjects.push({
        id: item.data.id,
        name: blueprint?.name || 'Unknown',
        distance: dist,
        direction: getRelativeDirection(agentPos, forward, item.data.position),
      })
    }
    nearbyObjects.sort((a, b) => a.distance - b.distance)
    if (nearbyObjects.length > 50) nearbyObjects.length = 50

    let chat = world.chat.msgs
    if (since) {
      chat = chat.filter(msg => new Date(msg.createdAt) > since)
    }

    return {
      id: entity.data.id,
      name: entity.data.name,
      position: entity.data.position,
      facing,
      nearbyObjects,
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

    // Release any existing movement first
    releaseAllMovement(agent)

    // Press forward key
    agent.world.controls.simulateButton('keyW', true)

    // Schedule key release after duration
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

  // GET /api/agents/:id/screenshot — Take a screenshot of the world
  fastify.get('/api/agents/:id/screenshot', async (req, reply) => {
    const agent = agents.get(req.params.id)
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' })
    }

    try {
      const b = await getBrowser()
      const page = await b.newPage()
      await page.setViewport({ width: 800, height: 600 })
      const port = process.env.PORT || 3000
      await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle2', timeout: 30000 })
      // Wait for loading overlay to disappear (the .loading-bar element is inside it)
      await page.waitForFunction(
        () => !document.querySelector('.loading-bar'),
        { timeout: 30000 }
      )
      // Extra time for the 3D scene to finish rendering
      await new Promise(resolve => setTimeout(resolve, 2000))
      const screenshotBuffer = await page.screenshot({ type: 'png' })
      await page.close()
      const base64 = screenshotBuffer.toString('base64')
      return { image: `data:image/png;base64,${base64}` }
    } catch (err) {
      console.error('Screenshot error:', err)
      return reply.code(500).send({ error: 'Failed to capture screenshot' })
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
