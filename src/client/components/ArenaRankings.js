import { useEffect, useMemo, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { ARENA_START_RATING } from '../../core/extras/arenaRating.js'

export function ArenaRankings({ world }) {
  const [rows, setRows] = useState(() => world.network?.arenaLeaderboard?.players ?? [])
  const [selfStats, setSelfStats] = useState(() => world.network?.arenaRating)
  const playerId = world.entities?.player?.data?.id

  useEffect(() => {
    const onLeaderboard = data => setRows(data?.players ?? [])
    world.on('arenaLeaderboard', onLeaderboard)
    if (world.network?.arenaLeaderboard) {
      onLeaderboard(world.network.arenaLeaderboard)
    }
    return () => world.off('arenaLeaderboard', onLeaderboard)
  }, [world])

  useEffect(() => {
    const onRating = data => setSelfStats(data)
    world.on('arenaRating', onRating)
    if (world.network?.arenaRating) {
      onRating(world.network.arenaRating)
    }
    return () => world.off('arenaRating', onRating)
  }, [world])

  const selfRank = useMemo(() => {
    if (!playerId) return null
    const row = rows.find(entry => entry.id === playerId)
    return row?.rank ?? null
  }, [rows, playerId])

  const rating = selfStats?.rating ?? ARENA_START_RATING

  return (
    <div
      css={css`
        position: absolute;
        top: calc(0.75rem + env(safe-area-inset-top));
        left: calc(0.75rem + env(safe-area-inset-left));
        width: min(16rem, calc(100vw - 1.5rem));
        pointer-events: auto;
        z-index: 997;
        background: rgba(15, 16, 24, 0.72);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 12px 48px rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(8px);
        .arena-rankings-title {
          padding: 0.75rem 1rem;
          font-size: 0.95rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.95);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .arena-rankings-self {
          padding: 0.55rem 1rem;
          font-size: 0.78rem;
          color: rgba(255, 255, 255, 0.75);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          strong {
            color: rgba(255, 255, 255, 0.95);
            font-variant-numeric: tabular-nums;
          }
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.82rem;
        }
        th,
        td {
          padding: 0.45rem 0.75rem;
          text-align: left;
        }
        th {
          color: rgba(255, 255, 255, 0.45);
          font-weight: 600;
          font-size: 0.68rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        th:not(:first-child),
        td:not(:first-child) {
          text-align: center;
          width: 3.5rem;
        }
        tbody tr + tr td {
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        td.name {
          color: rgba(255, 255, 255, 0.92);
          max-width: 8rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        td.stat {
          color: rgba(255, 255, 255, 0.85);
          font-variant-numeric: tabular-nums;
        }
        tr.self td {
          background: rgba(255, 215, 120, 0.08);
        }
        .arena-rankings-empty {
          padding: 1rem;
          text-align: center;
          color: rgba(255, 255, 255, 0.45);
          font-size: 0.82rem;
        }
        @media (max-width: 640px) {
          width: min(11rem, calc(50vw - 1rem));
          .arena-rankings-title {
            font-size: 0.72rem;
            padding: 0.55rem 0.65rem;
          }
          .arena-rankings-self {
            font-size: 0.65rem;
            padding: 0.45rem 0.65rem;
          }
          table {
            font-size: 0.68rem;
          }
          th,
          td {
            padding: 0.35rem 0.45rem;
          }
          th:last-child,
          td:last-child {
            display: none;
          }
        }
      `}
    >
      <div className='arena-rankings-title'>Arena Rankings</div>
      <div className='arena-rankings-self'>
        Your rating: <strong>{rating}</strong>
        {selfRank ? ` · Rank #${selfRank}` : ''}
      </div>
      {rows.length ? (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Rating</th>
              <th>W</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className={row.id === playerId ? 'self' : undefined}>
                <td className='stat'>{row.rank}</td>
                <td className='name'>{row.name}</td>
                <td className='stat'>{row.rating}</td>
                <td className='stat'>{row.wins}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className='arena-rankings-empty'>No ranked fighters yet</div>
      )}
    </div>
  )
}
