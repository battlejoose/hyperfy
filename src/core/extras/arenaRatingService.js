import {
  ARENA_DEATH_RATING,
  ARENA_KILL_RATING,
  ARENA_LEADERBOARD_LIMIT,
  ARENA_START_RATING,
  ARENA_WIN_BONUS,
  clampArenaRating,
} from './arenaRating.js'

function readRating(user) {
  return user?.arena_rating ?? ARENA_START_RATING
}

function readCount(user, key) {
  return user?.[key] ?? 0
}

export function serializeArenaStats(user) {
  if (!user) return null
  return {
    rating: readRating(user),
    wins: readCount(user, 'arena_wins'),
    kills: readCount(user, 'arena_kills'),
    deaths: readCount(user, 'arena_deaths'),
    matches: readCount(user, 'arena_matches'),
  }
}

export async function getUserArenaStats(db, userId) {
  const user = await db('users').where('id', userId).first()
  return serializeArenaStats(user)
}

export async function getArenaLeaderboard(db, limit = ARENA_LEADERBOARD_LIMIT) {
  const rows = await db('users')
    .select('id', 'name', 'arena_rating', 'arena_wins', 'arena_kills', 'arena_deaths', 'arena_matches')
    .where(builder => {
      builder.where('arena_matches', '>', 0).orWhere('arena_kills', '>', 0).orWhere('arena_wins', '>', 0)
    })
    .orderBy('arena_rating', 'desc')
    .orderBy('arena_wins', 'desc')
    .orderBy('name', 'asc')
    .limit(limit)

  return rows.map((row, index) => ({
    rank: index + 1,
    id: row.id,
    name: row.name,
    rating: row.arena_rating ?? ARENA_START_RATING,
    wins: row.arena_wins ?? 0,
    kills: row.arena_kills ?? 0,
    deaths: row.arena_deaths ?? 0,
    matches: row.arena_matches ?? 0,
  }))
}

export async function recordPaidBattleRoyaleMatches(db, playerIds) {
  if (!playerIds.length) return
  await db('users').whereIn('id', playerIds).increment('arena_matches', 1)
}

export async function applyArenaKillRating(db, killerId) {
  const user = await db('users').where('id', killerId).first()
  if (!user) return null

  const rating = clampArenaRating(readRating(user) + ARENA_KILL_RATING)
  await db('users')
    .where('id', killerId)
    .update({
      arena_rating: rating,
      arena_kills: readCount(user, 'arena_kills') + 1,
    })

  return {
    userId: killerId,
    name: user.name,
    rating,
    delta: ARENA_KILL_RATING,
    reason: 'kill',
  }
}

export async function applyArenaDeathRating(db, victimId) {
  const user = await db('users').where('id', victimId).first()
  if (!user) return null

  const rating = clampArenaRating(readRating(user) - ARENA_DEATH_RATING)
  await db('users')
    .where('id', victimId)
    .update({
      arena_rating: rating,
      arena_deaths: readCount(user, 'arena_deaths') + 1,
    })

  return {
    userId: victimId,
    name: user.name,
    rating,
    delta: -ARENA_DEATH_RATING,
    reason: 'death',
  }
}

export async function applyArenaWinRating(db, winnerId) {
  const user = await db('users').where('id', winnerId).first()
  if (!user) return null

  const rating = clampArenaRating(readRating(user) + ARENA_WIN_BONUS)
  await db('users')
    .where('id', winnerId)
    .update({
      arena_rating: rating,
      arena_wins: readCount(user, 'arena_wins') + 1,
    })

  return {
    userId: winnerId,
    name: user.name,
    rating,
    delta: ARENA_WIN_BONUS,
    reason: 'win',
  }
}
