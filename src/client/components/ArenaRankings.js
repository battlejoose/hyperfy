import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'
import {
  connectWalletEager,
  getConnectedPubkey,
  onSolanaWalletsChange,
} from '../extras/solanaWallet.js'

function truncateAddress(address) {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

export function leaderboardUrl(wallet, limit = 25) {
  const base = (typeof env !== 'undefined' && env.PUBLIC_API_URL) || ''
  const root = base.replace(/\/$/, '')
  const params = new URLSearchParams({ limit: String(limit) })
  if (wallet) params.set('wallet', wallet)
  return `${root}/api/arena/leaderboard?${params}`
}

export async function fetchArenaLeaderboard(wallet, limit = 25) {
  const res = await fetch(leaderboardUrl(wallet, limit))
  if (!res.ok) throw new Error('Failed to load rankings')
  const data = await res.json()
  return {
    players: Array.isArray(data.players) ? data.players : [],
    you: data.you || null,
  }
}

function syncWallet(setWallet) {
  const connected = getConnectedPubkey()
  if (connected) {
    setWallet(connected)
    return
  }
  connectWalletEager().then(pubkey => setWallet(pubkey || null))
}

/** Shared rankings table + status used on title screen and in-game HUD. */
export function ArenaRankingsPanel({
  players,
  you,
  wallet,
  loading,
  error,
  limit = 10,
  emptyMessage = 'No rated fighters yet. Enter the arena and play a paid battle royale.',
}) {
  const rows = players.slice(0, limit)
  return (
    <>
      {loading && !rows.length && <div className='rank-status'>Loading…</div>}
      {error && <div className='rank-status'>{error}</div>}
      {!error && !!rows.length && (
        <table className='rank-table'>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th className='rank-rating'>Rating</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isYou = wallet && row.wallet === wallet
              return (
                <tr key={row.wallet} className={isYou ? 'you' : undefined}>
                  <td className='rank-num'>{i + 1}</td>
                  <td title={row.wallet}>
                    {row.username || truncateAddress(row.wallet)}
                    {isYou ? ' (you)' : ''}
                  </td>
                  <td className='rank-rating'>{row.rating}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {!error && !loading && !rows.length && <div className='rank-status'>{emptyMessage}</div>}
      {you && (
        <div className='rank-you'>
          You: {you.rating} rating · {you.kills}K / {you.deaths}D · {you.wins} wins
        </div>
      )}
    </>
  )
}

function useArenaLeaderboard({ enabled = true, limit = 25, pollMs = 15000 } = {}) {
  const [wallet, setWallet] = useState(() => getConnectedPubkey() || null)
  const [players, setPlayers] = useState([])
  const [you, setYou] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    syncWallet(setWallet)
    const off = onSolanaWalletsChange(() => syncWallet(setWallet))
    return () => off?.()
  }, [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = async () => {
      syncWallet(setWallet)
      setLoading(true)
      setError(null)
      try {
        const currentWallet = getConnectedPubkey() || wallet
        const data = await fetchArenaLeaderboard(currentWallet, limit)
        if (cancelled) return
        setPlayers(data.players)
        setYou(data.you)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load rankings')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const id = pollMs > 0 ? setInterval(load, pollMs) : null
    return () => {
      cancelled = true
      if (id) clearInterval(id)
    }
  }, [enabled, wallet, limit, pollMs])

  return { wallet, players, you, error, loading }
}

/** Compact always-visible rankings for the title screen. */
export function TitleArenaRankings() {
  const { wallet, players, you, error, loading } = useArenaLeaderboard({ limit: 100, pollMs: 30000 })

  return (
    <div
      className='title-rankings'
      css={css`
        pointer-events: auto;
        width: min(18rem, calc(100vw - 2rem));
        max-height: min(70vh, 32rem);
        display: flex;
        flex-direction: column;
        background: rgba(0, 0, 0, 0.55);
        border: 1px solid rgba(242, 230, 208, 0.22);
        border-radius: 0.6rem;
        padding: 0.85rem 0.35rem 0.85rem 1rem;
        color: #f2e6d0;
        backdrop-filter: blur(6px);
        .rank-title {
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 0.55rem;
          padding-right: 0.65rem;
          color: #e8dcc8;
          flex-shrink: 0;
        }
        .rank-body {
          overflow-y: auto;
          overscroll-behavior: contain;
          padding-right: 0.65rem;
          flex: 1 1 auto;
          min-height: 0;
          scrollbar-width: thin;
          scrollbar-color: rgba(232, 220, 200, 0.35) transparent;
          &::-webkit-scrollbar {
            width: 6px;
          }
          &::-webkit-scrollbar-thumb {
            background: rgba(232, 220, 200, 0.35);
            border-radius: 3px;
          }
        }
        .rank-status {
          font-size: 0.72rem;
          opacity: 0.75;
          margin-bottom: 0.35rem;
          line-height: 1.35;
        }
        .rank-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.72rem;
        }
        .rank-table th {
          text-align: left;
          font-weight: 600;
          opacity: 0.65;
          padding: 0.15rem 0.2rem 0.35rem;
          position: sticky;
          top: 0;
          background: rgba(0, 0, 0, 0.85);
          z-index: 1;
        }
        .rank-table td {
          padding: 0.2rem 0.2rem;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        .rank-table tr.you td {
          color: #ffe4a3;
          font-weight: 700;
        }
        .rank-you {
          margin-top: 0.5rem;
          padding-top: 0.4rem;
          border-top: 1px solid rgba(255, 255, 255, 0.12);
          font-size: 0.7rem;
          flex-shrink: 0;
          padding-right: 0.65rem;
        }
        .rank-num {
          width: 1.35rem;
          opacity: 0.7;
        }
        .rank-rating {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        @media (max-width: 700px) {
          max-height: min(40vh, 18rem);
          width: 100%;
        }
      `}
    >
      <div className='rank-title'>Arena Rankings</div>
      <div className='rank-body'>
        <ArenaRankingsPanel
          players={players}
          you={null}
          wallet={wallet}
          loading={loading}
          error={error}
          limit={100}
        />
      </div>
      {you && (
        <div className='rank-you'>
          You: {you.rating} rating · {you.kills}K / {you.deaths}D · {you.wins} wins
        </div>
      )}
    </div>
  )
}

/** In-game toggleable rankings HUD. */
export function ArenaRankings() {
  const [open, setOpen] = useState(false)
  const { wallet, players, you, error, loading } = useArenaLeaderboard({
    enabled: open,
    limit: 25,
    pollMs: 15000,
  })

  return (
    <div
      css={css`
        position: absolute;
        bottom: calc(1rem + env(safe-area-inset-bottom));
        left: calc(1rem + env(safe-area-inset-left));
        z-index: 996;
        pointer-events: auto;
        font-family: system-ui, sans-serif;
        .rank-toggle {
          border: none;
          border-radius: 0.5rem;
          background: rgba(0, 0, 0, 0.55);
          color: #f2e6d0;
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 0.55rem 0.85rem;
          cursor: pointer;
        }
        .rank-panel {
          margin-top: 0.4rem;
          width: min(20rem, calc(100vw - 2rem));
          background: rgba(0, 0, 0, 0.72);
          border: 1px solid rgba(242, 230, 208, 0.18);
          border-radius: 0.6rem;
          padding: 0.75rem 0.85rem;
          color: #f2e6d0;
        }
        .rank-title {
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 0.55rem;
        }
        .rank-status {
          font-size: 0.72rem;
          opacity: 0.75;
          margin-bottom: 0.4rem;
        }
        .rank-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.72rem;
        }
        .rank-table th {
          text-align: left;
          font-weight: 600;
          opacity: 0.65;
          padding: 0.2rem 0.25rem 0.35rem;
        }
        .rank-table td {
          padding: 0.22rem 0.25rem;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .rank-table tr.you td {
          color: #ffe4a3;
          font-weight: 700;
        }
        .rank-you {
          margin-top: 0.55rem;
          padding-top: 0.45rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          font-size: 0.72rem;
        }
        .rank-num {
          width: 1.4rem;
          opacity: 0.7;
        }
        .rank-rating {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
      `}
    >
      <button type='button' className='rank-toggle' onClick={() => setOpen(v => !v)}>
        {open ? 'Hide Rankings' : 'Arena Rankings'}
      </button>
      {open && (
        <div className='rank-panel'>
          <div className='rank-title'>Arena Rankings</div>
          <ArenaRankingsPanel
            players={players}
            you={you}
            wallet={wallet}
            loading={loading}
            error={error}
            limit={25}
          />
        </div>
      )}
    </div>
  )
}
