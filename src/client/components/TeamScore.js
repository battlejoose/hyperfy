import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'

function sumTeamKills(entries, team) {
  let total = 0
  for (const row of entries) {
    const rowTeam = row.team ?? 'crusader'
    if (rowTeam === team) total += row.kills ?? 0
  }
  return total
}

export function TeamScore({ world }) {
  const [crusaderKills, setCrusaderKills] = useState(0)
  const [saracenKills, setSaracenKills] = useState(0)

  useEffect(() => {
    const onScoreboard = entries => {
      const rows = Array.isArray(entries) ? entries : []
      setCrusaderKills(sumTeamKills(rows, 'crusader'))
      setSaracenKills(sumTeamKills(rows, 'saracen'))
    }
    world.on('scoreboard', onScoreboard)
    return () => {
      world.off('scoreboard', onScoreboard)
    }
  }, [world])

  return (
    <div
      css={css`
        position: absolute;
        top: 0.75rem;
        left: 0;
        right: 0;
        display: flex;
        justify-content: space-between;
        padding: 0 2rem;
        pointer-events: none;
        z-index: 999;
        .team-score {
          font-size: 2.75rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1;
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
        }
        .team-score.crusader {
          color: #ef4444;
        }
        .team-score.saracen {
          color: #eab308;
        }
      `}
    >
      <div className='team-score crusader'>{crusaderKills}</div>
      <div className='team-score saracen'>{saracenKills}</div>
    </div>
  )
}
