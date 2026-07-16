/**
 * Sequential 1v1 tournament bracket helpers.
 * Odd rounds: one random player gets a bye (no power-of-2 padding).
 */

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildRound(playerIds, roundIndex) {
  const ids = [...playerIds]
  let bye = null
  if (ids.length % 2 === 1) {
    const idx = Math.floor(Math.random() * ids.length)
    bye = ids.splice(idx, 1)[0]
  }
  const matches = []
  for (let i = 0; i < ids.length; i += 2) {
    matches.push({
      id: `r${roundIndex}m${i / 2}`,
      a: ids[i],
      b: ids[i + 1],
      winner: null,
      loser: null,
      status: 'pending', // pending | live | done
    })
  }
  return { index: roundIndex, matches, bye }
}

/** Create a bracket from queued player ids (shuffled). */
export function createBracket(playerIds) {
  const shuffled = shuffle(playerIds.filter(Boolean))
  if (shuffled.length < 2) {
    return { rounds: [], currentRoundIndex: 0 }
  }
  return {
    rounds: [buildRound(shuffled, 0)],
    currentRoundIndex: 0,
  }
}

export function findMatch(bracket, matchId) {
  if (!bracket?.rounds) return null
  for (const round of bracket.rounds) {
    const match = round.matches.find(m => m.id === matchId)
    if (match) return match
  }
  return null
}

/** First unfinished match in the current round (sequential). */
export function getCurrentMatch(bracket) {
  const round = bracket?.rounds?.[bracket.currentRoundIndex]
  if (!round) return null
  return round.matches.find(m => m.status === 'pending' || m.status === 'live') || null
}

export function markMatchLive(bracket, matchId) {
  const match = findMatch(bracket, matchId)
  if (match && match.status === 'pending') match.status = 'live'
  return match
}

/**
 * Complete a match with winnerId. Builds the next round when the current
 * round finishes. Returns { done, championId, nextMatch }.
 */
export function completeMatch(bracket, matchId, winnerId) {
  const round = bracket.rounds[bracket.currentRoundIndex]
  if (!round) return { done: true, championId: winnerId || null, nextMatch: null }

  const match = round.matches.find(m => m.id === matchId)
  if (!match) return { done: false, championId: null, nextMatch: getCurrentMatch(bracket) }

  if (match.status === 'done') {
    return { done: false, championId: null, nextMatch: getCurrentMatch(bracket) }
  }

  const winner = winnerId === match.a || winnerId === match.b ? winnerId : null
  if (!winner) {
    match.winner = match.a || match.b
    match.loser = match.winner === match.a ? match.b : match.a
  } else {
    match.winner = winner
    match.loser = match.a === winner ? match.b : match.a
  }
  match.status = 'done'

  if (!round.matches.every(m => m.status === 'done')) {
    return { done: false, championId: null, nextMatch: getCurrentMatch(bracket) }
  }

  const advancers = round.matches.map(m => m.winner).filter(Boolean)
  if (round.bye) advancers.push(round.bye)

  if (advancers.length <= 1) {
    return { done: true, championId: advancers[0] || null, nextMatch: null }
  }

  const nextIndex = bracket.currentRoundIndex + 1
  bracket.rounds.push(buildRound(advancers, nextIndex))
  bracket.currentRoundIndex = nextIndex
  return { done: false, championId: null, nextMatch: getCurrentMatch(bracket) }
}

/** True if playerId is still able to fight in a future/current match. */
export function isStillInTournament(bracket, playerId) {
  if (!bracket || !playerId) return false
  for (let r = bracket.currentRoundIndex; r < bracket.rounds.length; r++) {
    const round = bracket.rounds[r]
    if (round.bye === playerId) return true
    for (const m of round.matches) {
      if (m.status === 'done') continue
      if (m.a === playerId || m.b === playerId) return true
    }
  }
  return false
}
