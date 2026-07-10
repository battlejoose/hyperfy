import moment from 'moment'
import { writePacket } from '../packets'
import { Socket } from '../Socket'
import { uuid } from '../utils'
import { System } from './System'
import { createJWT, readJWT } from '../utils-server'
import { cloneDeep, isNumber } from 'lodash-es'
import * as THREE from '../extras/three'
import { Ranks } from '../extras/ranks'
import { Emotes } from '../extras/playerEmotes'
import { AVATAR_CRUSADER, AVATAR_SARACEN, getPlayerSpawn, getTeamFromAvatar, getRotationYFromQuaternion, isSpectatorSessionAvatar } from '../extras/playerAvatars'
import { loadArenaEnvironment } from '../extras/arenaEnvironment'
import {
  addArenaBloodHit,
  addArenaCorpse,
  createArenaRemnants,
  serializeArenaRemnants,
} from '../extras/arenaRemnants'
import { verifyEntryPayment, findRecentEntryPayment, sendPayout } from '../extras/solanaPayments.js'
import { PublicKey } from '@solana/web3.js'
import {
  BR_ENTRY_FEE_LAMPORTS,
  BR_HOUSE_FEE_PERCENT,
  BR_QUEUE_DURATION_SECONDS,
  LAMPORTS_PER_SOL,
} from '../extras/solanaConfig.js'

const blockEmotes = [
  Emotes.BLOCK,
  Emotes.BLOCK_HIGH,
  Emotes.BLOCK_LEFT,
  Emotes.BLOCK_RIGHT,
  Emotes.BLOCK_LOW,
]

// Emote → direction tag maps for server-side block arbitration.
// Note: Emotes.BLOCK (key 5) shares blockhigh.glb with BLOCK_HIGH, so it resolves as a high block.
const attackTagByEmote = {
  [Emotes.ATTACK_HIGH]: 'high',
  [Emotes.ATTACK_LEFT]: 'left',
  [Emotes.ATTACK_RIGHT]: 'right',
  [Emotes.ATTACK_LOW]: 'low',
}
const blockTagByEmote = {
  [Emotes.BLOCK_HIGH]: 'high',
  [Emotes.BLOCK_LEFT]: 'left',
  [Emotes.BLOCK_RIGHT]: 'right',
  [Emotes.BLOCK_LOW]: 'low',
}

// Same mirror table the clients use: left blocks right and vice versa.
function isAttackBlocked(attackTag, blockTag) {
  if (!blockTag) return false
  if (blockTag === 'high' && attackTag === 'high') return true
  if (blockTag === 'low' && attackTag === 'low') return true
  if (blockTag === 'left' && attackTag === 'right') return true
  if (blockTag === 'right' && attackTag === 'left') return true
  return false
}

const SWORD_DAMAGE_MAX = 25

const SAVE_INTERVAL = parseInt(process.env.SAVE_INTERVAL || '60') // seconds
const PING_RATE = 10 // seconds
const defaultSpawn = '{ "position": [0, 0, 0], "quaternion": [0, 0, 0, 1] }'
const defaultTeamKills = '{ "crusader": 0, "saracen": 0 }'

const HEALTH_MAX = 100

/**
 * Server Network System
 *
 * - runs on the server
 * - provides abstract network methods matching ClientNetwork
 *
 */
export class ServerNetwork extends System {
  constructor(world) {
    super(world)
    this.id = 0
    this.ids = -1
    this.sockets = new Map()
    this.socketIntervalId = setInterval(() => this.checkSockets(), PING_RATE * 1000)
    this.saveTimerId = null
    this.dirtyBlueprints = new Set()
    this.dirtyApps = new Set()
    this.isServer = true
    this.queue = []
    this.scoreboard = new Map()
    this.teamKills = { crusader: 0, saracen: 0 }
    this.battleRoyale = null
    this.arenaRemnants = createArenaRemnants()
  }

  init({ db }) {
    this.db = db
  }

  async start() {
    // get spawn
    const spawnRow = await this.db('config').where('key', 'spawn').first()
    this.spawn = JSON.parse(spawnRow?.value || defaultSpawn)
    const teamKillsRow = await this.db('config').where('key', 'teamKills').first()
    try {
      this.teamKills = JSON.parse(teamKillsRow?.value || defaultTeamKills)
    } catch (err) {
      console.error('failed to parse teamKills config:', err)
      this.teamKills = { crusader: 0, saracen: 0 }
    }
    // hydrate blueprints
    const blueprints = await this.db('blueprints')
    for (const blueprint of blueprints) {
      const data = JSON.parse(blueprint.data)
      this.world.blueprints.add(data, true)
    }
    // hydrate entities
    const entities = await this.db('entities')
    for (const entity of entities) {
      const data = JSON.parse(entity.data)
      data.state = {}
      this.world.entities.add(data, true)
    }
    // hydrate settings
    let settingsRow = await this.db('config').where('key', 'settings').first()
    try {
      const settings = JSON.parse(settingsRow?.value || '{}')
      this.world.settings.deserialize(settings)
      this.world.settings.setHasAdminCode(!!process.env.ADMIN_CODE)
    } catch (err) {
      console.error(err)
    }
    // watch settings changes
    this.world.settings.on('change', this.saveSettings)
    // queue first save
    if (SAVE_INTERVAL) {
      this.saveTimerId = setTimeout(this.save, SAVE_INTERVAL * 1000)
    }
    this.initArena()
    loadArenaEnvironment(this.world).catch(err => console.error('[Arena]', err))
  }

