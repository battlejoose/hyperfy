import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { getScoreboardPlayers } from '../../core/extras/scoreboardUtils'
import { ScoreboardPanel } from './ScoreboardPanel'

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function getWinnerText(winner) {
  if (!winner) return 'Draw!'
  if (typeof winner === 'string') {
    if (winner === 'draw') return 'Draw!'
    return `${winner} Wins!`
  }
  if (winner.reason === 'draw' || !winner.name) return 'Draw!'
  return `${winner.name} Wins!`
}

function getWinnerColor(winner) {
  if (!winner || winner === 'draw') return 'rgba(255, 255, 255, 0.95)'
  if (typeof winner === 'string') {
    if (winner === 'crusader') return '#ef4444'
    if (winner === 'saracen') return '#eab308'
    return 'rgba(255, 255, 255, 0.95)'
  }
  if (winner.reason === 'draw' || !winner.name) return 'rgba(255, 255, 255, 0.95)'
  return '#fbbf24'
}

export function MatchRound({ world }) {
  const [match, setMatch] = useState(() => world.network?.matchState)
  const [remaining, setRemaining] = useState(0)
  const [rows, setRows] = useState(() => getScoreboardPlayers(world.network?.scoreboard))

  useEffect(() => {
    const onMatchState = data => setMatch(data)
    world.on('matchState', onMatchState)
    if (world.network?.matchState) {
      onMatchState(world.network.matchState)
    }
    return () => world.off('matchState', onMatchState)
  }, [world])

  useEffect(() => {
    const onScoreboard = data => setRows(getScoreboardPlayers(data))
    world.on('scoreboard', onScoreboard)
    if (world.network?.scoreboard) {
      onScoreboard(world.network.scoreboard)
    }
    return () => world.off('scoreboard', onScoreboard)
  }, [world])

  useEffect(() => {
    if (!match) return
    const update = () => {
      let endsAt = null
      if (match.phase === 'playing') endsAt = match.roundEndsAt
      else if (match.phase === 'countdown') endsAt = match.countdownEndsAt
      else if (match.phase === 'results') endsAt = match.resultsEndsAt
      if (endsAt == null) {
        setRemaining(0)
        return
      }
      setRemaining(Math.max(0, Math.ceil(endsAt - world.network.getTime())))
    }
    update()
    const id = setInterval(update, 200)
    return () => clearInterval(id)
  }, [match, world])

  if (!match) return null

  if (match.phase === 'countdown') {
    return (
      <div
        css={css`
          position: absolute;
          top: 0.75rem;
          left: 50%;
          transform: translateX(-50%);
          pointer-events: none;
          z-index: 998;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
          .match-countdown-label {
            font-size: 0.95rem;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.72);
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
          }
          .match-countdown-time {
            font-size: 2.75rem;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            line-height: 1;
            color: rgba(255, 255, 255, 0.95);
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
          }
        `}
      >
        <div className='match-countdown-label'>Arena Opens In</div>
        <div className='match-countdown-time'>{formatTime(remaining)}</div>
      </div>
    )
  }

  if (match.phase === 'playing') {
    return (
      <div
        css={css`
          position: absolute;
          top: 0.75rem;
          left: 50%;
          transform: translateX(-50%);
          pointer-events: none;
          z-index: 998;
          font-size: 2.75rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1;
          color: rgba(255, 255, 255, 0.95);
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
        `}
      >
        {formatTime(remaining)}
      </div>
    )
  }

  if (match.phase === 'results') {
    return (
      <div
        css={css`
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 1001;
          gap: 1.5rem;
          .match-winner {
            font-size: 3.5rem;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            text-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
            text-align: center;
            line-height: 1.1;
          }
        `}
      >
        <div className='match-winner' style={{ color: getWinnerColor(match.winner) }}>
          {getWinnerText(match.winner)}
        </div>
        <ScoreboardPanel rows={rows} title='Scoreboard' />
      </div>
    )
  }

  return null
}
