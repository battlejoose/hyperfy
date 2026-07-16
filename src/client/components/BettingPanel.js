import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { BET_STAKE_LAMPORTS, LAMPORTS_PER_SOL } from '../../core/extras/solanaConfig.js'
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

function formatSol(lamports) {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4).replace(/\.?0+$/, '')
}

function formatFeeLabel(lamports) {
  return (lamports / LAMPORTS_PER_SOL).toFixed(2).replace(/^0/, '')
}

function sharePercent(stakeOnPick, potLamports) {
  if (!potLamports) return 0
  return Math.round((stakeOnPick / potLamports) * 100)
}

/**
 * Pari-mutuel betting UI shown during the locked 60s window before a paid event.
 */
export function BettingPanel({ world, wallet, setWallet, remaining }) {
  const [betting, setBetting] = useState(() => world.network?.bettingState)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [walletChoices, setWalletChoices] = useState(null)
  const [selectedPick, setSelectedPick] = useState(null)

  useEffect(() => {
    const onBetting = data => setBetting(data)
    world.on('bettingState', onBetting)
    if (world.network?.bettingState) onBetting(world.network.bettingState)
    return () => world.off('bettingState', onBetting)
  }, [world])

  useEffect(() => {
    const onResult = data => {
      if (data?.pending) return
      setPending(false)
      if (!data?.ok) {
        setError(data?.error || 'Bet failed')
        return
      }
      setError(null)
      setNotice(data.alreadyBet ? 'You already placed a bet this round.' : 'Bet locked in!')
      setSelectedPick(data.pickId || null)
    }
    world.on('placeBetResult', onResult)
    return () => world.off('placeBetResult', onResult)
  }, [world])

  useEffect(() => {
    if (!pending) return
    const id = setTimeout(() => {
      setPending(false)
      setError('Wallet request timed out. Try again.')
    }, 50000)
    return () => clearTimeout(id)
  }, [pending])

  const picks = betting?.picks || []
  const stakes = betting?.stakes || {}
  const potLamports = betting?.potLamports || 0
  const stakeLamports = betting?.stakeLamports || BET_STAKE_LAMPORTS
  const yourPick = betting?.yourBet?.pickId || selectedPick
  const open = betting?.open !== false

  const payAndBet = async (activeWallet, pickId) => {
    setPending(true)
    setError(null)
    try {
      if (!getConnectedPubkey()) {
        throw new Error('Connect your wallet first')
      }
      let signature = null
      try {
        signature = await payEntryFee(getTreasuryPubkey(), stakeLamports)
      } catch (err) {
        if (isUserRejection(err)) throw err
        if (/connect your wallet/i.test(err.message || '')) throw err
        console.warn('[solana] bet pay failed, attempting recovery:', err)
      }
      world.network.send(
        'placeBet',
        signature
          ? { signature, wallet: activeWallet, pickId }
          : { wallet: activeWallet, pickId, recover: true }
      )
    } catch (err) {
      setPending(false)
      setError(err.message || 'Payment failed')
    }
  }

  const connectAndBet = async (walletName, pickId) => {
    setWalletChoices(null)
    setPending(true)
    try {
      const pubkey = await connectWallet(walletName)
      setWallet(pubkey)
      world.network.send('setSolanaWallet', { wallet: pubkey })
      await payAndBet(pubkey, pickId)
    } catch (err) {
      setPending(false)
      setError(err.message || 'Wallet connection failed')
    }
  }

  const payBetWithMwa = async pickId => {
    setPending(true)
    setError(null)
    try {
      const { signature, walletPubkey } = await payEntryFeeMwa(getTreasuryPubkey(), stakeLamports)
      setWallet(walletPubkey)
      world.network.send('setSolanaWallet', { wallet: walletPubkey })
      world.network.send('placeBet', { signature, wallet: walletPubkey, pickId })
    } catch (err) {
      setPending(false)
      if (isUserRejection(err)) {
        setError('Payment cancelled')
        return
      }
      setError(err.message || 'Wallet payment failed')
    }
  }

  const placeBet = async pickId => {
    if (!open || yourPick || pending) return
    setError(null)
    setNotice(null)
    setSelectedPick(pickId)
    if (!getTreasuryPubkey()) {
      setError('Arena payments are not configured')
      return
    }
    prefetchEntryBlockhash().catch(() => {})

    const injected = getInjectedSolanaWallets()
    const activeStandard = getConnectedPubkey()
    if (activeStandard) {
      setWallet(activeStandard)
      await payAndBet(activeStandard, pickId)
      return
    }
    if (injected.length === 1) {
      await connectAndBet(injected[0].name, pickId)
      return
    }
    if (injected.length > 1) {
      setWalletChoices(injected.map(({ name, icon }) => ({ type: 'wallet', name, icon })))
      return
    }
    if (isMobileUserAgent() && isMwaSupported()) {
      await payBetWithMwa(pickId)
      return
    }
    setError('No Solana wallet found')
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
        .bet-list {
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          max-height: 9.5rem;
          overflow-y: auto;
          padding-right: 0.15rem;
        }
        .bet-row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 0.35rem;
          align-items: center;
          padding: 0.28rem 0.35rem;
          border: 1px solid rgba(61, 40, 23, 0.22);
          border-radius: 0.25rem;
          background: rgba(255, 255, 255, 0.35);
        }
        .bet-row.yours {
          border-color: rgba(122, 21, 21, 0.55);
          background: rgba(122, 21, 21, 0.08);
        }
        .bet-name {
          font-size: 0.68rem;
          font-weight: 700;
          color: #3d2817;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bet-share {
          font-size: 0.6rem;
          color: #5c4033;
          font-variant-numeric: tabular-nums;
        }
        .bet-btn {
          border: 1px solid rgba(122, 21, 21, 0.45);
          border-radius: 0.25rem;
          background: rgba(122, 21, 21, 0.12);
          color: #7a1515;
          font-size: 0.58rem;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.22rem 0.35rem;
          cursor: pointer;
          white-space: nowrap;
        }
        .bet-btn:disabled {
          opacity: 0.45;
          cursor: default;
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
        <div className='bet-title'>Place your bet</div>
        <div className='bet-sub'>
          {remaining > 0 ? `${remaining}s left` : 'Closing…'} · pot {formatSol(potLamports)} SOL ·{' '}
          {formatFeeLabel(stakeLamports)} SOL each
        </div>
      </div>

      {walletChoices ? (
        <div className='bet-wallet-list'>
          {walletChoices.map(({ name, icon }) => (
            <button
              key={name}
              type='button'
              className='bet-wallet-option'
              onClick={() => connectAndBet(name, selectedPick)}
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
            const stakeOnPick = stakes[pick.playerId] || 0
            const isYours = yourPick === pick.playerId
            return (
              <div key={pick.playerId} className={`bet-row${isYours ? ' yours' : ''}`}>
                <span className='bet-name'>{pick.name}</span>
                <span className='bet-share'>{sharePercent(stakeOnPick, potLamports)}%</span>
                <button
                  type='button'
                  className='bet-btn'
                  disabled={!open || !!yourPick || pending}
                  onClick={() => placeBet(pick.playerId)}
                >
                  {isYours ? 'Your pick' : pending && selectedPick === pick.playerId ? '…' : 'Bet'}
                </button>
              </div>
            )
          })}
          {!picks.length && <div className='bet-notice'>Waiting for fighters…</div>}
        </div>
      )}

      {notice ? <div className='bet-notice'>{notice}</div> : null}
      {error ? <div className='bet-error'>{error}</div> : null}
      {wallet ? (
        <div className='bet-sub'>Betting as {wallet.slice(0, 4)}…{wallet.slice(-4)}</div>
      ) : null}
    </div>
  )
}
