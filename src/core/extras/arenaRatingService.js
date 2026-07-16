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

/** UTC hour key — hourly board resets at the top of each UTC hour. */
export function ratingPeriodKey(when = moment.utc()) {
  return moment.utc(when).format('YYYY-MM-DDTHH')
}

/** Previous UTC hour key — used for the frozen "Last Hour" board. */
export function previousRatingPeriodKey(when = moment.utc()) {
  return moment.utc(when).subtract(1, 'hour').format('YYYY-MM-DDTHH')
}

function normalizeUsername(username) {
  const name = typeof username === 'string' ? username.trim() : ''
  return name.slice(0, 24) || 'Gladiator'
}

function freshDailyFields(period = ratingPeriodKey()) {
  return {
    daily_day: period,
    daily_rating: ARENA_START_RATING,
    daily_kills: 0,
    daily_deaths: 0,
    daily_wins: 0,
  }
}

/**
 * Freeze the previous UTC hour's hourly board into `arena_last_hour` before
 * lazy wipes destroy it. Safe to call often — no-ops once that hour is stored.
 */
export async function ensureLastHourSnapshot(db) {
  const prev = previousRatingPeriodKey()
  const existing = await db('arena_last_hour').select('period').first()
  if (existing?.period === prev) return

  const rows = await db('arena_ratings')
    .where('daily_day', prev)
    .whereNotNull('daily_rating')
    .orderBy('daily_rating', 'desc')
    .limit(100)

  await db.transaction(async trx => {
    // Re-check inside the transaction in case another request already snapshotted
    const again = await trx('arena_last_hour').select('period').first()
    if (again?.period === prev) return

    await trx('arena_last_hour').del()
    if (!rows.length) return

    await trx('arena_last_hour').insert(
      rows.map(r => ({
        wallet_pubkey: r.wallet_pubkey,
        username: r.username,
        rating: r.daily_rating,
        kills: r.daily_kills || 0,
        deaths: r.daily_deaths || 0,
        wins: r.daily_wins || 0,
        period: prev,
      }))
    )
  })
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
 * Lazy wipe: if the UTC hour rolled, reset this wallet's hourly rating to 1000
 * with zeroed hourly K/D/W before applying this period's event.
 * Snapshots the previous hour's board first so "Last Hour" stays available.
 */
async function ensureDailyPeriod(db, walletPubkey) {
  const row = await db('arena_ratings').where('wallet_pubkey', walletPubkey).first()
  if (!row) return
  const period = ratingPeriodKey()
  if (row.daily_day === period && row.daily_rating != null) return
  await ensureLastHourSnapshot(db)
  await db('arena_ratings').where('wallet_pubkey', walletPubkey).update(freshDailyFields(period))
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

/** Current UTC hour ratings (everyone starts at 1000 when the hour rolls). */
export async function getDailyLeaderboard(db, limit = 25) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25))
  const period = ratingPeriodKey()
  // Catch hour rollover even before the first paid event of the new hour
  await ensureLastHourSnapshot(db)
  return db('arena_ratings')
    .where('daily_day', period)
    .whereNotNull('daily_rating')
    .orderBy('daily_rating', 'desc')
    .limit(safeLimit)
}

/** Frozen previous UTC hour board (snapshot taken when the hourly list wipes). */
export async function getLastHourLeaderboard(db, limit = 25) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25))
  await ensureLastHourSnapshot(db)
  return db('arena_last_hour').orderBy('rating', 'desc').limit(safeLimit)
}

export async function getLastHourByWallet(db, walletPubkey) {
  if (!walletPubkey) return null
  await ensureLastHourSnapshot(db)
  return db('arena_last_hour').where('wallet_pubkey', walletPubkey).first()
}

/** Map a DB row to the API shape. Hourly board uses this hour's wiped rating + stats. */
export function toLeaderboardPlayer(row, { daily = false, lastHour = false } = {}) {
  if (!row) return null
  if (lastHour) {
    return {
      wallet: row.wallet_pubkey,
      username: row.username,
      rating: row.rating,
      kills: row.kills || 0,
      deaths: row.deaths || 0,
      wins: row.wins || 0,
    }
  }
  const period = ratingPeriodKey()
  const dailyActive = row.daily_day === period && row.daily_rating != null
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
