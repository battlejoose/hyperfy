export function getScoreboardPlayers(data) {
  return Array.isArray(data) ? data : data?.players ?? []
}

export function getTeamKills(data) {
  if (Array.isArray(data)) return null
  return data?.teamKills ?? null
}