  initArena() {
    // Battle royale cycle: a repeating queue period (free-play in the arena, paid
    // queue signups), then a winner-take-all battle for everyone who queued.
    this.battleRoyale = {
      phase: 'queue', // 'queue' | 'battle'
      endsAt: 0, // server time (seconds) when the queue period ends
      queued: new Map(), // playerId -> { wallet }
      nextQueued: new Map(), // paid entries verified too late for the current cycle
      alive: new Set(), // playerIds still standing during a battle
      potLamports: 0,
    }
    this.brTimerId = null
    this.startQueuePhase()
  }

  startQueuePhase() {
    const br = this.battleRoyale
    br.phase = 'queue'
    br.endsAt = this.getTime() + BR_QUEUE_DURATION_SECONDS
    // payments that verified after the previous queue closed roll into this one
    br.nextQueued.forEach((entry, playerId) => br.queued.set(playerId, entry))
    br.nextQueued.clear()
    clearTimeout(this.brTimerId)
    this.brTimerId = setTimeout(() => this.beginBattleRoyale(), BR_QUEUE_DURATION_SECONDS * 1000)
    this.broadcastMatchState()
  }

  getMatchStatePayload() {
    const br = this.battleRoyale
    if (!br) return { phase: 'queue', endsAt: 0, queuedIds: [], potLamports: 0 }
    return {
      phase: br.phase,
      endsAt: br.endsAt,
      queuedIds: [...br.queued.keys()],
      aliveCount: br.alive.size,
      potLamports: br.queued.size * BR_ENTRY_FEE_LAMPORTS,
    }
  }

  broadcastMatchState() {
    this.send('matchState', this.getMatchStatePayload())
  }

  announce(body) {
    this.send('chatAdded', {
      id: uuid(),
      from: null,
      fromId: null,
      body,
      createdAt: moment().toISOString(),
    })
  }

  beginBattleRoyale() {
    const br = this.battleRoyale

    // need at least 2 fighters — otherwise keep the queue open another period
    if (br.queued.size < 2) {
      if (br.queued.size === 1) {
        this.announce('Battle royale needs at least 2 fighters — queue stays open another round.')
      }
      this.startQueuePhase()
      return
    }

    br.phase = 'battle'
    br.endsAt = 0
    br.potLamports = br.queued.size * BR_ENTRY_FEE_LAMPORTS
    br.alive = new Set()

    // queued players still connected enter the battle; everyone else in the
    // arena is returned to the stands
    this.sockets.forEach(socket => {
      const player = socket.player
      if (!player) return
      if (br.queued.has(player.data.id)) {
        br.alive.add(player.data.id)
        this.setPlayerSessionAvatar(player, AVATAR_CRUSADER)
        this.teleportPlayerToSpawn(player)
      } else if (!isSpectatorSessionAvatar(player.data.sessionAvatar)) {
        this.setPlayerSessionAvatar(player, AVATAR_SARACEN)
        this.teleportPlayerToSpawn(player)
      }
    })

    this.broadcastScoreboard()
    this.broadcastMatchState()
    this.announce(
      `Battle royale has begun! ${br.alive.size} fighters, winner takes ${this.getWinnerPayoutSol()} SOL.`
    )

    // everyone who queued may have disconnected before the battle started
    this.checkBattleRoyaleWinner()
  }

  getWinnerPayoutLamports() {
    const br = this.battleRoyale
    return Math.floor((br.potLamports * (100 - BR_HOUSE_FEE_PERCENT)) / 100)
  }

  getWinnerPayoutSol() {
    return this.getWinnerPayoutLamports() / LAMPORTS_PER_SOL
  }

  handleBattleRoyaleElimination(playerId) {
    const br = this.battleRoyale
    if (br?.phase !== 'battle') return
    if (!br.alive.delete(playerId)) return
    this.broadcastMatchState()
    this.checkBattleRoyaleWinner()
  }

  checkBattleRoyaleWinner() {
    const br = this.battleRoyale
    if (br.phase !== 'battle' || br.alive.size > 1) return

    const winnerId = br.alive.size === 1 ? [...br.alive][0] : null
    this.endBattleRoyale(winnerId)
  }

