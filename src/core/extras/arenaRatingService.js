import moment from 'moment'

import {
  ARENA_DEATH_RATING,
  ARENA_KILL_RATING,
  ARENA_START_RATING,
  ARENA_WIN_BONUS,
} from './arenaRating.js'

function nowIso() {
  return moment().toISOString()
}

/** UTC calendar day key — daily board resets at UTC midnight. */
export function utcDayKey(when = moment.utc()) {
  return moment.utc(when).format('YYYY-MM-DD')
}

function normalizeUsername(username) {
  const name = typeof username === 'string' ? username.trim() : ''
  return name.slice(0, 24) || 'Gladiator'
}

function freshDailyFields(today = utcDayKey()) {
  return {
    daily_day: today,
    daily_rating: ARENA_START_RATING,
    daily_kills: 0,
    daily_deaths: 0,
    daily_wins: 0,
  }
}

async function ensureRow(db, walletPubkey, username) {
  const existing = await db('arena_ratings').where('wallet_pubkey', walletPubkey).first()
  if (existing) return existing
  const row = {
    wallet_pubkey: walletPubkey,
    username: normalizeUsername(username),
    rating: ARENA_START_RATING,
    kills: 0,
    deaths: 0,
    wins: 0,
    ...freshDailyFields(),
    updated_at: nowIso(),
  }
  try {
    await db('arena_ratings').insert(row)
  } catch {
    // concurrent insert — fall through to read
  }
  return (await db('arena_ratings').where('wallet_pubkey', walletPubkey).first()) || row
}

/**
 * Lazy wipe: if the UTC day rolled, reset this wallet's daily rating to 1000
 * with zeroed daily K/D/W before applying today's event.
 */
async function ensureDailyPeriod(db, walletPubkey) {
  const row = await db('arena_ratings').where('wallet_pubkey', walletPubkey).first()
  if (!row) return
  const today = utcDayKey()
  if (row.daily_day === today && row.daily_rating != null) return
  await db('arena_ratings').where('wallet_pubkey', walletPubkey).update(freshDailyFields(today))
}

export async function upsertWalletProfile(db, walletPubkey, username) {
  if (!walletPubkey) return null
  const name = normalizeUsername(username)
  const existing = await db('arena_ratings').where('wallet_pubkey', walletPubkey).first()
  if (existing) {
    if (existing.username === name) return existing
    await db('arena_ratings').where('wallet_pubkey', walletPubkey).update({
      username: name,
      updated_at: nowIso(),
    })
    return { ...existing, username: name }
  }
  return ensureRow(db, walletPubkey, name)
}

export async function applyKill(db, walletPubkey, username) {
  if (!walletPubkey) return null
  await ensureRow(db, walletPubkey, username)
  await ensureDailyPeriod(db, walletPubkey)
  await db('arena_ratings')
    .where('wallet_pubkey', walletPubkey)
    .update({
      rating: db.raw('rating + ?', [ARENA_KILL_RATING]),
      kills: db.raw('kills + 1'),
      daily_rating: db.raw('daily_rating + ?', [ARENA_KILL_RATING]),
      daily_kills: db.raw('daily_kills + 1'),
      updated_at: nowIso(),
    })
  return getByWallet(db, walletPubkey)
}

export async function applyDeath(db, walletPubkey, username) {
  if (!walletPubkey) return null
  await ensureRow(db, walletPubkey, username)
  await ensureDailyPeriod(db, walletPubkey)
  await db('arena_ratings')
    .where('wallet_pubkey', walletPubkey)
    .update({
      rating: db.raw('CASE WHEN rating > ? THEN rating - ? ELSE 0 END', [
        ARENA_DEATH_RATING,
        ARENA_DEATH_RATING,
      ]),
      deaths: db.raw('deaths + 1'),
      daily_rating: db.raw('CASE WHEN daily_rating > ? THEN daily_rating - ? ELSE 0 END', [
        ARENA_DEATH_RATING,
        ARENA_DEATH_RATING,
      ]),
      daily_deaths: db.raw('daily_deaths + 1'),
      updated_at: nowIso(),
    })
  return getByWallet(db, walletPubkey)
}

export async function applyWin(db, walletPubkey, username) {
  if (!walletPubkey) return null
  await ensureRow(db, walletPubkey, username)
  await ensureDailyPeriod(db, walletPubkey)
  await db('arena_ratings')
    .where('wallet_pubkey', walletPubkey)
    .update({
      rating: db.raw('rating + ?', [ARENA_WIN_BONUS]),
      wins: db.raw('wins + 1'),
      daily_rating: db.raw('daily_rating + ?', [ARENA_WIN_BONUS]),
      daily_wins: db.raw('daily_wins + 1'),
      updated_at: nowIso(),
    })
  return getByWallet(db, walletPubkey)
}

export async function getByWallet(db, walletPubkey) {
  if (!walletPubkey) return null
  return db('arena_ratings').where('wallet_pubkey', walletPubkey).first()
}

export async function getLeaderboard(db, limit = 25) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25))
  return db('arena_ratings').orderBy('rating', 'desc').limit(safeLimit)
}

/** Today's UTC daily ratings (everyone starts at 1000 when the day rolls). */
export async function getDailyLeaderboard(db, limit = 25) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25))
  const today = utcDayKey()
  return db('arena_ratings')
    .where('daily_day', today)
    .whereNotNull('daily_rating')
    .orderBy('daily_rating', 'desc')
    .limit(safeLimit)
}

/** Map a DB row to the API shape. Daily board uses today's wiped rating + stats. */
export function toLeaderboardPlayer(row, { daily = false } = {}) {
  if (!row) return null
  const today = utcDayKey()
  const dailyActive = row.daily_day === today && row.daily_rating != null
  if (daily) {
    return {
      wallet: row.wallet_pubkey,
      username: row.username,
      rating: dailyActive ? row.daily_rating : null,
      kills: dailyActive ? row.daily_kills || 0 : 0,
      deaths: dailyActive ? row.daily_deaths || 0 : 0,
      wins: dailyActive ? row.daily_wins || 0 : 0,
    }
  }
  return {
    wallet: row.wallet_pubkey,
    username: row.username,
    rating: row.rating,
    kills: row.kills,
    deaths: row.deaths,
    wins: row.wins,
  }
}
