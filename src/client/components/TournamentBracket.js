import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'

function slotName(slot) {
  return slot?.name || '—'
}

function MatchCard({ match, highlight }) {
  const aLost = match.status === 'done' && match.loserId && match.loserId === match.a?.playerId
  const bLost = match.status === 'done' && match.loserId && match.loserId === match.b?.playerId
  const aWon = match.status === 'done' && match.winnerId && match.winnerId === match.a?.playerId
  const bWon = match.status === 'done' && match.winnerId && match.winnerId === match.b?.playerId

  return (
    <div className={`tb-match${highlight ? ' tb-match-live' : ''}${match.status === 'done' ? ' tb-match-done' : ''}`}>
      <div className={`tb-slot${aLost ? ' tb-slot-lost' : ''}${aWon ? ' tb-slot-won' : ''}`}>
        <span className='tb-slot-name'>{slotName(match.a)}</span>
        {aLost ? <span className='tb-slot-x'>✕</span> : null}
      </div>
      <div className={`tb-slot${bLost ? ' tb-slot-lost' : ''}${bWon ? ' tb-slot-won' : ''}`}>
        <span className='tb-slot-name'>{slotName(match.b)}</span>
        {bLost ? <span className='tb-slot-x'>✕</span> : null}
      </div>
    </div>
  )
}

export function TournamentBracket({ world }) {
  const [bracket, setBracket] = useState(() => world.network?.tournamentBracket)
  const [phase, setPhase] = useState(() => world.network?.matchState?.phase)

  useEffect(() => {
    const onBracket = data => setBracket(data)
    const onMatch = data => {
      setPhase(data?.phase)
      if (data?.phase !== 'tournament') setBracket(null)
    }
    world.on('tournamentBracket', onBracket)
    world.on('matchState', onMatch)
    if (world.network?.tournamentBracket) onBracket(world.network.tournamentBracket)
    if (world.network?.matchState) onMatch(world.network.matchState)
    return () => {
      world.off('tournamentBracket', onBracket)
      world.off('matchState', onMatch)
    }
  }, [world])

  if (phase !== 'tournament' || !bracket?.rounds?.length) return null

  // Hide during the live duel so the arena stays visible; show for prep / result / final
  const highlight = bracket.rounds
    .flatMap(r => r.matches)
    .find(m => m.id === bracket.highlightMatchId)
  if (highlight?.status === 'live' && bracket.status !== 'final') return null

  const statusLabel =
    bracket.status === 'final' ? 'Champion' : bracket.status === 'result' ? 'Match result' : 'Up next'

  return (
    <div
      className='tb-overlay'
      css={css`
        position: absolute;
        inset: 0;
        z-index: 1100;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        background: rgba(4, 6, 10, 0.52);
        backdrop-filter: blur(2px);

        .tb-sheet {
          width: min(56rem, calc(100vw - 1.5rem));
          max-height: calc(100vh - 2rem);
          overflow: auto;
          padding: 1.1rem 1.25rem 1.25rem;
          border-radius: 0.35rem;
          border: 1px solid rgba(212, 175, 95, 0.35);
          background: linear-gradient(180deg, rgba(18, 20, 26, 0.97) 0%, rgba(10, 12, 16, 0.98) 100%);
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
          color: rgba(240, 240, 240, 0.95);
          font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        }

        .tb-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .tb-kicker {
          font-size: 0.68rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: rgba(212, 175, 95, 0.9);
          margin-bottom: 0.25rem;
        }

        .tb-title {
          font-size: 1.25rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: #f5e6c8;
        }

        .tb-status {
          font-size: 0.75rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #fbbf24;
        }

        .tb-rounds {
          display: flex;
          gap: 1.25rem;
          align-items: stretch;
          overflow-x: auto;
          padding-bottom: 0.25rem;
        }

        .tb-round {
          flex: 0 0 auto;
          min-width: 10.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .tb-round-label {
          font-size: 0.62rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.45);
          margin-bottom: 0.15rem;
        }

        .tb-matches {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: space-around;
          gap: 0.85rem;
        }

        .tb-match {
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 0.25rem;
          background: rgba(255, 255, 255, 0.03);
          overflow: hidden;
        }

        .tb-match-live {
          border-color: rgba(251, 191, 36, 0.75);
          box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.25), 0 0 22px rgba(251, 191, 36, 0.18);
          animation: tb-pulse 1.4s ease-in-out infinite;
        }

        .tb-match-done {
          opacity: 0.92;
        }

        .tb-slot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          padding: 0.45rem 0.55rem;
          font-size: 0.78rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .tb-slot:last-child {
          border-bottom: none;
        }

        .tb-slot-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tb-slot-won .tb-slot-name {
          color: #fbbf24;
          font-weight: 700;
        }

        .tb-slot-lost .tb-slot-name {
          text-decoration: line-through;
          color: rgba(255, 255, 255, 0.4);
        }

        .tb-slot-x {
          color: #f87171;
          font-weight: 800;
          flex-shrink: 0;
        }

        .tb-bye {
          margin-top: 0.35rem;
          font-size: 0.68rem;
          color: rgba(255, 255, 255, 0.55);
        }
        .tb-bye strong {
          color: rgba(245, 230, 200, 0.9);
          font-weight: 600;
        }

        @keyframes tb-pulse {
          0%,
          100% {
            box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.25), 0 0 16px rgba(251, 191, 36, 0.12);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.55), 0 0 28px rgba(251, 191, 36, 0.28);
          }
        }

        @media (max-width: 640px) {
          .tb-sheet {
            padding: 0.85rem 0.75rem 1rem;
          }
          .tb-round {
            min-width: 8.5rem;
          }
          .tb-slot {
            font-size: 0.7rem;
            padding: 0.38rem 0.45rem;
          }
        }
      `}
    >
      <div className='tb-sheet'>
        <div className='tb-head'>
          <div>
            <div className='tb-kicker'>Arena</div>
            <div className='tb-title'>Tournament Bracket</div>
          </div>
          <div className='tb-status'>{statusLabel}</div>
        </div>
        <div className='tb-rounds'>
          {bracket.rounds.map((round, idx) => (
            <div className='tb-round' key={round.index ?? idx}>
              <div className='tb-round-label'>
                {idx === bracket.rounds.length - 1 && round.matches.length === 1 ? 'Final' : `Round ${idx + 1}`}
              </div>
              <div className='tb-matches'>
                {round.matches.map(match => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    highlight={match.id === bracket.highlightMatchId}
                  />
                ))}
              </div>
              {round.bye ? (
                <div className='tb-bye'>
                  Bye: <strong>{slotName(round.bye)}</strong>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
