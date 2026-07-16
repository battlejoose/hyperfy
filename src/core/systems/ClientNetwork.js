import moment from 'moment'
import { ARENA_SRC } from '../extras/arenaEnvironment'
import { clearPrefetch } from '../extras/assetPrefetch'
import { replayBloodSplatters } from '../extras/bloodEffects'
import { prepareClientGameAssets } from '../extras/gameAssets'
import { replayCorpses, spawnCorpse } from '../extras/playerCorpse'
import { readPacket, writePacket } from '../packets'
import { storage } from '../storage'
import { uuid } from '../utils'
import { hashFile } from '../utils-client'
import { System } from './System'

/**
 * Client Network System
 *
 * - runs on the client
 * - provides abstract network methods matching ServerNetwork
 *
 */
export class ClientNetwork extends System {
  constructor(world) {
    super(world)
    this.ids = -1
    this.ws = null
    this.apiUrl = null
    this.id = null
    this.isClient = true
    this.queue = []
    this.scoreboard = null
    this.matchState = null
    this.tournamentBracket = null
    this.bootstrapping = null
  }

  setScoreboard(data) {
    this.scoreboard = data
    this.world.emit('scoreboard', data)
  }

  setMatchState(data) {
    this.matchState = data
    this.world.emit('matchState', data)
  }

  init({ wsUrl, name, avatar }) {
    const authToken = storage.get('authToken')
    let url = `${wsUrl}?authToken=${authToken}`
    if (name) url += `&name=${encodeURIComponent(name)}`
    if (avatar) url += `&avatar=${encodeURIComponent(avatar)}`
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'
    this.ws.addEventListener('message', this.onPacket)
    this.ws.addEventListener('close', this.onClose)
  }

  preFixedUpdate() {
    this.flush()
  }

  send(name, data) {
    // console.log('->', name, data)
    const packet = writePacket(name, data)
    this.ws.send(packet)
  }

  async upload(file) {
    {
      // first check if we even need to upload it
      const hash = await hashFile(file)
      const ext = file.name.split('.').pop().toLowerCase()
      const filename = `${hash}.${ext}`
      const url = `${this.apiUrl}/upload-check?filename=${filename}`
      const resp = await fetch(url)
      const data = await resp.json()
      if (data.exists) return // console.log('already uploaded:', filename)
    }
    // then upload it
    const form = new FormData()
    form.append('file', file)
    const url = `${this.apiUrl}/upload`
    await fetch(url, {
      method: 'POST',
      body: form,
    })
  }

  enqueue(method, data) {
    this.queue.push([method, data])
  }

  flush() {
    if (this.bootstrapping) return
    while (this.queue.length) {
      try {
        const [method, data] = this.queue.shift()
        this[method]?.(data)
      } catch (err) {
        console.error(err)
      }
    }
  }

  getTime() {
    return (performance.now() + this.serverTimeOffset) / 1000 // seconds
  }

  onPacket = e => {
    const [method, data] = readPacket(e.data)
    this.enqueue(method, data)
    // console.log('<-', method, data)
  }

  onSnapshot(data) {
    this.pendingSnapshot = data
    this.bootstrapping = this.bootstrapGame(data)
      .catch(err => {
        console.error('[ClientNetwork] bootstrap failed:', err)
        this.world.emit('loadError', { message: err.message || 'Failed to load the arena' })
      })
      .finally(() => {
        this.bootstrapping = null
      })
  }

  /**
   * Restart arena asset load only — stay on the loading screen with the same
   * websocket session / username (do not bounce back to the title form).
   */
  retryBootstrap() {
    if (this.bootstrapping || !this.pendingSnapshot) return
    this.world.emit('loadError', null)
    this.world.emit('progress', 0)
    clearPrefetch(ARENA_SRC)
    this.world.loader.bust(ARENA_SRC)
    this.bootstrapping = (async () => {
      // Brief pause so Heroku can recover before another arena pull
      await new Promise(r => setTimeout(r, 1500))
      await this.bootstrapGame(this.pendingSnapshot)
    })()
      .catch(err => {
        console.error('[ClientNetwork] bootstrap retry failed:', err)
        this.world.emit('loadError', { message: err.message || 'Failed to load the arena' })
      })
      .finally(() => {
        this.bootstrapping = null
      })
  }

