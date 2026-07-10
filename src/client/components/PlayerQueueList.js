import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { isSpectatorSessionAvatar } from '../../core/extras/playerAvatars'
import { BR_ENTRY_FEE_LAMPORTS, BR_HOUSE_FEE_PERCENT, LAMPORTS_PER_SOL } from '../../core/extras/solanaConfig.js'
import {
  connectWallet,
  connectWalletEager,
  getInjectedSolanaWallets,
  getTreasuryPubkey,
  getWalletBrowserLinks,
  isMobileUserAgent,
  isMwaSupported,
  isUserRejection,
  onSolanaWalletsChange,
  payEntryFee,
  payEntryFeeMwa,
} from '../extras/solanaWallet.js'

const SCROLL_SRC = '/assets/scroll.png'
const BR_ENTRY_FEE_SOL = BR_ENTRY_FEE_LAMPORTS / LAMPORTS_PER_SOL

function truncateAddress(address) {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

function formatSol(lamports) {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4).replace(/\.?0+$/, '')
}

export function PlayerQueueList({ world }) {
  const [isSpectator, setIsSpectator] = useState(() => {
    const p = world.entities?.player
    return !!(p && isSpectatorSessionAvatar(p.data.sessionAvatar))
  })
  const [wallet, setWallet] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const [match, setMatch] = useState(() => world.network?.matchState)
  const [pointerLocked, setPointerLocked] = useState(() => !!world.controls?.pointer?.locked)
  const [walletChoices, setWalletChoices] = useState(null) // wallet picker open when non-null
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    const syncRole = () => {
      const p = world.entities?.player
      setIsSpectator(!!(p && isSpectatorSessionAvatar(p.data.sessionAvatar)))
    }
    world.on('player', syncRole)
    return () => world.off('player', syncRole)
  }, [world])

  useEffect(() => {
    const onMatchState = data => setMatch(data)
    world.on('matchState', onMatchState)
    if (world.network?.matchState) {
      onMatchState(world.network.matchState)
    }
    return () => world.off('matchState', onMatchState)
  }, [world])

  useEffect(() => {
    const onPointerLock = locked => setPointerLocked(!!locked)
    world.on('pointer-lock', onPointerLock)
    return () => world.off('pointer-lock', onPointerLock)
  }, [world])

  // silently reconnect the wallet the user picked last time so the server can
  // auto-restore any unclaimed entry payment after a crash or rejoin
  useEffect(() => {
    let cancelled = false
    connectWalletEager().then(pubkey => {
      if (cancelled || !pubkey) return
      setWallet(pubkey)
      world.network.send('setSolanaWallet', { wallet: pubkey })
    })
    return () => {
      cancelled = true
    }
  }, [world])

  // while the picker is open, upgrade to direct wallet options as wallets
  // register (e.g. delayed provider injection inside a wallet's in-app browser)
  useEffect(() => {
    if (!walletChoices) return
    return onSolanaWalletsChange(() => {
      const injected = getInjectedSolanaWallets()
      if (injected.length) {
        setWalletChoices(injected.map(({ name, icon }) => ({ type: 'wallet', name, icon })))
      }
    })
  }, [!!walletChoices])

  useEffect(() => {
    const onResult = data => {
      // the server is still verifying an earlier request — stay in pending
      if (data?.pending) return
      setPending(false)
      if (!data?.ok) {
        setError(data?.error || 'Something went wrong')
        return
      }
      setError(null)
    }
    world.on('enterArenaResult', onResult)
    world.on('joinBattleRoyaleResult', onResult)
    return () => {
      world.off('enterArenaResult', onResult)
      world.off('joinBattleRoyaleResult', onResult)
    }
  }, [world])

  const phase = match?.phase ?? 'queue'
  const isBattle = phase === 'battle'

  // during a battle royale the panel is not accessible at all
  if (isBattle) return null
  // free-play fighters only see the panel after pressing escape (pointer unlocked)
  if (!isSpectator && pointerLocked) return null

  const queuedIds = match?.queuedIds ?? []
  const isQueued = queuedIds.includes(world.network?.id)
  const potLamports = match?.potLamports ?? 0
  const winnerLamports = Math.floor((potLamports * (100 - BR_HOUSE_FEE_PERCENT)) / 100)

  const enterArena = () => {
    setError(null)
    setPending(true)
    world.network.send('enterArena', {})
  }

  const becomeSpectator = () => {
    setError(null)
    setPending(true)
    world.network.send('leaveArena', {})
  }

  // pay the entry fee with an already-connected wallet and join the queue
  const payAndJoin = async activeWallet => {
    setPending(true)
    try {
      let signature = null
      try {
        signature = await payEntryFee(getTreasuryPubkey(), BR_ENTRY_FEE_LAMPORTS)
      } catch (err) {
        if (isUserRejection(err)) throw err
        // the wallet can die after broadcasting the transaction —
        // ask the server to find the payment on-chain instead of losing it
        console.warn('[solana] payEntryFee failed, attempting on-chain recovery:', err)
      }

      world.network.send(
        'joinBattleRoyale',
        signature ? { signature, wallet: activeWallet } : { wallet: activeWallet, recover: true }
      )
    } catch (err) {
      setPending(false)
      setError(err.message || 'Payment failed')
    }
  }

  const connectAndPay = async walletName => {
    setError(null)
    setWalletChoices(null)
    setPending(true)
    try {
      const pubkey = await connectWallet(walletName)
      setWallet(pubkey)
      world.network.send('setSolanaWallet', { wallet: pubkey })
      await payAndJoin(pubkey)
    } catch (err) {
      setPending(false)
      setError(err.message || 'Wallet connection failed')
    }
  }

  // Android: authorize + pay in a single Mobile Wallet Adapter session
  // (one app-switch to the wallet, both approvals in one visit)
  const payWithMwa = async () => {
    setPending(true)
    try {
      const { signature, walletPubkey } = await payEntryFeeMwa(getTreasuryPubkey(), BR_ENTRY_FEE_LAMPORTS)
      setWallet(walletPubkey)
      world.network.send('setSolanaWallet', { wallet: walletPubkey })
      world.network.send('joinBattleRoyale', { signature, wallet: walletPubkey })
    } catch (err) {
      setPending(false)
      if (isUserRejection(err)) {
        setError('Payment cancelled')
        return
      }
      console.warn('[solana] MWA payment failed:', err)
      // offer the wallet in-app browser as a fallback path
      setError(err.message || 'Wallet payment failed')
      setNotice('Having trouble? Open the game inside your wallet app instead.')
      setWalletChoices(getWalletBrowserLinks().map(({ name, url }) => ({ type: 'link', name, url })))
    }
  }

  const joinBattleRoyale = async () => {
    setError(null)
    setNotice(null)
    if (!getTreasuryPubkey()) {
      setError('Arena payments are not configured')
      return
    }
    if (wallet) {
      await payAndJoin(wallet)
      return
    }

    // wallets injected into the page (extension or wallet in-app browser)
    // are the reliable path — connect and pay directly
    const injected = getInjectedSolanaWallets()
    if (injected.length === 1) {
      await connectAndPay(injected[0].name)
      return
    }
    if (injected.length > 1) {
      setWalletChoices(injected.map(({ name, icon }) => ({ type: 'wallet', name, icon })))
      return
    }

    // Android: Mobile Wallet Adapter connects to the native wallet app
    if (isMwaSupported()) {
      await payWithMwa()
      return
    }

    // other phones (iOS): reopen the game inside the wallet app's browser
    if (isMobileUserAgent()) {
      setNotice('Choose your wallet app — the game will reopen inside it so you can pay securely.')
      setWalletChoices(getWalletBrowserLinks().map(({ name, url }) => ({ type: 'link', name, url })))
      return
    }

    setError('No Solana wallet found. Install Phantom, Solflare, or another Solana wallet and reload.')
  }


  return (
    <div
      css={css`
        position: absolute;
        top: 5.5rem;
        right: 1rem;
        width: fit-content;
        max-width: min(27rem, calc(100vw - 2rem));
        pointer-events: auto;
        z-index: 997;
        .arena-panel {
          position: relative;
          display: inline-block;
          max-width: min(27rem, calc(100vw - 2rem));
          border: none;
          background: transparent;
        }
        .arena-scroll {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: fill;
          pointer-events: none;
        }
        .arena-panel-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.6rem;
          padding: 1.75rem 2.5rem 2rem;
        }
        .arena-title {
          font-size: clamp(1.1rem, 3vw, 1.35rem);
          font-weight: 700;
          margin: 0;
          color: #3d2817;
          text-align: center;
          letter-spacing: 0.02em;
        }
        .arena-subtitle {
          color: #5c4033;
          font-size: 0.82rem;
          margin: 0;
          max-width: 13rem;
          text-align: center;
          line-height: 1.4;
        }
        .arena-actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
        }
        .arena-enter,
        .arena-enter-test {
          width: fit-content;
          max-width: 100%;
          box-sizing: border-box;
          padding: 0.5rem 0.9rem;
          border: none;
          border-radius: 6px;
          font-size: 0.88rem;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          transition: opacity 0.2s, filter 0.2s, background 0.2s;
        }
        .arena-wallet-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: #5c4033;
          text-align: center;
        }
        .arena-enter {
          color: #fff8f0;
          background: #7a1515;
          &:hover:not(:disabled) {
            background: #8b1a1a;
          }
          &:disabled {
            opacity: 0.35;
            cursor: not-allowed;
          }
        }
        .arena-enter-test {
          color: #f0f8ff;
          background: #1e4a7a;
          &:hover:not(:disabled) {
            background: #2563a8;
          }
          &:disabled {
            opacity: 0.35;
            cursor: not-allowed;
          }
        }
        .arena-wallet-list {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          width: 100%;
          max-width: 14rem;
        }
        .arena-wallet-list-title {
          font-size: 0.78rem;
          font-weight: 700;
          color: #3d2817;
          text-align: center;
          margin-bottom: 0.15rem;
        }
        .arena-wallet-option {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.45rem 0.7rem;
          border: 1px solid rgba(61, 40, 23, 0.35);
          border-radius: 6px;
          background: rgba(255, 248, 240, 0.55);
          color: #3d2817;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
          &:hover {
            background: rgba(255, 248, 240, 0.9);
          }
          img {
            width: 1.25rem;
            height: 1.25rem;
            border-radius: 4px;
          }
        }
        .arena-wallet-cancel {
          border: none;
          background: none;
          padding: 0.2rem;
          font-size: 0.72rem;
          font-weight: 600;
          color: #5c4033;
          text-decoration: underline;
          cursor: pointer;
          &:hover {
            color: #3d2817;
          }
        }
        .arena-error {
          font-size: 0.72rem;
          color: #7a1515;
          line-height: 1.35;
          text-align: center;
          max-width: 13rem;
        }
        .arena-queued {
          font-size: 0.85rem;
          font-weight: 700;
          color: #1e5c2f;
          text-align: center;
        }
        .arena-pot {
          font-size: 0.78rem;
          font-weight: 600;
          color: #5c4033;
          text-align: center;
        }
        .arena-notice {
          font-size: 0.75rem;
          font-weight: 600;
          color: #1e5c2f;
          line-height: 1.35;
          text-align: center;
          max-width: 13rem;
        }
      `}
    >
      <div className='arena-panel'>
        <img className='arena-scroll' src={SCROLL_SRC} alt='' />
        <div className='arena-panel-content'>
          <h2 className='arena-title'>The Arena</h2>
          {isSpectator ? (
            <p className='arena-subtitle'>
              Fight freely in the arena, or pay {BR_ENTRY_FEE_SOL} SOL to enter the battle royale. Winner takes the
              pot.
            </p>
          ) : (
            <p className='arena-subtitle'>
              You are fighting in the arena. Return to the stands, or pay {BR_ENTRY_FEE_SOL} SOL to enter the battle
              royale.
            </p>
          )}
          <div className='arena-actions'>
            {isSpectator ? (
              <button type='button' className='arena-enter-test' onClick={enterArena} disabled={pending}>
                Enter the Arena
              </button>
            ) : (
              <button type='button' className='arena-enter-test' onClick={becomeSpectator} disabled={pending}>
                Become Spectator
              </button>
            )}
            {wallet ? <div className='arena-wallet-label'>{truncateAddress(wallet)}</div> : null}
            {isQueued ? (
              <div className='arena-queued'>You are in the battle royale queue!</div>
            ) : walletChoices ? (
              <div className='arena-wallet-list'>
                <div className='arena-wallet-list-title'>Choose a wallet</div>
                {walletChoices.map(({ type, name, icon, url }) =>
                  type === 'link' ? (
                    <button
                      key={name}
                      type='button'
                      className='arena-wallet-option'
                      onClick={() => {
                        window.location.href = url
                      }}
                    >
                      <span>Open in {name}</span>
                    </button>
                  ) : (
                    <button
                      key={name}
                      type='button'
                      className='arena-wallet-option'
                      onClick={() => connectAndPay(name)}
                    >
                      {icon ? <img src={icon} alt='' /> : null}
                      <span>{name}</span>
                    </button>
                  )
                )}
                <button type='button' className='arena-wallet-cancel' onClick={() => setWalletChoices(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type='button' className='arena-enter' onClick={joinBattleRoyale} disabled={pending}>
                {pending ? 'Verifying payment…' : `Join Battle Royale (${BR_ENTRY_FEE_SOL} SOL)`}
              </button>
            )}
            <div className='arena-pot'>
              {queuedIds.length} queued · pot {formatSol(winnerLamports)} SOL
            </div>
          </div>
          {notice ? <div className='arena-notice'>{notice}</div> : null}
          {error ? <div className='arena-error'>{error}</div> : null}
        </div>
      </div>
    </div>
  )
}
