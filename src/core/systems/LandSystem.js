import { System } from './System'
import { uuid } from '../utils'

const GRID_SIZE = 25
const PLOT_SIZE = 50
const ROAD_WIDTH = 5
const CELL_PITCH = PLOT_SIZE + ROAD_WIDTH // 55m
const HALF_GRID = (GRID_SIZE * CELL_PITCH) / 2 // 2750m

export class LandSystem extends System {
  constructor(world) {
    super(world)
    this.parcels = new Map()
    this.existingSignPlots = new Set()
    this.existingBlueprints = new Set()
    this.hasRoadEntity = false
  }

  async init({ db }) {
    this.db = db

    const maxPlot = GRID_SIZE * GRID_SIZE

    const rows = await this.db('parcels').select('*')
    for (const row of rows) {
      if (row.id > maxPlot) continue
      this.parcels.set(row.id, {
        ownerId: row.ownerId,
        ownerName: row.ownerName,
        claimedAt: row.claimedAt,
      })
    }
    console.log(`[land] loaded ${this.parcels.size} claimed parcels`)

    // Query DB directly to discover what already exists, avoiding race
    // conditions with ServerNetwork.start(). Track entities and blueprints
    // separately so we can detect orphaned blueprints without entities.
    const staleEntityIds = []
    const entityRows = await this.db('entities').select('id', 'data')
    for (const row of entityRows) {
      try {
        const data = JSON.parse(row.data)
        if (data.blueprint === '$land-roads') {
          this.hasRoadEntity = true
        }
        if (data.blueprint && data.blueprint.startsWith('$land-claim-')) {
          const plotNum = parseInt(data.blueprint.replace('$land-claim-', ''))
          if (plotNum > maxPlot) {
            staleEntityIds.push(row.id)
          } else {
            this.existingSignPlots.add(plotNum)
          }
        }
      } catch (e) {
        // skip malformed
      }
    }

    const staleBlueprintIds = []
    const blueprintRows = await this.db('blueprints').select('id', 'data')
    for (const row of blueprintRows) {
      try {
        const bp = JSON.parse(row.data)
        if (bp.id === '$land-roads') {
          this.existingBlueprints.add(bp.id)
        }
        if (bp.id && bp.id.startsWith('$land-claim-')) {
          const plotNum = parseInt(bp.id.replace('$land-claim-', ''))
          if (plotNum > maxPlot) {
            staleBlueprintIds.push(row.id)
          } else {
            this.existingBlueprints.add(bp.id)
          }
        }
      } catch (e) {
        // skip
      }
    }

    if (staleEntityIds.length || staleBlueprintIds.length) {
      console.log(`[land] purging ${staleEntityIds.length} stale entities and ${staleBlueprintIds.length} stale blueprints from old grid`)
      for (const id of staleEntityIds) {
        await this.db('entities').where('id', id).delete()
      }
      for (const id of staleBlueprintIds) {
        await this.db('blueprints').where('id', id).delete()
      }
    }
  }

  start() {
    this.ensureRoads()
    this.ensureClaimSigns()
    this.listenForEvents()
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
      return null // on a road
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

  getSignPosition(plotId) {
    const center = this.getPlotCenter(plotId)
    const halfPlot = PLOT_SIZE / 2
    const roadOffset = ROAD_WIDTH / 2
    return [center.x - halfPlot - roadOffset, 0, center.z - halfPlot - roadOffset]
  }

  ensureRoads() {
    if (!this.existingBlueprints.has('$land-roads')) {
      const bp = {
        id: '$land-roads',
        version: 0,
        name: 'Land Roads',
        model: null,
        script: 'asset://land-roads.js',
        props: {},
        preload: false,
        public: false,
        locked: true,
        unique: true,
        disabled: false,
      }
      this.world.blueprints.add(bp, true)
      this.world.network.dirtyBlueprints.add(bp.id)
    }

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
      console.log('[land] spawned road grid entity')
    }
  }

  ensureClaimSigns() {
    const total = GRID_SIZE * GRID_SIZE
    let spawned = 0
    for (let plotId = 1; plotId <= total; plotId++) {
      const bpId = `$land-claim-${plotId}`
      const parcel = this.parcels.get(plotId)

      if (!this.existingBlueprints.has(bpId)) {
        this.world.blueprints.add({
          id: bpId,
          version: 0,
          name: `Lot #${plotId}`,
          model: null,
          script: 'asset://land-claim.js',
          props: {
            plotId,
            ownerId: parcel?.ownerId || null,
            ownerName: parcel?.ownerName || null,
          },
          preload: false,
          public: false,
          locked: true,
          unique: true,
          disabled: false,
        }, true)
        this.world.network.dirtyBlueprints.add(bpId)
      }

      if (!this.existingSignPlots.has(plotId)) {
        const pos = this.getSignPosition(plotId)
        const data = {
          id: uuid(),
          type: 'app',
          blueprint: bpId,
          position: pos,
          quaternion: [0, 0, 0, 1],
          scale: [1, 1, 1],
          mover: null,
          uploader: null,
          pinned: true,
          state: {},
        }
        this.world.entities.add(data, true)
        this.world.network.dirtyApps.add(data.id)
        spawned++
      }
    }
    if (spawned > 0) {
      console.log(`[land] spawned ${spawned} claim sign entities`)
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
      this.updateSignBlueprint(plotId)
    }
  }

  async handleUnclaim(plotId, playerId) {
    const player = this.world.entities.get(playerId)
    if (!player) return
    const result = await this.unclaim(plotId, player.data.userId)
    if (result.ok) {
      this.updateSignBlueprint(plotId)
    }
  }

  updateSignBlueprint(plotId) {
    const bpId = `$land-claim-${plotId}`
    const parcel = this.parcels.get(plotId)
    const change = {
      id: bpId,
      version: (this.world.blueprints.get(bpId)?.version || 0) + 1,
      props: {
        plotId,
        ownerId: parcel?.ownerId || null,
        ownerName: parcel?.ownerName || null,
      },
    }
    this.world.blueprints.modify(change)
    this.world.network.send('blueprintModified', change)
    this.world.network.dirtyBlueprints.add(bpId)
  }
}

export { GRID_SIZE, PLOT_SIZE, ROAD_WIDTH, CELL_PITCH, HALF_GRID }