  endBattleRoyale(winnerId) {
    const br = this.battleRoyale
    const payoutLamports = this.getWinnerPayoutLamports()
    const payoutSol = payoutLamports / LAMPORTS_PER_SOL

    if (winnerId) {
      const wallet = br.queued.get(winnerId)?.wallet
      const winnerPlayer = this.world.entities.get(winnerId)
      const winnerName = winnerPlayer?.data?.name || 'A gladiator'
      this.announce(`${winnerName} wins the battle royale and takes ${payoutSol} SOL!`)
      if (wallet) {
        sendPayout(wallet, payoutLamports, winnerId, 'br_win')
          .then(signature => {
            if (!signature) {
              console.error('[solana] Battle royale payout did not complete for', winnerId)
              return
            }
            this.sendTo(winnerId, 'chatAdded', {
              id: uuid(),
              from: null,
              fromId: null,
              body: `You won ${payoutSol} SOL!`,
              createdAt: moment().toISOString(),
            })
          })
          .catch(err => console.error('[solana] Battle royale payout failed:', err))
      } else {
        console.error('[solana] Battle royale winner has no wallet on file:', winnerId)
      }
    } else {
      this.announce('The battle royale ended with no one left standing. The pot goes to the arena.')
    }

    br.queued.clear()
    br.alive.clear()
    br.potLamports = 0
    this.startQueuePhase()
  }

  setPlayerSessionAvatar(player, sessionAvatar) {
    if (player.data.sessionAvatar === sessionAvatar) return false
    player.data.sessionAvatar = sessionAvatar
    player.modify({ sessionAvatar })
    const entry = this.scoreboard.get(player.data.id)
    if (entry) {
      entry.team = getTeamFromAvatar(sessionAvatar)
    }
    this.send('entityModified', {
      id: player.data.id,
      sessionAvatar,
    })
    return true
  }

  teleportPlayerToSpawn(player) {
    const { position, quaternion } = getPlayerSpawn(this.spawn, player.data.sessionAvatar)
    const rotationY = getRotationYFromQuaternion(quaternion)

    player.modify({
      p: position,
      q: quaternion,
      t: true,
      health: HEALTH_MAX,
      ef: null,
    })

    this.send('entityModified', {
      id: player.data.id,
      p: position,
      q: quaternion,
      t: true,
      health: HEALTH_MAX,
      ef: null,
    })

    this.sendTo(player.data.userId, 'playerTeleport', {
      networkId: player.data.userId,
      position,
      rotationY,
    })
  }

  preFixedUpdate() {
    this.flush()
  }

  send(name, data, ignoreSocketId) {
    // console.log('->>>', name, data)
    const packet = writePacket(name, data)
    this.sockets.forEach(socket => {
      if (socket.id === ignoreSocketId) return
      socket.sendPacket(packet)
    })
  }

  sendTo(socketId, name, data) {
    const socket = this.sockets.get(socketId)
    socket?.send(name, data)
  }

  checkSockets() {
    // see: https://www.npmjs.com/package/ws#how-to-detect-and-close-broken-connections
    const dead = []
    this.sockets.forEach(socket => {
      if (!socket.alive) {
        dead.push(socket)
      } else {
        socket.ping()
      }
    })
    dead.forEach(socket => socket.disconnect())
  }

  enqueue(socket, method, data) {
    this.queue.push([socket, method, data])
  }

  getScoreboardArray() {
    return [...this.scoreboard.values()]
      .map(({ wallet, ...entry }) => entry)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }

  getScoreboardPayload() {
    return {
      players: this.getScoreboardArray(),
      teamKills: { ...this.teamKills },
    }
  }

  broadcastScoreboard() {
    this.send('scoreboard', this.getScoreboardPayload())
  }

  addScoreboardPlayer(id, name, team = 'saracen', wallet = null) {
    const entry = this.scoreboard.get(id)
    if (entry) {
      entry.name = name
      entry.team = team
      if (wallet) entry.wallet = wallet
    } else {
      this.scoreboard.set(id, { id, name, kills: 0, deaths: 0, team, wallet })
    }
  }

  removeScoreboardPlayer(id) {
    if (!this.scoreboard.delete(id)) return
    this.broadcastScoreboard()
  }

  recordKill = (attackerId, targetId) => {
    if (attackerId === targetId) return
    const killer = this.scoreboard.get(attackerId)
    const victim = this.scoreboard.get(targetId)
    if (killer) {
      killer.kills += 1
      const team = killer.team ?? 'crusader'
      this.teamKills[team] = (this.teamKills[team] ?? 0) + 1
      this.saveTeamKills().catch(err => console.error('failed to save teamKills:', err))
    }
    if (victim) victim.deaths += 1
    this.broadcastScoreboard()
  }

  saveTeamKills = async () => {
    const value = JSON.stringify(this.teamKills)
    await this.db('config')
      .insert({
        key: 'teamKills',
        value,
      })
      .onConflict('key')
      .merge({
        value,
      })
  }

  flush() {
    while (this.queue.length) {
      try {
        const [socket, method, data] = this.queue.shift()
        this[method]?.(socket, data)
      } catch (err) {
        console.error(err)
      }
    }
  }

  getTime() {
    return performance.now() / 1000 // seconds
  }

