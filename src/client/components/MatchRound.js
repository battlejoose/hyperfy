import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function MatchRound({ world }) {
  const [match, setMatch] = useState(() => world.network?.matchState)
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    const onMatchState = data => setMatch(data)
    world.on('matchState', onMatchState)
    if (world.network?.matchState) {
      onMatchState(world.network.matchState)
    }
    return () => world.off('matchState', onMatchState)
  }, [world])

  useEffect(() => {
    if (!match) return
    const update = () => {
      if (match.phase !== 'queue' || !match.endsAt) {
        setRemaining(0)
        return
      }
      setRemaining(Math.max(0, Math.ceil(match.endsAt - world.network.getTime())))
    }
    update()
    const id = setInterval(update, 200)
    return () => clearInterval(id)
  }, [match, world])

  if (!match) return null

  if (match.phase === 'queue') {
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
        <div className='match-countdown-label'>Battle Royale In</div>
        <div className='match-countdown-time'>{formatTime(remaining)}</div>
      </div>
    )
  }

  if (match.phase === 'battle') {
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
          .match-battle-label {
            font-size: 1.35rem;
            font-weight: 800;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #fbbf24;
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
          }
          .match-battle-alive {
            font-size: 0.95rem;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.85);
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
          }
        `}
      >
        <div className='match-battle-label'>Battle Royale</div>
        <div className='match-battle-alive'>{match.aliveCount ?? 0} fighters remain</div>
      </div>
    )
  }

  return null
}
