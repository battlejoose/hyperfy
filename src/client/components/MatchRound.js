import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'

// during the queue phase the countdown lives in the arena scroll panel
// (PlayerQueueList) — this component only shows the active-battle banner
export function MatchRound({ world }) {
  const [match, setMatch] = useState(() => world.network?.matchState)

  useEffect(() => {
    const onMatchState = data => setMatch(data)
    world.on('matchState', onMatchState)
    if (world.network?.matchState) {
      onMatchState(world.network.matchState)
    }
    return () => world.off('matchState', onMatchState)
  }, [world])

  if (!match) return null

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
