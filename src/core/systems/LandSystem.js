import { System } from './System'
import { uuid } from '../utils'

const GRID_SIZE = 25
const PLOT_SIZE = 50
const ROAD_WIDTH = 5
const CELL_PITCH = PLOT_SIZE + ROAD_WIDTH // 55m
const HALF_GRID = (GRID_SIZE * CELL_PITCH) / 2 // 687.5m

export class LandSystem extends System {
  constructor(world) {
    super(world)
    this.parcels = new Map()
    this.hasRoadEntity = false
    this.hasRoadBlueprint = false
  }

  async init({ db }) {
    this.db = db

    // Load ownership data
    const rows = await this.db('parcels').select('*')
    for (const row of rows) {
      if (row.id > GRID_SIZE * GRID_SIZE) continue
      this.parcels.set(row.id, {
        ownerId: row.ownerId,
        ownerName: row.ownerName,
        claimedAt: row.claimedAt,
      })
    }
    console.log(`[land] loaded ${this.parcels.size} claimed parcels`)

    // Check what already exists in DB
    const entityRows = await this.db('entities').select('id', 'data')
    const staleEntityIds = []
    for (const row of entityRows) {
      try {
        const data = JSON.parse(row.data)
        if (data.blueprint === '$land-roads') {
          this.hasRoadEntity = true
        }
        // Old sign entities from the previous per-plot approach — remove them
        if (data.blueprint && data.blueprint.startsWith('$land-claim-')) {
          staleEntityIds.push(row.id)
        }
      } catch (e) {}
    }

    const blueprintRows = await this.db('blueprints').select('id', 'data')
    for (const row of blueprintRows) {
      try {
        const bp = JSON.parse(row.data)
        if (bp.id === '$land-roads') {
          this.hasRoadBlueprint = true
        }
      } catch (e) {}
    }

    // Clean up old per-plot sign entities and blueprints
    if (staleEntityIds.length > 0) {
      for (const id of staleEntityIds) {
        await this.db('entities').where('id', id).delete()
      }
      console.log(`[land] removed ${staleEntityIds.length} old sign entities`)
    }
    const staleResult = await this.db('blueprints').where('id', 'like', '$land-claim-%').delete()
    if (staleResult > 0) {
      console.log(`[land] removed ${staleResult} old sign blueprints`)
    }
  }

  start() {
    this.ensureRoads()
    this.listenForEvents()
  }

  serializeParcels() {
    const obj = {}
    for (const [plotId, data] of this.parcels) {
      obj[String(plotId)] = { ownerId: data.ownerId, ownerName: data.ownerName }
    }
    return obj
  }

  getPlotCenter(plotId) {
    const idx = plotId - 1
    const row = Math.floor(idx / GRID_SIZE)
    const col = idx % GRID_SIZE
    const x = col * CELL_PITCH - HALF_GRID + CELL_PITCH / 2
    const z = row * CELL_PITCH - HALF_GRID + CELL_PITCH / 2
    return { x, z }
  }

  getPlotAt(x, z) {
    const gx = x + HALF_GRID
    const gz = z + HALF_GRID
    if (gx < 0 || gz < 0 || gx >= GRID_SIZE * CELL_PITCH || gz >= GRID_SIZE * CELL_PITCH) {
      return null
    }
    const cellX = gx % CELL_PITCH
    const cellZ = gz % CELL_PITCH
    if (cellX >= PLOT_SIZE || cellZ >= PLOT_SIZE) {
      return null
    }
    const col = Math.floor(gx / CELL_PITCH)
    const row = Math.floor(gz / CELL_PITCH)
    return row * GRID_SIZE + col + 1
  }

  isOnRoad(x, z) {
    const gx = x + HALF_GRID
    const gz = z + HALF_GRID
    if (gx < 0 || gz < 0 || gx >= GRID_SIZE * CELL_PITCH || gz >= GRID_SIZE * CELL_PITCH) {
      return false
    }
    const cellX = gx % CELL_PITCH
    const cellZ = gz % CELL_PITCH
    return cellX >= PLOT_SIZE || cellZ >= PLOT_SIZE
  }

  isInsideGrid(x, z) {
    const gx = x + HALF_GRID
    const gz = z + HALF_GRID
    return gx >= 0 && gz >= 0 && gx < GRID_SIZE * CELL_PITCH && gz < GRID_SIZE * CELL_PITCH
  }

