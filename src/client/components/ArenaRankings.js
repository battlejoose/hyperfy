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

/** PUBLIC_API_URL is typically `https://host/api` — don't double the `/api` segment. */
export function arenaApiRoot() {
  const base = (typeof env !== 'undefined' && env.PUBLIC_API_URL) || ''
  if (!base) return '/api'
  const root = String(base).replace(/\/$/, '')
  return root.endsWith('/api') ? root : `${root}/api`
}

export function leaderboardUrl(wallet, limit = 25) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (wallet) params.set('wallet', wallet)
  return `${arenaApiRoot()}/arena/leaderboard?${params}`
}

export async function fetchArenaLeaderboard(wallet, limit = 25) {
  const res = await fetch(leaderboardUrl(wallet, limit), { credentials: 'same-origin' })
  if (!res.ok) throw new Error('Failed to load rankings')
  const data = await res.json()
  const players = Array.isArray(data.players) ? data.players : []
  const you = data.you || null
  // Ensure the connected wallet row is visible even if ranking list was capped/missed
  if (you && !players.some(p => p.wallet === you.wallet)) {
    players.push(you)
    players.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
  }
  return { players, you }
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
    try {
      syncWallet(setWallet)
      const off = onSolanaWalletsChange(() => syncWallet(setWallet))
      return () => off?.()
    } catch (err) {
      console.warn('[arena-rating] wallet sync unavailable:', err)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        // Prefer live connected pubkey, but never block the public leaderboard on wallet
        let currentWallet = null
        try {
          currentWallet = getConnectedPubkey() || wallet
        } catch {
          currentWallet = wallet
        }
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

/** In-game rankings: button in the queue UI that opens a closable popup. */
export function QueueArenaRankings() {
  const [open, setOpen] = useState(false)
  const { wallet, players, you, error, loading } = useArenaLeaderboard({
    enabled: open,
    limit: 25,
    pollMs: 15000,
  })

  return (
    <div
      className='queue-rankings'
      css={css`
        width: 100%;
        max-width: 11rem;
        margin-top: 0.35rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        position: relative;
        z-index: 2;
        .rank-open-btn {
          width: fit-content;
          max-width: 100%;
          padding: 0.35rem 0.8rem;
          border: 1px solid rgba(61, 40, 23, 0.45);
          border-radius: 6px;
          background: rgba(255, 248, 240, 0.6);
          color: #3d2817;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s;
          &:hover {
            background: rgba(255, 248, 240, 0.95);
          }
        }
        .rank-popup {
          position: absolute;
          top: calc(100% + 0.4rem);
          left: 50%;
          transform: translateX(-50%);
          width: min(18rem, 70vw);
          max-height: min(50vh, 22rem);
          display: flex;
          flex-direction: column;
          background: rgba(255, 248, 235, 0.97);
          border: 1px solid rgba(61, 40, 23, 0.35);
          border-radius: 0.55rem;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
          padding: 0.7rem 0.35rem 0.7rem 0.75rem;
          color: #3d2817;
        }
        .rank-popup-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          padding-right: 0.4rem;
          margin-bottom: 0.4rem;
          flex-shrink: 0;
        }
        .rank-title {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #5c4033;
        }
        .rank-close-btn {
          border: none;
          background: transparent;
          color: #5c4033;
          font-size: 0.72rem;
          font-weight: 700;
          cursor: pointer;
          padding: 0.15rem 0.35rem;
          border-radius: 4px;
          &:hover {
            background: rgba(61, 40, 23, 0.1);
          }
        }
        .rank-body {
          overflow-y: auto;
          overscroll-behavior: contain;
          min-height: 0;
          flex: 1 1 auto;
          padding-right: 0.4rem;
          scrollbar-width: thin;
          scrollbar-color: rgba(92, 64, 51, 0.35) transparent;
          &::-webkit-scrollbar {
            width: 5px;
          }
          &::-webkit-scrollbar-thumb {
            background: rgba(92, 64, 51, 0.35);
            border-radius: 3px;
          }
        }
        .rank-status {
          font-size: 0.68rem;
          color: #5c4033;
          opacity: 0.85;
          line-height: 1.3;
          text-align: center;
        }
        .rank-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.7rem;
          color: #3d2817;
        }
        .rank-table th {
          text-align: left;
          font-weight: 700;
          color: #5c4033;
          opacity: 0.8;
          padding: 0.15rem 0.2rem 0.3rem;
          position: sticky;
          top: 0;
          background: rgba(255, 248, 235, 0.98);
          z-index: 1;
        }
        .rank-table td {
          padding: 0.18rem 0.2rem;
          border-top: 1px solid rgba(61, 40, 23, 0.12);
        }
        .rank-table tr.you td {
          color: #7a1515;
          font-weight: 700;
        }
        .rank-you {
          margin-top: 0.4rem;
          padding-top: 0.35rem;
          padding-right: 0.4rem;
          border-top: 1px solid rgba(61, 40, 23, 0.18);
          font-size: 0.65rem;
          color: #5c4033;
          text-align: center;
          flex-shrink: 0;
        }
        .rank-num {
          width: 1.2rem;
          opacity: 0.7;
        }
        .rank-rating {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
      `}
    >
      <button type='button' className='rank-open-btn' onClick={() => setOpen(true)}>
        Rankings
      </button>
      {open && (
        <div className='rank-popup'>
          <div className='rank-popup-header'>
            <div className='rank-title'>Arena Rankings</div>
            <button type='button' className='rank-close-btn' onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <div className='rank-body'>
            <ArenaRankingsPanel
              players={players}
              you={null}
              wallet={wallet}
              loading={loading}
              error={error}
              limit={25}
              emptyMessage='No rated fighters yet.'
            />
          </div>
          {you && (
            <div className='rank-you'>
              You: {you.rating} · {you.kills}K/{you.deaths}D · {you.wins}W
            </div>
          )}
        </div>
      )}
    </div>
  )
}
