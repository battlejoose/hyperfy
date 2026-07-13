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

function normalizeUsername(username) {
  const name = typeof username === 'string' ? username.trim() : ''
  return name.slice(0, 24) || 'Gladiator'
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
    updated_at: nowIso(),
  }
  try {
    await db('arena_ratings').insert(row)
  } catch {
    // concurrent insert — fall through to read
  }
  return (await db('arena_ratings').where('wallet_pubkey', walletPubkey).first()) || row
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
  await db('arena_ratings')
    .where('wallet_pubkey', walletPubkey)
    .update({
      rating: db.raw('rating + ?', [ARENA_KILL_RATING]),
      kills: db.raw('kills + 1'),
      updated_at: nowIso(),
    })
  return getByWallet(db, walletPubkey)
}

export async function applyDeath(db, walletPubkey, username) {
  if (!walletPubkey) return null
  await ensureRow(db, walletPubkey, username)
  await db('arena_ratings')
    .where('wallet_pubkey', walletPubkey)
    .update({
      rating: db.raw('CASE WHEN rating > ? THEN rating - ? ELSE 0 END', [
        ARENA_DEATH_RATING,
        ARENA_DEATH_RATING,
      ]),
      deaths: db.raw('deaths + 1'),
      updated_at: nowIso(),
    })
  return getByWallet(db, walletPubkey)
}

export async function applyWin(db, walletPubkey, username) {
  if (!walletPubkey) return null
  await ensureRow(db, walletPubkey, username)
  await db('arena_ratings')
    .where('wallet_pubkey', walletPubkey)
    .update({
      rating: db.raw('rating + ?', [ARENA_WIN_BONUS]),
      wins: db.raw('wins + 1'),
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
