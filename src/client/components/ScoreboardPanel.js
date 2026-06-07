import { css } from '@firebolt-dev/css'

export const scoreboardPanelStyles = css`
  min-width: 28rem;
  max-width: min(90vw, 36rem);
  background: rgba(15, 16, 24, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
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
`

export function ScoreboardPanel({ rows, title = 'Scoreboard' }) {
  return (
    <div className='scoreboard-panel' css={scoreboardPanelStyles}>
      <div className='scoreboard-title'>{title}</div>
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
  )
}
