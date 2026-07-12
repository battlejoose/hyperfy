export const ARENA_START_RATING = 1000
export const ARENA_KILL_RATING = 15
export const ARENA_DEATH_RATING = 10
export const ARENA_WIN_BONUS = 50
export const ARENA_MIN_RATING = 0
export const ARENA_LEADERBOARD_LIMIT = 25

export function clampArenaRating(rating) {
  return Math.max(ARENA_MIN_RATING, Math.round(rating))
}

export function formatArenaRatingDelta(delta) {
  if (delta > 0) return `+${delta}`
  return `${delta}`
}