  save = async () => {
    const counts = {
      upsertedBlueprints: 0,
      upsertedApps: 0,
      deletedApps: 0,
    }
    const now = moment().toISOString()
    // blueprints
    for (const id of this.dirtyBlueprints) {
      const blueprint = this.world.blueprints.get(id)
      try {
        const record = {
          id: blueprint.id,
          data: JSON.stringify(blueprint),
        }
        await this.db('blueprints')
          .insert({ ...record, createdAt: now, updatedAt: now })
          .onConflict('id')
          .merge({ ...record, updatedAt: now })
        counts.upsertedBlueprints++
        this.dirtyBlueprints.delete(id)
      } catch (err) {
        console.log(`error saving blueprint: ${blueprint.id}`)
        console.error(err)
      }
    }
    // app entities
    for (const id of this.dirtyApps) {
      const entity = this.world.entities.get(id)
      if (entity) {
        // it needs creating/updating
        if (entity.data.uploader || entity.data.mover) {
          continue // ignore while uploading or moving
        }
        try {
          const data = cloneDeep(entity.data)
          data.state = null
          const record = {
            id: entity.data.id,
            data: JSON.stringify(entity.data),
          }
          await this.db('entities')
            .insert({ ...record, createdAt: now, updatedAt: now })
            .onConflict('id')
            .merge({ ...record, updatedAt: now })
          counts.upsertedApps++
          this.dirtyApps.delete(id)
        } catch (err) {
          console.log(`error saving entity: ${entity.data.id}`)
          console.error(err)
        }
      } else {
        // it was removed
        await this.db('entities').where('id', id).delete()
        counts.deletedApps++
        this.dirtyApps.delete(id)
      }
    }
    // log
    const didSave = counts.upsertedBlueprints > 0 || counts.upsertedApps > 0 || counts.deletedApps > 0
    if (didSave) {
      console.log(
        `world saved (${counts.upsertedBlueprints} blueprints, ${counts.upsertedApps} apps, ${counts.deletedApps} apps removed)`
      )
    }
    // queue again
    this.saveTimerId = setTimeout(this.save, SAVE_INTERVAL * 1000)
  }

  saveSettings = async () => {
    const data = this.world.settings.serialize()
    const value = JSON.stringify(data)
    await this.db('config')
      .insert({
        key: 'settings',
        value,
      })
      .onConflict('key')
      .merge({
        value,
      })
  }

  async onConnection(ws, params) {
    try {
      // check player limit
      const playerLimit = this.world.settings.playerLimit
      if (isNumber(playerLimit) && playerLimit > 0 && this.sockets.size >= playerLimit) {
        const packet = writePacket('kick', 'player_limit')
        ws.send(packet)
        ws.close()
        return
      }

      // check connection params
      let authToken = params.authToken
      let name = params.name
      let avatar = params.avatar

      // get or create user
      let user
      if (authToken) {
        try {
          const { userId } = await readJWT(authToken)
          user = await this.db('users').where('id', userId).first()
        } catch (err) {
          console.error('failed to read authToken:', authToken)
        }
      }
      if (!user) {
        user = {
          id: uuid(),
          name: 'Anonymous',
          avatar: null,
          rank: 0,
          createdAt: moment().toISOString(),
        }
        await this.db('users').insert(user)
        authToken = await createJWT({ userId: user.id })
      }

      if (name && typeof name === 'string') {
        name = name.trim().slice(0, 24)
        if (name) {
          await this.db('users').where('id', user.id).update({ name })
          user.name = name
        }
      }

      // disconnect if user already in this world
      if (this.sockets.has(user.id)) {
        const packet = writePacket('kick', 'duplicate_user')
        ws.send(packet)
        ws.close()
        return
      }

      // livekit options
      const livekit = await this.world.livekit.serialize(user.id)

      // create socket
      const socket = new Socket({ id: user.id, ws, network: this })

      // spawn player — everyone starts as a spectator in the stands
      const sessionAvatar = AVATAR_SARACEN
      const { position, quaternion } = getPlayerSpawn(this.spawn, sessionAvatar)

      socket.player = this.world.entities.add(
        {
          id: user.id,
          type: 'player',
          position,
          quaternion,
          owner: socket.id, // deprecated, same as userId
          userId: user.id, // deprecated, same as userId
          name: name || user.name,
          health: HEALTH_MAX,
          avatar: user.avatar || this.world.settings.avatar?.url || 'asset://avatar.vrm',
          sessionAvatar,
          rank: user.rank,
          enteredAt: Date.now(),
        },
        true
      )

      this.addScoreboardPlayer(
        socket.player.data.id,
        socket.player.data.name,
        getTeamFromAvatar(sessionAvatar),
        user.wallet_pubkey ?? null
      )

      // send snapshot
      socket.send('snapshot', {
        id: socket.id,
        serverTime: performance.now(),
        assetsUrl: this.world.assetsUrl,
        apiUrl: process.env.PUBLIC_API_URL,
        maxUploadSize: process.env.PUBLIC_MAX_UPLOAD_SIZE,
        collections: this.world.collections.serialize(),
        settings: this.world.settings.serialize(),
        chat: this.world.chat.serialize(),
        ai: this.world.ai.serialize(),
        blueprints: this.world.blueprints.serialize(),
        entities: this.world.entities.serialize(),
        livekit,
        authToken,
        hasAdminCode: !!process.env.ADMIN_CODE,
        scoreboard: this.getScoreboardPayload(),
        matchState: this.getMatchStatePayload(),
        arenaRemnants: serializeArenaRemnants(this.arenaRemnants),
      })

      this.sockets.set(socket.id, socket)

      this.broadcastScoreboard()

      // if this player paid the battle royale entry fee but was never queued
      // (crash, wallet failure, disconnect mid-payment), restore it automatically
      if (user.wallet_pubkey) {
        this.autoRecoverEntryPayment(socket, user.wallet_pubkey)
      }

      // enter events on the server are sent after the snapshot.
      // on the client these are sent during PlayerRemote.js entity instantiation!
      this.world.events.emit('enter', { playerId: socket.player.data.id })
    } catch (err) {
      console.error(err)
    }
  }