  async bootstrapGame(data) {
    this.id = data.id
    this.serverTimeOffset = data.serverTime - performance.now()
    this.apiUrl = data.apiUrl
    this.maxUploadSize = data.maxUploadSize
    this.world.assetsUrl = data.assetsUrl

    // Critical: arena must load before we enter. Do not swallow this failure.
    await prepareClientGameAssets(this.world, data)

    this.world.collections.deserialize(data.collections)
    this.world.settings.deserialize(data.settings)
    this.world.settings.setHasAdminCode(data.hasAdminCode)
    this.world.chat.deserialize(data.chat)
    this.world.ai.deserialize(data.ai)
    this.world.blueprints.deserialize(data.blueprints)
    this.world.entities.deserialize(data.entities)
    this.world.livekit?.deserialize(data.livekit)
    if (data.scoreboard) {
      this.setScoreboard(data.scoreboard)
    }
    if (data.matchState) {
      this.setMatchState(data.matchState)
    }
    if (data.tournamentBracket) {
      this.onTournamentBracket(data.tournamentBracket)
    }
    if (data.arenaRemnants) {
      try {
        replayCorpses(this.world, data.arenaRemnants.corpses)
        replayBloodSplatters(this.world, data.arenaRemnants.blood)
      } catch (err) {
        console.error('[ClientNetwork] failed to replay arena remnants:', err)
      }
    }
    storage.set('authToken', data.authToken)
  }

  onSettingsModified = data => {
    this.world.settings.set(data.key, data.value)
  }

  onChatAdded = msg => {
    this.world.chat.add(msg, false)
  }

  onChatCleared = () => {
    this.world.chat.clear()
  }

  onBlueprintAdded = blueprint => {
    this.world.blueprints.add(blueprint)
  }

  onBlueprintModified = change => {
    this.world.blueprints.modify(change)
  }

  onEntityAdded = data => {
    this.world.entities.add(data)
  }

  onEntityModified = data => {
    const entity = this.world.entities.get(data.id)
    if (!entity) return console.error('onEntityModified: no entity found', data)
    entity.modify(data)
  }

  onAttackCanceled = data => {
    const { playerId } = data
    // Get the remote player who canceled
    const player = this.world.entities.get(playerId)
    if (player && player.onAttackCanceled) {
      player.onAttackCanceled()
    }
  }

  onBlockBroken = data => {
    const { blockerId } = data
    const player = this.world.entities.player
    if (player?.data.id !== blockerId) return
    player.breakBlockFromKick()
  }

  onHitBlocked = data => {
    const player = this.world.entities.player
    if (player?.data.id !== data.attackerId) return
    player.onServerHitBlocked(data.targetId)
  }

  onPlayerCorpse = data => {
    const player = this.world.entities.get(data.playerId)
    let avatar = null
    if (player?.avatar) {
      avatar = player.avatar
      player.avatar = null
      player.avatarUrl = null
    }
    spawnCorpse(this.world, {
      position: data.p,
      quaternion: data.q,
      sessionAvatar: data.sessionAvatar,
      avatar,
    })
  }

  onScoreboard = data => {
    this.setScoreboard(data)
  }

  onMatchState = data => {
    this.setMatchState(data)
  }

  onEnterArenaResult = data => {
    this.world.emit('enterArenaResult', data)
  }

  onJoinBattleRoyaleResult = data => {
    this.world.emit('joinBattleRoyaleResult', data)
  }

  onBrVictory = data => {
    this.world.emit('brVictory', data)
  }

  onTournamentBracket = data => {
    this.tournamentBracket = data
    this.world.emit('tournamentBracket', data)
  }

  onEntityEvent = event => {
    const [id, version, name, data] = event
    const entity = this.world.entities.get(id)
    entity?.onEvent(version, name, data)
  }

  onEntityRemoved = id => {
    this.world.entities.remove(id)
  }

  onPlayerTeleport = data => {
    this.world.entities.player?.teleport(data)
  }

  onPlayerPush = data => {
    this.world.entities.player?.push(data.force)
  }

  onPlayerSessionAvatar = data => {
    // Update the avatar for the specified player (local or remote)
    const player = this.world.entities.get(data.networkId)
    if (player) {
      player.modify({ sessionAvatar: data.avatar })
    }
  }

  onLiveKitLevel = data => {
    this.world.livekit.setLevel(data.playerId, data.level)
  }

  onMute = data => {
    this.world.livekit.setMuted(data.playerId, data.muted)
  }

  onPong = time => {
    this.world.stats?.onPong(time)
  }

  onKick = code => {
    this.world.emit('kick', code)
  }

  onClose = code => {
    this.world.chat.add({
      id: uuid(),
      from: null,
      fromId: null,
      body: `You have been disconnected.`,
      createdAt: moment().toISOString(),
    })
    this.world.emit('disconnect', code || true)
    console.log('disconnect', code)
  }

  destroy() {
    if (this.ws) {
      this.ws.removeEventListener('message', this.onPacket)
      this.ws.removeEventListener('close', this.onClose)
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close()
      }
      this.ws = null
    }
  }
}
