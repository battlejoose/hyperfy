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

function leaderboardUrl(wallet) {
  const base = (typeof env !== 'undefined' && env.PUBLIC_API_URL) || ''
  const root = base.replace(/\/$/, '')
  const params = new URLSearchParams({ limit: '25' })
  if (wallet) params.set('wallet', wallet)
  return `${root}/api/arena/leaderboard?${params}`
}

function syncWallet(setWallet) {
  const connected = getConnectedPubkey()
  if (connected) {
    setWallet(connected)
    return
  }
  connectWalletEager().then(pubkey => setWallet(pubkey || null))
}

export function ArenaRankings() {
  const [open, setOpen] = useState(false)
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
    if (!open) return
    let cancelled = false
    const load = async () => {
      syncWallet(setWallet)
      setLoading(true)
      setError(null)
      try {
        const currentWallet = getConnectedPubkey() || wallet
        const res = await fetch(leaderboardUrl(currentWallet))
        if (!res.ok) throw new Error('Failed to load rankings')
        const data = await res.json()
        if (cancelled) return
        setPlayers(Array.isArray(data.players) ? data.players : [])
        setYou(data.you || null)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load rankings')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 15000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [open, wallet])

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
          {loading && !players.length && <div className='rank-status'>Loading…</div>}
          {error && <div className='rank-status'>{error}</div>}
          {!error && !!players.length && (
            <table className='rank-table'>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th className='rank-rating'>Rating</th>
                </tr>
              </thead>
              <tbody>
                {players.map((row, i) => {
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
          {!error && !loading && !players.length && (
            <div className='rank-status'>No rated fighters yet. Connect a wallet and play a paid battle royale.</div>
          )}
          {you && (
            <div className='rank-you'>
              You: {you.rating} rating · {you.kills}K / {you.deaths}D · {you.wins} wins
            </div>
          )}
        </div>
      )}
    </div>
  )
}