  onChatAdded = async (socket, msg) => {
    this.world.chat.add(msg, false)
    this.send('chatAdded', msg, socket.id)
  }

  onSetSolanaWallet = async (socket, data) => {
    if (!socket.player) return
    const wallet = data?.wallet
    if (!wallet || typeof wallet !== 'string') return

    let pubkey
    try {
      pubkey = new PublicKey(wallet)
    } catch {
      return
    }
    const walletPubkey = pubkey.toBase58()

    await this.db('users').where('id', socket.player.data.userId).update({ wallet_pubkey: walletPubkey })

    const entry = this.scoreboard.get(socket.player.data.id)
    if (entry) {
      entry.wallet = walletPubkey
    }

    // a freshly connected wallet may hold an unclaimed entry payment
    this.autoRecoverEntryPayment(socket, walletPubkey)
  }

  /** Put a player whose entry payment is verified into the queue (or the next one if a battle is running). */
  queueVerifiedEntry(socket, playerId, wallet) {
    const br = this.battleRoyale
    if (br.phase === 'queue') {
      br.queued.set(playerId, { wallet })
      this.sendTo(socket.id, 'joinBattleRoyaleResult', { ok: true })
    } else {
      br.nextQueued.set(playerId, { wallet })
      this.sendTo(socket.id, 'joinBattleRoyaleResult', { ok: true, nextRound: true })
      const name = socket.player?.data?.name || 'A gladiator'
      this.announce(`${name} is locked in for the next battle royale.`)
    }
    this.broadcastMatchState()
  }

  /**
   * Silent background check: if this player's wallet paid an entry fee that
   * was never redeemed (crash, extension failure, disconnect mid-payment),
   * re-add them to the queue automatically instead of charging them again.
   */
  async autoRecoverEntryPayment(socket, wallet) {
    const playerId = socket.player?.data?.id
    if (!playerId) return
    const br = this.battleRoyale
    if (br.queued.has(playerId) || br.nextQueued.has(playerId)) return
    if (socket.brVerifying) return
    socket.brVerifying = true
    try {
      // single scan, no retries — a lost payment is long confirmed by now
      const found = await findRecentEntryPayment({ walletPubkey: wallet, playerId, attempts: 1 })
      if (!found) return
      this.queueVerifiedEntry(socket, playerId, wallet)
      this.sendTo(socket.id, 'chatAdded', {
        id: uuid(),
        from: null,
        fromId: null,
        body: 'We found your battle royale entry payment — you are back in the queue.',
        createdAt: moment().toISOString(),
      })
    } catch (err) {
      console.error('[solana] Auto entry recovery failed:', err)
    } finally {
      socket.brVerifying = false
    }
  }

  enterArenaAsFighter(socket) {
    const player = socket.player
    this.setPlayerSessionAvatar(player, AVATAR_CRUSADER)
    this.teleportPlayerToSpawn(player)
    this.broadcastScoreboard()
    this.sendTo(socket.id, 'enterArenaResult', { ok: true })
  }

  // free-play entry — anyone can fight in the arena during the queue period
  onEnterArena = async (socket) => {
    if (!socket.player) return
    if (!isSpectatorSessionAvatar(socket.player.data.sessionAvatar)) return

    if (this.battleRoyale?.phase === 'battle') {
      this.sendTo(socket.id, 'enterArenaResult', {
        ok: false,
        error: 'A battle royale is in progress — wait for the next round.',
      })
      return
    }

    this.enterArenaAsFighter(socket)
  }

  // free-play fighters can return to the stands (not during a battle royale)
  onLeaveArena = async (socket) => {
    if (!socket.player) return
    if (isSpectatorSessionAvatar(socket.player.data.sessionAvatar)) return

    if (this.battleRoyale?.phase === 'battle') {
      this.sendTo(socket.id, 'enterArenaResult', {
        ok: false,
        error: 'You cannot leave during a battle royale.',
      })
      return
    }

    this.setPlayerSessionAvatar(socket.player, AVATAR_SARACEN)
    this.teleportPlayerToSpawn(socket.player)
    this.broadcastScoreboard()
    this.sendTo(socket.id, 'enterArenaResult', { ok: true })
  }

