import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { getTeamKills } from '../../core/extras/scoreboardUtils'

function readTeamKills(data) {
  const teamKills = getTeamKills(data)
  return {
    crusader: teamKills?.crusader ?? 0,
    saracen: teamKills?.saracen ?? 0,
  }
}

export function TeamScore({ world }) {
  const [crusaderKills, setCrusaderKills] = useState(
    () => readTeamKills(world.network?.scoreboard).crusader
  )
  const [saracenKills, setSaracenKills] = useState(
    () => readTeamKills(world.network?.scoreboard).saracen
  )

  useEffect(() => {
    const onScoreboard = data => {
      const { crusader, saracen } = readTeamKills(data)
      setCrusaderKills(crusader)
      setSaracenKills(saracen)
    }
    world.on('scoreboard', onScoreboard)
    if (world.network?.scoreboard) {
      onScoreboard(world.network.scoreboard)
    }
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
        pointer-events: none;
        z-index: 999;
        .team-score {
          position: absolute;
          font-size: 2.75rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1;
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
        }
        .team-score.crusader {
          left: 25%;
          transform: translateX(-50%);
          color: #ef4444;
        }
        .team-score.saracen {
          left: 75%;
          transform: translateX(-50%);
          color: #eab308;
        }
      `}
    >
      <div className='team-score crusader'>{crusaderKills}</div>
      <div className='team-score saracen'>{saracenKills}</div>
    </div>
  )
}
