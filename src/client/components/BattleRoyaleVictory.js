import { useEffect, useMemo, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { CheckIcon, LoaderIcon, XIcon } from 'lucide-react'

const PENDING_STEPS = [
  'Preparing treasury transfer…',
  'Submitting payout transaction…',
  'Confirming on Solana…',
  'Awaiting finality…',
]

const AUTO_DISMISS_MS = 45000

function abbreviateAddress(addr) {
  if (!addr || typeof addr !== 'string') return '—'
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

function abbreviateSignature(sig) {
  if (!sig || typeof sig !== 'string') return '—'
  if (sig.length <= 20) return sig
  return `${sig.slice(0, 8)}…${sig.slice(-8)}`
}

function solscanTxUrl(signature) {
  return `https://solscan.io/tx/${signature}`
}

function formatSol(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—'
  // 4 decimals matches the queue pot label; toFixed(3) wrongly rounds 0.0285 → 0.029
  return amount.toFixed(4).replace(/\.?0+$/, '')
}

function mergeBetting(prevBetting, nextBetting) {
  if (!nextBetting) return prevBetting || null
  if (!prevBetting) return nextBetting
  const prevById = new Map((prevBetting.winners || []).map(w => [w.playerId, w]))
  const winners = (nextBetting.winners || []).map(w => ({
    ...prevById.get(w.playerId),
    ...w,
  }))
  return { ...prevBetting, ...nextBetting, winners }
}

function StatusBadge({ status }) {
  const pending = status === 'pending'
  const complete = status === 'complete'
  return (
    <div className={`br-victory-badge ${pending ? 'pending' : complete ? 'complete' : 'failed'}`}>
      {pending && <LoaderIcon size='0.75rem' className='br-victory-spin' />}
      {complete && <CheckIcon size='0.75rem' />}
      {!pending && !complete && <XIcon size='0.75rem' />}
      {pending ? 'Pending' : complete ? 'Complete' : 'Failed'}
    </div>
  )
}

function PayoutProgress({ status, progress, statusText, signature }) {
  const pending = status === 'pending'
  const complete = status === 'complete'
  return (
    <>
      <div className='br-victory-bar'>
        <div
          className={`br-victory-bar-fill ${pending ? 'pending' : complete ? 'complete' : 'failed'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      {statusText ? <div className='br-victory-status'>{statusText}</div> : null}
      {complete && signature && (
        <div className='br-victory-hash-row'>
          <div className='br-victory-hash'>tx {abbreviateSignature(signature)}</div>
          <a
            className='br-victory-link'
            href={solscanTxUrl(signature)}
            target='_blank'
            rel='noopener noreferrer'
          >
            View on Solscan →
          </a>
        </div>
      )}
    </>
  )
}

export function BattleRoyaleVictory({ world }) {
  const [victory, setVictory] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [betStepIndex, setBetStepIndex] = useState(0)

  useEffect(() => {
    const onVictory = data => {
      if (!data) return
      setVictory(prev => {
        if (prev && prev.winnerId === data.winnerId) {
          return {
            ...prev,
            ...data,
            betting: mergeBetting(prev.betting, data.betting),
          }
        }
        return { ...data }
      })
      if (data.status === 'pending') setStepIndex(0)
      if (data.betting?.status === 'pending') setBetStepIndex(0)
    }
    world.on('brVictory', onVictory)
    return () => world.off('brVictory', onVictory)
  }, [world])

  useEffect(() => {
    if (!victory || victory.status !== 'pending') return
    const id = setInterval(() => {
      setStepIndex(i => (i + 1) % PENDING_STEPS.length)
    }, 2200)
    return () => clearInterval(id)
  }, [victory?.status, victory?.winnerId])

  useEffect(() => {
    if (!victory?.betting || victory.betting.status !== 'pending') return
    const id = setInterval(() => {
      setBetStepIndex(i => (i + 1) % PENDING_STEPS.length)
    }, 2200)
    return () => clearInterval(id)
  }, [victory?.betting?.status, victory?.winnerId])

  const championSettled = victory && victory.status !== 'pending'
  const bettingSettled = !victory?.betting || victory.betting.status !== 'pending'

  useEffect(() => {
    if (!victory || !championSettled || !bettingSettled) return
    const id = setTimeout(() => setVictory(null), AUTO_DISMISS_MS)
    return () => clearTimeout(id)
  }, [
    victory?.status,
    victory?.signature,
    victory?.betting?.status,
    victory?.winnerId,
    championSettled,
    bettingSettled,
  ])

  const statusText = useMemo(() => {
    if (!victory) return ''
    if (victory.status === 'pending') return PENDING_STEPS[stepIndex]
    if (victory.status === 'complete') return 'Payout confirmed on-chain'
    return 'Payout failed — contact support with the match time'
  }, [victory, stepIndex])

  const bettingStatusText = useMemo(() => {
    if (!victory?.betting || victory.betting.outcome !== 'paid') return ''
    if (victory.betting.status === 'pending') return PENDING_STEPS[betStepIndex]
    if (victory.betting.status === 'complete') return 'All betting payouts confirmed on-chain'
    return 'One or more betting payouts failed'
  }, [victory?.betting, betStepIndex])

  if (!victory) return null

  const pending = victory.status === 'pending'
  const complete = victory.status === 'complete'
  const failed = victory.status === 'failed'
  const progress = complete ? 100 : failed ? 100 : Math.min(92, 18 + stepIndex * 22)

  const betting = victory.betting
  const bettingPending = betting?.status === 'pending'
  const bettingComplete = betting?.status === 'complete'
  const bettingFailed = betting?.status === 'failed'
  const bettingProgress = bettingComplete || bettingFailed ? 100 : Math.min(92, 18 + betStepIndex * 22)

  return (
    <div
      className='br-victory'
      css={css`
        position: absolute;
        inset: 0;
        z-index: 1200;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        background: rgba(4, 6, 10, 0.55);
        backdrop-filter: blur(2px);

        .br-victory-card {
          width: min(28rem, calc(100vw - 2rem));
          max-height: calc(100vh - 2rem);
          overflow-y: auto;
          padding: 1.35rem 1.4rem 1.25rem;
          border-radius: 0.35rem;
          border: 1px solid rgba(212, 175, 95, 0.35);
          background: linear-gradient(180deg, rgba(18, 20, 26, 0.97) 0%, rgba(10, 12, 16, 0.98) 100%);
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
          color: rgba(240, 240, 240, 0.95);
          font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        }

        .br-victory-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }

        .br-victory-kicker {
          font-size: 0.68rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: rgba(212, 175, 95, 0.9);
          margin-bottom: 0.35rem;
        }

        .br-victory-title {
          font-size: 1.35rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          line-height: 1.15;
          color: #f5e6c8;
        }

        .br-victory-close {
          flex-shrink: 0;
          width: 1.75rem;
          height: 1.75rem;
          border-radius: 0.25rem;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .br-victory-close:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .br-victory-grid {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.35rem 0.85rem;
          font-size: 0.78rem;
          margin-bottom: 1.15rem;
        }
        .br-victory-label {
          color: rgba(255, 255, 255, 0.45);
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-size: 0.65rem;
          padding-top: 0.15rem;
        }
        .br-victory-value {
          color: rgba(255, 255, 255, 0.92);
          word-break: break-all;
        }
        .br-victory-value.accent {
          color: #fbbf24;
          font-weight: 600;
        }

        .br-victory-section {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          padding-top: 0.95rem;
          margin-top: 0.15rem;
        }
        .br-victory-section + .br-victory-section {
          margin-top: 1.05rem;
        }

        .br-victory-tx-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          margin-bottom: 0.55rem;
        }

        .br-victory-tx-label {
          font-size: 0.65rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(212, 175, 95, 0.9);
        }

        .br-victory-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.68rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 0.15rem 0.45rem;
          border-radius: 0.2rem;
          border: 1px solid transparent;
        }
        .br-victory-badge.pending {
          color: #fbbf24;
          border-color: rgba(251, 191, 36, 0.35);
          background: rgba(251, 191, 36, 0.08);
        }
        .br-victory-badge.complete {
          color: #4ade80;
          border-color: rgba(74, 222, 128, 0.35);
          background: rgba(74, 222, 128, 0.08);
        }
        .br-victory-badge.failed {
          color: #f87171;
          border-color: rgba(248, 113, 113, 0.35);
          background: rgba(248, 113, 113, 0.08);
        }

        .br-victory-spin {
          animation: br-victory-spin 0.85s linear infinite;
        }
        @keyframes br-victory-spin {
          to {
            transform: rotate(360deg);
          }
        }

        .br-victory-bar {
          height: 0.28rem;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          overflow: hidden;
          margin-bottom: 0.55rem;
        }
        .br-victory-bar-fill {
          height: 100%;
          border-radius: 999px;
          transition: width 0.45s ease;
          background: linear-gradient(90deg, #b45309, #fbbf24);
        }
        .br-victory-bar-fill.complete {
          background: linear-gradient(90deg, #15803d, #4ade80);
        }
        .br-victory-bar-fill.failed {
          background: linear-gradient(90deg, #991b1b, #f87171);
        }
        .br-victory-bar-fill.pending {
          background: linear-gradient(90deg, #b45309, #fbbf24, #fde68a, #b45309);
          background-size: 200% 100%;
          animation: br-victory-shimmer 1.4s linear infinite;
        }
        @keyframes br-victory-shimmer {
          0% {
            background-position: 100% 0;
          }
          100% {
            background-position: -100% 0;
          }
        }

        .br-victory-status {
          font-size: 0.72rem;
          color: rgba(255, 255, 255, 0.65);
          min-height: 1.1rem;
          margin-bottom: 0.55rem;
        }

        .br-victory-hash-row {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.72rem;
        }
        .br-victory-hash {
          color: rgba(255, 255, 255, 0.85);
          word-break: break-all;
        }
        .br-victory-link {
          color: #93c5fd;
          text-decoration: none;
          font-size: 0.72rem;
        }
        .br-victory-link:hover {
          text-decoration: underline;
        }

        .br-victory-betting-note {
          font-size: 0.72rem;
          color: rgba(255, 255, 255, 0.65);
          line-height: 1.35;
        }

        .br-victory-bet-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-top: 0.75rem;
        }
        .br-victory-bet-card {
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.3rem;
          padding: 0.65rem 0.7rem 0.55rem;
          background: rgba(255, 255, 255, 0.03);
        }
        .br-victory-bet-card-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.5rem;
          margin-bottom: 0.45rem;
        }
        .br-victory-bet-name {
          font-size: 0.78rem;
          color: rgba(255, 255, 255, 0.92);
          font-weight: 600;
        }
        .br-victory-bet-meta {
          font-size: 0.65rem;
          color: rgba(255, 255, 255, 0.45);
          margin-top: 0.15rem;
        }
        .br-victory-bet-amount {
          color: #fbbf24;
          font-size: 0.72rem;
          font-weight: 600;
          flex-shrink: 0;
        }
      `}
    >
      <div className='br-victory-card'>
        <div className='br-victory-top'>
          <div>
            <div className='br-victory-kicker'>
              {victory.eventLabel === 'tournament' ? 'Tournament' : 'Battle Royale'}
            </div>
            <div className='br-victory-title'>Victory</div>
          </div>
          <button type='button' className='br-victory-close' onClick={() => setVictory(null)} aria-label='Close'>
            <XIcon size='0.95rem' />
          </button>
        </div>

        <div className='br-victory-grid'>
          <div className='br-victory-label'>Winner</div>
          <div className='br-victory-value accent'>{victory.winnerName || 'Unknown'}</div>
          <div className='br-victory-label'>Wallet</div>
          <div className='br-victory-value'>{abbreviateAddress(victory.wallet)}</div>
          <div className='br-victory-label'>Champion pot</div>
          <div className='br-victory-value accent'>{formatSol(victory.payoutSol)} SOL</div>
        </div>

        <div className='br-victory-section'>
          <div className='br-victory-tx-head'>
            <div className='br-victory-tx-label'>Champion payout</div>
            <StatusBadge status={pending ? 'pending' : complete ? 'complete' : 'failed'} />
          </div>
          <PayoutProgress
            status={pending ? 'pending' : complete ? 'complete' : 'failed'}
            progress={progress}
            statusText={statusText}
            signature={victory.signature}
          />
        </div>

        {betting && (
          <div className='br-victory-section'>
            <div className='br-victory-tx-head'>
              <div className='br-victory-tx-label'>Betting</div>
              {betting.outcome === 'paid' ? (
                <StatusBadge
                  status={bettingPending ? 'pending' : bettingComplete ? 'complete' : 'failed'}
                />
              ) : null}
            </div>

            <div className='br-victory-grid' style={{ marginBottom: betting.outcome === 'paid' ? '0.75rem' : 0 }}>
              <div className='br-victory-label'>Bet pot</div>
              <div className='br-victory-value accent'>{formatSol(betting.potSol)} SOL</div>
              <div className='br-victory-label'>Positions</div>
              <div className='br-victory-value'>{betting.totalBets}</div>
              {betting.outcome === 'paid' && (
                <>
                  <div className='br-victory-label'>Pool paid</div>
                  <div className='br-victory-value accent'>{formatSol(betting.payoutPoolSol)} SOL</div>
                  <div className='br-victory-label'>Winners</div>
                  <div className='br-victory-value'>{betting.winningBets}</div>
                </>
              )}
            </div>

            {betting.outcome === 'paid' && (
              <>
                <PayoutProgress
                  status={bettingPending ? 'pending' : bettingComplete ? 'complete' : 'failed'}
                  progress={bettingProgress}
                  statusText={bettingStatusText}
                  signature={null}
                />
                <div className='br-victory-bet-list'>
                  {(betting.winners || []).map(w => {
                    const wPending = w.status === 'pending'
                    const wComplete = w.status === 'complete'
                    const wFailed = w.status === 'failed'
                    const wProgress = wComplete || wFailed ? 100 : Math.min(88, 20 + betStepIndex * 18)
                    return (
                      <div className='br-victory-bet-card' key={w.playerId || w.wallet}>
                        <div className='br-victory-bet-card-head'>
                          <div>
                            <div className='br-victory-bet-name'>{w.name}</div>
                            <div className='br-victory-bet-meta'>{abbreviateAddress(w.wallet)}</div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
                            <div className='br-victory-bet-amount'>{formatSol(w.shareSol)} SOL</div>
                            <StatusBadge status={wPending ? 'pending' : wComplete ? 'complete' : 'failed'} />
                          </div>
                        </div>
                        <PayoutProgress
                          status={wPending ? 'pending' : wComplete ? 'complete' : 'failed'}
                          progress={wProgress}
                          statusText={
                            wPending
                              ? PENDING_STEPS[betStepIndex]
                              : wComplete
                                ? 'Payout confirmed on-chain'
                                : null
                          }
                          signature={w.signature}
                        />
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {betting.outcome === 'no_winners' && (
              <div className='br-victory-betting-note'>
                No shares on {betting.pickName || 'the champion'} — market pot goes to the arena.
              </div>
            )}
            {betting.outcome === 'refunded' && (
              <div className='br-victory-betting-note'>Market positions refunded via exit sales.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