  // paid battle royale queue signup
  onJoinBattleRoyale = async (socket, data) => {
    if (!socket.player) return
    const playerId = socket.player.data.id
    const br = this.battleRoyale

    if (br.queued.has(playerId) || br.nextQueued.has(playerId)) {
      this.sendTo(socket.id, 'joinBattleRoyaleResult', { ok: true, alreadyQueued: true })
      return
    }

    const signature = data?.signature
    const wallet = data?.wallet
    const recover = !!data?.recover
    if (!wallet || (!signature && !recover)) {
      this.sendTo(socket.id, 'joinBattleRoyaleResult', { ok: false, error: 'Payment required' })
      return
    }

    // verification retries take time — don't let the same socket start two
    if (socket.brVerifying) {
      this.sendTo(socket.id, 'joinBattleRoyaleResult', {
        ok: false,
        pending: true,
        error: 'Still verifying your payment — hang tight.',
      })
      return
    }
    socket.brVerifying = true

    try {
      if (signature) {
        await verifyEntryPayment({
          signature,
          walletPubkey: wallet,
          playerId,
        })
      } else {
        // the wallet extension failed before returning a signature — look for
        // the payment on-chain so the player is not charged for nothing
        const found = await findRecentEntryPayment({ walletPubkey: wallet, playerId })
        if (!found) {
          throw new Error('No entry payment found for your wallet. If you paid, it will be restored automatically — you will not be charged twice.')
        }
      }
    } catch (err) {
      console.error('[solana] Battle royale entry verification failed:', err)
      this.sendTo(socket.id, 'joinBattleRoyaleResult', {
        ok: false,
        error: err.message || 'Payment verification failed',
      })
      return
    } finally {
      socket.brVerifying = false
    }

    // verification is async — the queue may have closed in the meantime.
    // the payment is recorded either way, so never drop it: roll it into the
    // next cycle when a battle is underway.
    this.queueVerifiedEntry(socket, playerId, wallet)
  }

  onPlayerHit = async (socket, data) => {
    const { attackerId, targetId, damage, hitPos } = data
    
    // Validate attacker is the socket's player
    if (socket.player.data.id !== attackerId) {
      console.warn('[Server] Player', socket.player.data.id, 'tried to claim hit as', attackerId)
      return
    }

    if (isSpectatorSessionAvatar(socket.player.data.sessionAvatar)) {
      return
    }
    
    // Get target player
    const targetPlayer = this.world.entities.get(targetId)
    if (!targetPlayer || !targetPlayer.isPlayer) {
      console.warn('[Server] Invalid target player:', targetId)
      return
    }
    
    // Apply damage (negative damage = healing)
    const HEALTH_MAX = 100
    const currentHealth = targetPlayer.data.health !== undefined ? targetPlayer.data.health : HEALTH_MAX

    if (damage > 0 && currentHealth <= 0) {
      return
    }

    if (damage > 0) {
      // Cap melee damage — clients can't claim more than a sword hit
      if (typeof damage !== 'number' || damage > SWORD_DAMAGE_MAX) {
        console.warn('[Server] Rejected playerHit with invalid damage:', damage, 'from', attackerId)
        return
      }
      // The attacker must actually be mid-attack (their ef effect is synced on the
      // same socket before the hit packet, so ordering is guaranteed)
      const attackTag = attackTagByEmote[socket.player.data.effect?.emote]
      if (!attackTag) {
        console.warn('[Server] Rejected playerHit — attacker has no active attack effect:', attackerId)
        return
      }
      // Server-side block arbitration: if the target's synced effect says they are
      // holding a matching block, the hit is blocked — regardless of what the
      // attacker's local simulation concluded. This makes the server the single
      // authority when the two clients disagree.
      const blockTag = blockTagByEmote[targetPlayer.data.effect?.emote]
      if (isAttackBlocked(attackTag, blockTag)) {
        console.log('[Server] Hit BLOCKED — attack:', attackTag, 'vs block:', blockTag, '-', attackerId, '->', targetId)
        this.sendTo(socket.id, 'hitBlocked', { attackerId, targetId })
        return
      }
    }

    const newHealth = Math.max(0, Math.min(HEALTH_MAX, currentHealth - damage))
    
    if (damage < 0) {
      console.log('[Server] Player', attackerId, 'healing player', targetId, 'for', Math.abs(damage), 'health:', currentHealth, '->', newHealth)
    } else {
      console.log('[Server] Player', attackerId, 'hit player', targetId, 'for', damage, 'damage:', currentHealth, '->', newHealth)
    }
    
    const deathEffect =
      currentHealth > 0 && newHealth <= 0
        ? { emote: Emotes.DEATH_FALL, duration: 1.5, cancellable: false }
        : null

    // Update target player's health (and clear combat effect on death)
    targetPlayer.modify({ health: newHealth, ...(deathEffect && { ef: deathEffect }) })

    // Broadcast health update immediately — don't wait on kill payout
    this.send('entityModified', {
      id: targetId,
      health: newHealth,
      ...(deathEffect && { ef: deathEffect }),
    })

    if (damage > 0 && hitPos) {
      addArenaBloodHit(this.arenaRemnants, hitPos)
    }

    if (damage > 0 && currentHealth > 0 && newHealth <= 0) {
      this.recordKill(attackerId, targetId)
      this.handleBattleRoyaleElimination(targetId)
    }
  }

