import { useEffect, useMemo, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { CheckIcon } from 'lucide-react'
import { getScoreboardPlayers } from '../../core/extras/scoreboardUtils'

const visibleQueuePhases = new Set(['lobby', 'countdown'])
const queueTogglePhases = new Set(['lobby', 'countdown'])

export function PlayerQueueList({ world }) {
  const [rows, setRows] = useState(() => getScoreboardPlayers(world.network?.scoreboard))
  const [match, setMatch] = useState(() => world.network?.matchState)
  const [localQueued, setLocalQueued] = useState(false)

  useEffect(() => {
    const onScoreboard = data => {
      setRows(getScoreboardPlayers(data))
    }
    world.on('scoreboard', onScoreboard)
    if (world.network?.scoreboard) {
      onScoreboard(world.network.scoreboard)
    }
    return () => world.off('scoreboard', onScoreboard)
  }, [world])

  useEffect(() => {
    const onMatchState = data => setMatch(data)
    world.on('matchState', onMatchState)
    if (world.network?.matchState) {
      onMatchState(world.network.matchState)
    }
    return () => world.off('matchState', onMatchState)
  }, [world])

  const localPlayerId = world.entities?.player?.data?.id
  const canQueue = queueTogglePhases.has(match?.phase)

  useEffect(() => {
    if (!localPlayerId) return
    const self = rows.find(row => row.id === localPlayerId)
    setLocalQueued(!!self?.queued)
  }, [rows, localPlayerId])

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [rows]
  )

  if (!match || !visibleQueuePhases.has(match.phase)) return null

  const toggleQueue = () => {
    if (!canQueue) return
    world.network.send('fightQueueToggle', {})
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
        .queue-header {
          padding: 0.85rem 1rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
        }
        .queue-title {
          font-size: 0.95rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .queue-subtitle {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.55);
          line-height: 1.35;
        }
        .queue-toggle {
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
          &.queued {
            background: rgba(34, 197, 94, 0.18);
            border-color: rgba(34, 197, 94, 0.45);
          }
        }
        .queue-list {
          overflow-y: auto;
          padding: 0.35rem 0;
        }
        .queue-row {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          padding: 0.55rem 1rem;
          color: rgba(255, 255, 255, 0.92);
          font-size: 0.92rem;
          & + .queue-row {
            border-top: 1px solid rgba(255, 255, 255, 0.06);
          }
        }
        .queue-check {
          width: 1.1rem;
          height: 1.1rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          color: #22c55e;
        }
        .queue-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .queue-empty {
          padding: 1rem;
          text-align: center;
          color: rgba(255, 255, 255, 0.45);
          font-size: 0.85rem;
        }
      `}
    >
      <div className='queue-header'>
        <div className='queue-title'>Next Round</div>
        <div className='queue-subtitle'>
          {match.phase === 'countdown'
            ? 'Arena opens when the countdown ends.'
            : 'Queue up. A 60s countdown starts when 2 or more players are ready.'}
        </div>
        {canQueue && (
          <button
            type='button'
            className={`queue-toggle${localQueued ? ' queued' : ''}`}
            onClick={toggleQueue}
          >
            {localQueued ? 'Leave Queue' : 'Join Queue'}
          </button>
        )}
      </div>
      <div className='queue-list'>
        {sortedRows.length ? (
          sortedRows.map(row => (
            <div className='queue-row' key={row.id}>
              <span className='queue-check' aria-hidden='true'>
                {row.queued ? <CheckIcon size={16} strokeWidth={3} /> : null}
              </span>
              <span className='queue-name'>{row.name}</span>
            </div>
          ))
        ) : (
          <div className='queue-empty'>No players yet</div>
        )}
      </div>
    </div>
  )
}
