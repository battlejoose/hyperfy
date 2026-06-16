import { useEffect, useMemo, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { getScoreboardPlayers } from '../../core/extras/scoreboardUtils'
import { isSpectatorSessionAvatar } from '../../core/extras/playerAvatars'

export function PlayerQueueList({ world }) {
  const [rows, setRows] = useState(() => getScoreboardPlayers(world.network?.scoreboard))
  const [player, setPlayer] = useState(() => world.entities?.player)

  useEffect(() => {
    const onScoreboard = data => {
      setRows(getScoreboardPlayers(data))
      setPlayer(world.entities.player)
    }
    world.on('scoreboard', onScoreboard)
    if (world.network?.scoreboard) {
      onScoreboard(world.network.scoreboard)
    }
    return () => world.off('scoreboard', onScoreboard)
  }, [world])

  useEffect(() => {
    const onPlayer = p => setPlayer(p)
    world.on('player', onPlayer)
    return () => world.off('player', onPlayer)
  }, [world])

  const isSpectator = player && isSpectatorSessionAvatar(player.data.sessionAvatar)

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [rows]
  )

  if (!isSpectator) return null

  const enterArena = () => {
    world.network.send('enterArena', {})
  }

  return (
    <div
      css={css`
        position: absolute;
        top: 5.5rem;
        right: 1rem;
        width: min(18rem, calc(100vw - 2rem));
        max-height: calc(100vh - 7rem);
        display: flex;
        flex-direction: column;
        pointer-events: auto;
        z-index: 997;
        background: rgba(15, 16, 24, 0.72);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 12px 48px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(8px);
        .arena-header {
          padding: 0.85rem 1rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
        }
        .arena-title {
          font-size: 0.95rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .arena-subtitle {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.55);
          line-height: 1.35;
        }
        .arena-enter {
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(255, 255, 255, 0.06);
          color: white;
          border-radius: 8px;
          padding: 0.55rem 0.75rem;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
          &:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.28);
          }
        }
        .arena-list {
          overflow-y: auto;
          padding: 0.35rem 0;
        }
        .arena-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.65rem;
          padding: 0.55rem 1rem;
          color: rgba(255, 255, 255, 0.92);
          font-size: 0.92rem;
          & + .arena-row {
            border-top: 1px solid rgba(255, 255, 255, 0.06);
          }
        }
        .arena-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .arena-stat {
          color: rgba(255, 255, 255, 0.55);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }
        .arena-empty {
          padding: 1rem;
          text-align: center;
          color: rgba(255, 255, 255, 0.45);
          font-size: 0.85rem;
        }
      `}
    >
      <div className='arena-header'>
        <div className='arena-title'>The Arena</div>
        <div className='arena-subtitle'>Enter the arena to fight as a gladiator. If you fall, return here as a spectator.</div>
        <button type='button' className='arena-enter' onClick={enterArena}>
          Enter the Arena
        </button>
      </div>
      <div className='arena-list'>
        {sortedRows.length ? (
          sortedRows.map(row => (
            <div className='arena-row' key={row.id}>
              <span className='arena-name'>{row.name}</span>
              <span className='arena-stat'>{row.kills}K / {row.deaths}D</span>
            </div>
          ))
        ) : (
          <div className='arena-empty'>No players yet</div>
        )}
      </div>
    </div>
  )
}
