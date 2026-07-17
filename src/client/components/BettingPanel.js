import { useEffect, useMemo, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { LAMPORTS_PER_SOL, MARKET_MIN_LAMPORTS } from '../../core/extras/solanaConfig.js'
import {
  connectWallet,
  getConnectedPubkey,
  getInjectedSolanaWallets,
  getTreasuryPubkey,
  isMobileUserAgent,
  isMwaSupported,
  isUserRejection,
  payEntryFee,
  payEntryFeeMwa,
  prefetchEntryBlockhash,
} from '../extras/solanaWallet.js'

function formatSol(lamportsOrSol, isLamports = true) {
  const sol = isLamports ? lamportsOrSol / LAMPORTS_PER_SOL : lamportsOrSol
  if (typeof sol !== 'number' || !Number.isFinite(sol)) return '—'
  return sol.toFixed(4).replace(/\.?0+$/, '')
}

function parseSolInput(text) {
  const n = Number(String(text).trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n * LAMPORTS_PER_SOL)
}

/**
 * LMSR prediction-market UI during the locked 60s window.
 * Buy any amount on multiple fighters; sell positions before the timer ends.
 */
export function BettingPanel({ world, wallet, setWallet, remaining }) {
  const [market, setMarket] = useState(() => world.network?.marketState)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [walletChoices, setWalletChoices] = useState(null)
  const [selectedPick, setSelectedPick] = useState(null)
  const [buyAmount, setBuyAmount] = useState('0.01') // matches MARKET_MIN_LAMPORTS
  const [busyPick, setBusyPick] = useState(null)

  useEffect(() => {
    const onMarket = data => setMarket(data)
    world.on('marketState', onMarket)
    if (world.network?.marketState) onMarket(world.network.marketState)
    return () => world.off('marketState', onMarket)
  }, [world])

  useEffect(() => {
    const onBuy = data => {
      if (data?.pending) return
      setPending(false)
      setBusyPick(null)
      if (!data?.ok) {
        setError(data?.error || 'Buy failed')
        return
      }
      setError(null)
      setNotice(`Bought ${formatSol(data.costSol, false)} SOL of shares`)
    }
    const onSell = data => {
      if (data?.status === 'pending') {
        setNotice('Sell submitted — waiting for payout…')
        return
      }
      setPending(false)
      setBusyPick(null)
      if (!data?.ok) {
        setError(data?.error || 'Sell failed')
        return
      }
      setError(null)
      if (data.status === 'failed') {
        setError('Sell payout failed — contact support')
        return
      }
      setNotice(`Sold for ${formatSol(data.proceedsSol, false)} SOL`)
    }
    world.on('marketBuyResult', onBuy)
    world.on('marketSellResult', onSell)
    return () => {
      world.off('marketBuyResult', onBuy)
      world.off('marketSellResult', onSell)
    }
  }, [world])

  useEffect(() => {
    if (!pending) return
    const id = setTimeout(() => {
      setPending(false)
      setBusyPick(null)
      setError('Wallet request timed out. Try again.')
    }, 50000)
    return () => clearTimeout(id)
  }, [pending])

  const picks = market?.picks || []
  const betValues = market?.betValues || {}
  const stakeSol = market?.stakeSol || {}
  const collateral = market?.collateralLamports || 0
  const minLamports = market?.minLamports || MARKET_MIN_LAMPORTS
  const open = market?.open !== false
  const positionsByPick = useMemo(() => {
    const map = {}
    for (const p of market?.yourPositions || []) map[p.pickId] = p
    return map
  }, [market?.yourPositions])

  const payAndBuy = async (activeWallet, pickId, lamports) => {
    setPending(true)
    setBusyPick(pickId)
    setError(null)
    try {
      if (!getConnectedPubkey()) throw new Error('Connect your wallet first')
      const signature = await payEntryFee(getTreasuryPubkey(), lamports)
      world.network.send('marketBuy', { signature, wallet: activeWallet, pickId, lamports })
    } catch (err) {
      setPending(false)
      setBusyPick(null)
      if (isUserRejection(err)) {
        setError('Payment cancelled')
        return
      }
      setError(err.message || 'Payment failed')
    }
  }

  const connectAndBuy = async (walletName, pickId, lamports) => {
    setWalletChoices(null)
    setPending(true)
    setBusyPick(pickId)
    try {
      const pubkey = await connectWallet(walletName)
      setWallet(pubkey)
      world.network.send('setSolanaWallet', { wallet: pubkey })
      await payAndBuy(pubkey, pickId, lamports)
    } catch (err) {
      setPending(false)
      setBusyPick(null)
      setError(err.message || 'Wallet connection failed')
    }
  }

  const payBuyWithMwa = async (pickId, lamports) => {
    setPending(true)
    setBusyPick(pickId)
    setError(null)
    try {
      const { signature, walletPubkey } = await payEntryFeeMwa(getTreasuryPubkey(), lamports)
      setWallet(walletPubkey)
      world.network.send('setSolanaWallet', { wallet: walletPubkey })
      world.network.send('marketBuy', { signature, wallet: walletPubkey, pickId, lamports })
    } catch (err) {
      setPending(false)
      setBusyPick(null)
      if (isUserRejection(err)) {
        setError('Payment cancelled')
        return
      }
      setError(err.message || 'Wallet payment failed')
    }
  }

  const startBuy = async pickId => {
    if (!open || pending) return
    setError(null)
    setNotice(null)
    setSelectedPick(pickId)
    const lamports = parseSolInput(buyAmount)
    if (lamports == null || lamports < minLamports) {
      setError(`Min buy is ${formatSol(minLamports)} SOL`)
      return
    }
    if (!getTreasuryPubkey()) {
      setError('Arena payments are not configured')
      return
    }
    prefetchEntryBlockhash().catch(() => {})

    const injected = getInjectedSolanaWallets()
    const activeStandard = getConnectedPubkey()
    if (activeStandard) {
      setWallet(activeStandard)
      await payAndBuy(activeStandard, pickId, lamports)
      return
    }
    if (injected.length === 1) {
      await connectAndBuy(injected[0].name, pickId, lamports)
      return
    }
    if (injected.length > 1) {
      setWalletChoices(injected.map(({ name, icon }) => ({ type: 'wallet', name, icon, lamports })))
      return
    }
    if (isMobileUserAgent() && isMwaSupported()) {
      await payBuyWithMwa(pickId, lamports)
      return
    }
    setError('No Solana wallet found')
  }

  const sellPosition = (pickId, fraction = 1) => {
    if (!open || pending) return
    const pos = positionsByPick[pickId]
    if (!pos?.shares) return
    const shares = pos.shares * fraction
    setPending(true)
    setBusyPick(pickId)
    setError(null)
    setNotice(null)
    world.network.send('marketSell', { pickId, shares })
  }

  return (
    <div
      className='bet-panel'
      css={css`
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        .bet-head {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.1rem;
        }
        .bet-title {
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #7a1515;
        }
        .bet-sub {
          font-size: 0.62rem;
          color: #5c4033;
          text-align: center;
          line-height: 1.25;
        }
        .bet-amount-row {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          justify-content: center;
          margin: 0.15rem 0 0.1rem;
        }
        .bet-amount-row label {
          font-size: 0.6rem;
          color: #5c4033;
          font-weight: 700;
          text-transform: uppercase;
        }
        .bet-amount-row input {
          width: 4.5rem;
          border: 1px solid rgba(61, 40, 23, 0.3);
          border-radius: 0.25rem;
          background: rgba(255, 255, 255, 0.65);
          color: #3d2817;
          font-size: 0.7rem;
          padding: 0.2rem 0.35rem;
          font-variant-numeric: tabular-nums;
        }
        .bet-list {
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          max-height: 11rem;
          overflow-y: auto;
          padding-right: 0.15rem;
        }
        .bet-row {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          padding: 0.32rem 0.35rem;
          border: 1px solid rgba(61, 40, 23, 0.22);
          border-radius: 0.25rem;
          background: rgba(255, 255, 255, 0.35);
        }
        .bet-row.has-pos {
          border-color: rgba(122, 21, 21, 0.45);
          background: rgba(122, 21, 21, 0.06);
        }
        .bet-row-top {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 0.35rem;
          align-items: center;
        }
        .bet-name {
          font-size: 0.68rem;
          font-weight: 700;
          color: #3d2817;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bet-value {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.05rem;
          min-width: 5.5rem;
        }
        .bet-value-label {
          font-size: 0.48rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #5c4033;
          opacity: 0.85;
        }
        .bet-value-row {
          display: flex;
          align-items: baseline;
          gap: 0.35rem;
          white-space: nowrap;
        }
        .bet-value-pct {
          font-size: 0.68rem;
          font-weight: 800;
          color: #7a1515;
          font-variant-numeric: tabular-nums;
        }
        .bet-value-stake {
          font-size: 0.58rem;
          font-weight: 700;
          color: #5c4033;
          font-variant-numeric: tabular-nums;
        }
        .bet-actions {
          display: flex;
          gap: 0.25rem;
          flex-wrap: wrap;
        }
        .bet-btn {
          border: 1px solid rgba(122, 21, 21, 0.45);
          border-radius: 0.25rem;
          background: rgba(122, 21, 21, 0.12);
          color: #7a1515;
          font-size: 0.55rem;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.2rem 0.32rem;
          cursor: pointer;
          white-space: nowrap;
        }
        .bet-btn.sell {
          border-color: rgba(61, 40, 23, 0.35);
          background: rgba(255, 255, 255, 0.45);
          color: #3d2817;
        }
        .bet-btn:disabled {
          opacity: 0.45;
          cursor: default;
        }
        .bet-pos {
          font-size: 0.58rem;
          color: #5c4033;
          line-height: 1.3;
        }
        .bet-error {
          font-size: 0.6rem;
          color: #9b1c1c;
          text-align: center;
        }
        .bet-notice {
          font-size: 0.6rem;
          color: #3d2817;
          text-align: center;
        }
        .bet-wallet-list {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .bet-wallet-option,
        .bet-wallet-cancel {
          font-size: 0.62rem;
          padding: 0.28rem 0.35rem;
          border-radius: 0.25rem;
          border: 1px solid rgba(61, 40, 23, 0.3);
          background: rgba(255, 255, 255, 0.55);
          color: #3d2817;
          cursor: pointer;
        }
      `}
    >
      <div className='bet-head'>
        <div className='bet-title'>Champion market</div>
        <div className='bet-sub'>
          {remaining > 0 ? `${remaining}s left` : 'Closing…'} · pot {formatSol(collateral)} SOL
        </div>
      </div>

      <div className='bet-amount-row'>
        <label htmlFor='mkt-buy-amt'>Buy SOL</label>
        <input
          id='mkt-buy-amt'
          type='number'
          min={formatSol(minLamports)}
          step='0.01'
          value={buyAmount}
          disabled={!open || pending}
          onChange={e => setBuyAmount(e.target.value)}
        />
      </div>

      {walletChoices ? (
        <div className='bet-wallet-list'>
          {walletChoices.map(({ name, icon, lamports }) => (
            <button
              key={name}
              type='button'
              className='bet-wallet-option'
              onClick={() => connectAndBuy(name, selectedPick, lamports)}
            >
              {icon ? <img src={icon} alt='' width={14} height={14} style={{ marginRight: 6 }} /> : null}
              {name}
            </button>
          ))}
          <button type='button' className='bet-wallet-cancel' onClick={() => setWalletChoices(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className='bet-list'>
          {picks.map(pick => {
            const pct = betValues[pick.playerId] ?? 100
            const totalBet = stakeSol[pick.playerId] || 0
            const pos = positionsByPick[pick.playerId]
            const busy = pending && busyPick === pick.playerId
            return (
              <div key={pick.playerId} className={`bet-row${pos ? ' has-pos' : ''}`}>
                <div className='bet-row-top'>
                  <span className='bet-name'>{pick.name}</span>
                  <div className='bet-value'>
                    <span className='bet-value-label'>Bet value</span>
                    <span className='bet-value-row'>
                      <span className='bet-value-pct'>{pct}%</span>
                      <span className='bet-value-stake'>{formatSol(totalBet, false)} SOL</span>
                    </span>
                  </div>
                  <button
                    type='button'
                    className='bet-btn'
                    disabled={!open || pending}
                    onClick={() => startBuy(pick.playerId)}
                  >
                    {busy ? '…' : 'Buy'}
                  </button>
                </div>
                {pos ? (
                  <>
                    <div className='bet-pos'>
                      You: exit ~{formatSol(pos.exitValueSol, false)} SOL
                    </div>
                    <div className='bet-actions'>
                      <button
                        type='button'
                        className='bet-btn sell'
                        disabled={!open || pending}
                        onClick={() => sellPosition(pick.playerId, 0.5)}
                      >
                        Sell ½
                      </button>
                      <button
                        type='button'
                        className='bet-btn sell'
                        disabled={!open || pending}
                        onClick={() => sellPosition(pick.playerId, 1)}
                      >
                        Sell all
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            )
          })}
          {!picks.length && <div className='bet-notice'>Waiting for fighters…</div>}
        </div>
      )}

      {notice ? <div className='bet-notice'>{notice}</div> : null}
      {error ? <div className='bet-error'>{error}</div> : null}
      {wallet ? (
        <div className='bet-sub'>
          Trading as {wallet.slice(0, 4)}…{wallet.slice(-4)}
        </div>
      ) : null}
    </div>
  )
}