  onPlayerRespawn = (socket, data) => {
    const player = socket.player
    const currentHealth = player.data.health !== undefined ? player.data.health : HEALTH_MAX
    if (currentHealth > 0) return

    const p = data?.p || player.data.position
    const q = data?.q || player.data.quaternion
    const corpse = {
      p,
      q,
      sessionAvatar: player.data.sessionAvatar,
    }

    addArenaCorpse(this.arenaRemnants, corpse)

    this.send(
      'playerCorpse',
      {
        playerId: player.data.id,
        ...corpse,
      },
      socket.id
    )

    const teamChanged = this.setPlayerSessionAvatar(player, AVATAR_SARACEN)
    this.teleportPlayerToSpawn(player)
    if (teamChanged) {
      this.broadcastScoreboard()
    }
  }

  onBlockBroken = async (socket, data) => {
    const { kickerId, blockerId } = data

    if (socket.player.data.id !== kickerId) {
      console.warn('[Server] Player', socket.player.data.id, 'tried to claim kick break as', kickerId)
      return
    }

    if (isSpectatorSessionAvatar(socket.player.data.sessionAvatar)) {
      return
    }

    const blocker = this.world.entities.get(blockerId)
    if (!blocker || !blocker.isPlayer) {
      console.warn('[Server] Invalid blocker player:', blockerId)
      return
    }

    const blockEmote = blocker.data.effect?.emote
    if (!blockEmote || !blockEmotes.includes(blockEmote)) {
      console.warn('[Server] blockBroken rejected — target not blocking:', blockerId)
      return
    }

    console.log('[Server] Player', kickerId, 'broke block from player', blockerId)
    this.sendTo(blockerId, 'blockBroken', { kickerId, blockerId })
  }

  onAttackCanceled = async (socket, data) => {
    const { playerId } = data
    
    // Validate player is the socket's player
    if (socket.player.data.id !== playerId) {
      console.warn('[Server] Player', socket.player.data.id, 'tried to cancel attack as', playerId)
      return
    }
    
    console.log('[Server] Player', playerId, 'canceled attack early')
    
    // Broadcast to all other clients (exclude sender)
    this.send('attackCanceled', { playerId }, socket.id)
  }

  onCommand = async (socket, data) => {
    const { args } = data
    // handle slash commands
    const player = socket.player
    const playerId = player.data.id
    const [cmd, arg1, arg2] = args
    // become admin command
    if (cmd === 'admin') {
      const code = arg1
      if (process.env.ADMIN_CODE && process.env.ADMIN_CODE === code) {
        const id = player.data.id
        const userId = player.data.userId
        const granted = !player.isAdmin()
        let rank
        if (granted) {
          rank = Ranks.ADMIN
        } else {
          rank = Ranks.VISITOR
        }
        player.modify({ rank })
        this.send('entityModified', { id, rank })
        socket.send('chatAdded', {
          id: uuid(),
          from: null,
          fromId: null,
          body: granted ? 'Admin granted!' : 'Admin revoked!',
          createdAt: moment().toISOString(),
        })
        await this.db('users').where('id', userId).update({ rank })
      }
    }
    if (cmd === 'name') {
      const name = arg1
      if (name) {
        const id = player.data.id
        const userId = player.data.userId
        player.data.name = name
        player.modify({ name })
        this.send('entityModified', { id, name })
        socket.send('chatAdded', {
          id: uuid(),
          from: null,
          fromId: null,
          body: `Name set to ${name}!`,
          createdAt: moment().toISOString(),
        })
        await this.db('users').where('id', userId).update({ name })
      }
    }
    if (cmd === 'spawn') {
      const op = arg1
      this.onSpawnModified(socket, op)
    }
    if (cmd === 'chat') {
      const op = arg1
      if (op === 'clear' && socket.player.isBuilder()) {
        this.world.chat.clear(true)
      }
    }
    if (cmd === 'server') {
      const op = arg1
      if (op === 'stats') {
        function send(body) {
          socket.send('chatAdded', {
            id: uuid(),
            from: null,
            fromId: null,
            body,
            createdAt: moment().toISOString(),
          })
        }
        const stats = await this.world.monitor.getStats()
        send(`CPU: ${stats.currentCPU.toFixed(3)}%`)
        send(
          `Memory: ${stats.currentMemory} / ${stats.maxMemory} MB (${((stats.currentMemory / stats.maxMemory) * 100).toFixed(1)}%)`
        )
      }
    }
    // emit event for all except admin
    if (cmd !== 'admin') {
      this.world.events.emit('command', { playerId, args })
    }
  }

  onModifyRank = async (socket, data) => {
    if (!socket.player.isAdmin()) return
    const { playerId, rank } = data
    if (!playerId) return
    if (!isNumber(rank)) return
    const player = this.world.entities.get(playerId)
    if (!player || !player.isPlayer) return
    player.modify({ rank })
    this.send('entityModified', { id: playerId, rank })
    await this.db('users').where('id', playerId).update({ rank })
  }

  onKick = (socket, playerId) => {
    const player = this.world.entities.get(playerId)
    if (!player) return
    // admins can kick builders + visitors
    // builders can kick visitors
    // visitors cannot kick anyone
    if (socket.player.data.rank <= player.data.rank) return
    const tSocket = this.sockets.get(playerId)
    tSocket.send('kick', 'moderation')
    tSocket.disconnect()
  }

