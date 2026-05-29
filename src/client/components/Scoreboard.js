import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { ControlPriorities } from '../../core/extras/ControlPriorities'

export function Scoreboard({ world }) {
  const [rows, setRows] = useState([])
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScoreboard = entries => {
      setRows(Array.isArray(entries) ? entries : [])
    }
    world.on('scoreboard', onScoreboard)
    return () => {
      world.off('scoreboard', onScoreboard)
    }
  }, [world])

  useEffect(() => {
    const control = world.controls.bind({ priority: ControlPriorities.CORE_UI })
    control.backquote.onPress = () => setVisible(true)
    control.backquote.onRelease = () => setVisible(false)
    return () => control.release()
  }, [world])

  if (!visible) return null

  return (
    <div
      css={css`
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 1000;
        .scoreboard-panel {
          min-width: 28rem;
          max-width: min(90vw, 36rem);
          background: rgba(15, 16, 24, 0.72);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 12px 48px rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(8px);
        }
        .scoreboard-title {
          padding: 1rem 1.5rem;
          font-size: 1.25rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          text-align: center;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 1.1rem;
        }
        th,
        td {
          padding: 0.75rem 1.5rem;
          text-align: left;
        }
        th {
          color: rgba(255, 255, 255, 0.5);
          font-weight: 500;
          font-size: 0.9rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        th:not(:first-child),
        td:not(:first-child) {
          text-align: center;
          width: 4rem;
        }
        tbody tr + tr td {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        td.name {
          color: white;
          max-width: 16rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        td.stat {
          color: rgba(255, 255, 255, 0.9);
          font-variant-numeric: tabular-nums;
        }
        .scoreboard-empty {
          padding: 1.5rem;
          text-align: center;
          color: rgba(255, 255, 255, 0.45);
          font-size: 1rem;
        }
      `}
    >
      <div className='scoreboard-panel'>
        <div className='scoreboard-title'>Scoreboard</div>
        {rows.length ? (
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>K</th>
                <th>D</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td className='name'>{row.name}</td>
                  <td className='stat'>{row.kills}</td>
                  <td className='stat'>{row.deaths}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className='scoreboard-empty'>No players yet</div>
        )}
      </div>
    </div>
  )
}