  getPlotOwner(plotId) {
    const parcel = this.parcels.get(plotId)
    return parcel?.ownerId || null
  }

  canBuildAt(userId, x, z) {
    if (!this.isInsideGrid(x, z)) return true
    if (this.isOnRoad(x, z)) return false
    const plotId = this.getPlotAt(x, z)
    if (!plotId) return false
    const owner = this.getPlotOwner(plotId)
    if (!owner) return true
    return owner === userId
  }

  async claim(plotId, userId, userName) {
    if (plotId < 1 || plotId > GRID_SIZE * GRID_SIZE) {
      return { ok: false, error: 'Invalid plot ID' }
    }
    const existing = this.parcels.get(plotId)
    if (existing?.ownerId) {
      return { ok: false, error: `Plot already claimed by ${existing.ownerName}` }
    }
    const now = new Date().toISOString()
    this.parcels.set(plotId, { ownerId: userId, ownerName: userName, claimedAt: now })
    await this.db('parcels')
      .insert({ id: plotId, ownerId: userId, ownerName: userName, claimedAt: now })
      .onConflict('id')
      .merge()
    console.log(`[land] plot ${plotId} claimed by ${userName} (${userId})`)
    return { ok: true }
  }

  async unclaim(plotId, userId) {
    const existing = this.parcels.get(plotId)
    if (!existing?.ownerId) {
      return { ok: false, error: 'Plot is not claimed' }
    }
    if (existing.ownerId !== userId) {
      return { ok: false, error: 'You do not own this plot' }
    }
    this.parcels.delete(plotId)
    await this.db('parcels').where('id', plotId).delete()
    console.log(`[land] plot ${plotId} unclaimed by ${userId}`)
    return { ok: true }
  }

  ensureRoads() {
    const bpData = {
      id: '$land-roads',
      version: 0,
      name: 'Land Roads & Signs',
      model: null,
      script: 'asset://land-roads.js',
      props: { parcels: this.serializeParcels() },
      preload: false,
      public: false,
      locked: true,
      unique: true,
      disabled: false,
    }

    if (this.hasRoadBlueprint) {
      // Update existing blueprint with current parcel data
      const existing = this.world.blueprints.get('$land-roads')
      if (existing) {
        bpData.version = existing.version
      }
      this.world.blueprints.modify(bpData)
    } else {
      this.world.blueprints.add(bpData, true)
    }
    this.world.network.dirtyBlueprints.add('$land-roads')

    if (!this.hasRoadEntity) {
      const data = {
        id: uuid(),
        type: 'app',
        blueprint: '$land-roads',
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
        mover: null,
        uploader: null,
        pinned: true,
        state: {},
      }
      this.world.entities.add(data, true)
      this.world.network.dirtyApps.add(data.id)
      console.log('[land] created roads entity')
    }
  }

  listenForEvents() {
    this.world.events.on('landClaim', async ({ plotId, playerId }) => {
      await this.handleClaim(plotId, playerId)
    })
    this.world.events.on('landUnclaim', async ({ plotId, playerId }) => {
      await this.handleUnclaim(plotId, playerId)
    })
  }

  async handleClaim(plotId, playerId) {
    const player = this.world.entities.get(playerId)
    if (!player) return
    const result = await this.claim(plotId, player.data.userId, player.data.name)
    if (result.ok) {
      this.updateRoadsBlueprint()
    }
  }

  async handleUnclaim(plotId, playerId) {
    const player = this.world.entities.get(playerId)
    if (!player) return
    const result = await this.unclaim(plotId, player.data.userId)
    if (result.ok) {
      this.updateRoadsBlueprint()
    }
  }

  updateRoadsBlueprint() {
    const bp = this.world.blueprints.get('$land-roads')
    if (!bp) return
    const change = {
      id: '$land-roads',
      version: (bp.version || 0) + 1,
      props: { parcels: this.serializeParcels() },
    }
    this.world.blueprints.modify(change)
    this.world.network.send('blueprintModified', change)
    this.world.network.dirtyBlueprints.add('$land-roads')
  }
}

export { GRID_SIZE, PLOT_SIZE, ROAD_WIDTH, CELL_PITCH, HALF_GRID }