  onMute = (socket, data) => {
    const player = this.world.entities.get(data.playerId)
    if (!player) return
    // admins can mute builders + visitors
    // builders can mute visitors
    // visitors cannot mute anyone
    if (socket.player.data.rank <= player.data.rank) return
    this.world.livekit.setMuted(data.playerId, data.muted)
  }

  onBlueprintAdded = (socket, blueprint) => {
    if (!socket.player.isBuilder()) {
      return console.error('player attempted to add blueprint without builder permission')
    }
    this.world.blueprints.add(blueprint)
    this.send('blueprintAdded', blueprint, socket.id)
    this.dirtyBlueprints.add(blueprint.id)
  }

  onBlueprintModified = (socket, data) => {
    if (!socket.player.isBuilder()) {
      return console.error('player attempted to modify blueprint without builder permission')
    }
    const blueprint = this.world.blueprints.get(data.id)
    // if new version is greater than current version, allow it
    if (data.version > blueprint.version) {
      this.world.blueprints.modify(data)
      this.send('blueprintModified', data, socket.id)
      this.dirtyBlueprints.add(data.id)
    }
    // otherwise, send a revert back to client, because someone else modified before them
    else {
      socket.send('blueprintModified', blueprint)
    }
  }

  onEntityAdded = (socket, data) => {
    if (!socket.player.isBuilder()) {
      return console.error('player attempted to add entity without builder permission')
    }
    const entity = this.world.entities.add(data)
    this.send('entityAdded', data, socket.id)
    if (entity.isApp) this.dirtyApps.add(entity.data.id)
  }

  onEntityModified = async (socket, data) => {
    const entity = this.world.entities.get(data.id)
    if (!entity) return console.error('onEntityModified: no entity found', data)
    entity.modify(data)
    this.send('entityModified', data, socket.id)
    if (entity.isApp) {
      // mark for saving
      this.dirtyApps.add(entity.data.id)
    }
    if (entity.isPlayer) {
      // persist player name and avatar changes
      const changes = {}
      let changed
      if (data.hasOwnProperty('name')) {
        changes.name = data.name
        changed = true
        if (this.scoreboard.has(data.id)) {
          this.scoreboard.get(data.id).name = data.name
          this.broadcastScoreboard()
        }
      }
      if (data.hasOwnProperty('avatar')) {
        changes.avatar = data.avatar
        changed = true
      }
      if (changed) {
        await this.db('users').where('id', entity.data.userId).update(changes)
      }
    }
  }

  onEntityEvent = (socket, event) => {
    const [id, version, name, data] = event
    const entity = this.world.entities.get(id)
    entity?.onEvent(version, name, data, socket.id)
  }

  onEntityRemoved = (socket, id) => {
    if (!socket.player.isBuilder()) return console.error('player attempted to remove entity without builder permission')
    const entity = this.world.entities.get(id)
    this.world.entities.remove(id)
    this.send('entityRemoved', id, socket.id)
    if (entity.isApp) this.dirtyApps.add(id)
  }

  onSettingsModified = (socket, data) => {
    if (!socket.player.isBuilder())
      return console.error('player attempted to modify settings without builder permission')
    this.world.settings.set(data.key, data.value)
    this.send('settingsModified', data, socket.id)
  }

  onSpawnModified = async (socket, op) => {
    if (!socket.player.isBuilder()) {
      return console.error('player attempted to modify spawn without builder permission')
    }
    const player = socket.player
    if (op === 'set') {
      this.spawn = { position: player.data.position.slice(), quaternion: player.data.quaternion.slice() }
    } else if (op === 'clear') {
      this.spawn = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
    } else {
      return
    }
    const data = JSON.stringify(this.spawn)
    await this.db('config')
      .insert({
        key: 'spawn',
        value: data,
      })
      .onConflict('key')
      .merge({
        value: data,
      })
    socket.send('chatAdded', {
      id: uuid(),
      from: null,
      fromId: null,
      body: op === 'set' ? 'Spawn updated' : 'Spawn cleared',
      createdAt: moment().toISOString(),
    })
  }

  onPlayerTeleport = (socket, data) => {
    this.sendTo(data.networkId, 'playerTeleport', data)
  }

  onPlayerPush = (socket, data) => {
    this.sendTo(data.networkId, 'playerPush', data)
  }

  onPlayerSessionAvatar = (socket, data) => {
    // Broadcast to all clients so everyone sees the avatar change
    this.send('playerSessionAvatar', { networkId: data.networkId, avatar: data.avatar })
  }

  onAi = (socket, action) => {
    if (!socket.player.isBuilder()) {
      return console.error('player attempted to use ai but they are not a builder')
    }
    this.world.ai.onAction(action)
  }

  onPing = (socket, time) => {
    socket.send('pong', time)
  }

  onDisconnect = (socket, code) => {
    const playerId = socket.player?.data?.id
    if (playerId) {
      this.removeScoreboardPlayer(playerId)
      this.handleBattleRoyaleElimination(playerId)
    }
    this.world.livekit.clearModifiers(socket.id)
    socket.player?.destroy(true)
    this.sockets.delete(socket.id)
  }
}
