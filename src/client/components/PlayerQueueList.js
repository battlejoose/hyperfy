import { useEffect, useRef, useState } from 'react'
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
import { QueueArenaRankings } from './ArenaRankings'

const SCROLL_SRC = '/assets/scroll.png'
const LEFT_CLICK_ICON = '/assets/leftclick.png'
const RIGHT_CLICK_ICON = '/assets/rightclick.png'
const F_KEY_ICON = '/assets/fkey.png'

function truncateAddress(address) {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

function formatSol(lamports) {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4).replace(/\.?0+$/, '')
}

function formatFeeLabel(lamports) {
  // e.g. 0.01 -> .01
  return (lamports / LAMPORTS_PER_SOL).toFixed(2).replace(/^0/, '')
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

const MOBILE_QUEUE_MQ = '(max-width: 640px), (orientation: landscape) and (max-height: 500px)'

export function PlayerQueueList({ world }) {
  const rootRef = useRef(null)
  const portraitWidthRef = useRef(null)
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
  const [showHelp, setShowHelp] = useState(false)
  const [remaining, setRemaining] = useState(0)

  // Lock mobile queue to portrait width so landscape stays the same physical size
  // (100vmin shrinks under landscape browser chrome and makes the panel taller).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const apply = () => {
      const compact = window.matchMedia(MOBILE_QUEUE_MQ).matches
      if (!compact) {
        portraitWidthRef.current = null
        root.style.width = ''
        root.style.maxWidth = ''
        return
      }
      const landscape = window.matchMedia('(orientation: landscape)').matches
      if (!landscape) {
        portraitWidthRef.current = Math.round(window.innerWidth - 16)
      }
      const width =
        portraitWidthRef.current || Math.round(Math.min(window.screen.width, window.screen.height) - 16)
      root.style.width = `${width}px`
      root.style.maxWidth = `${width}px`
    }
    apply()
    let orientTimer
    const onOrient = () => {
      apply()
      clearTimeout(orientTimer)
      orientTimer = setTimeout(apply, 150)
    }
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', onOrient)
    const mq = window.matchMedia(MOBILE_QUEUE_MQ)
    mq.addEventListener?.('change', apply)
    return () => {
      clearTimeout(orientTimer)
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', onOrient)
      mq.removeEventListener?.('change', apply)
    }
  }, [])

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

  // countdown to the next battle royale
  useEffect(() => {
    if (!match) return
    const update = () => {
      if (match.phase !== 'queue' || !match.endsAt) {
        setRemaining(0)
        return
      }
      setRemaining(Math.max(0, Math.ceil(match.endsAt - world.network.getTime())))
    }
    update()
    const id = setInterval(update, 200)
    return () => clearInterval(id)
  }, [match, world])

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
      ref={rootRef}
      css={css`
        position: absolute;
        top: 0.75rem;
        left: 50%;
        transform: translateX(-50%);
        width: fit-content;
        max-width: min(44rem, calc(100vw - 2rem));
        pointer-events: auto;
        z-index: 997;
        .arena-panel {
          position: relative;
          display: inline-block;
          max-width: min(44rem, calc(100vw - 2rem));
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
          gap: 0.35rem;
          padding: 1.05rem 3rem 1.15rem;
        }
        .arena-row {
          display: flex;
          align-items: flex-start;
          justify-content: center;
          gap: 1.75rem;
          width: 100%;
        }
        .arena-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
          min-width: 10rem;
        }
        .arena-col-left {
          align-items: center;
          justify-content: flex-start;
          min-width: 11rem;
          gap: 0.18rem;
        }
        .arena-col-center {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.28rem;
          padding-top: 0;
        }
        .arena-countdown {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 0.35rem;
        }
        .arena-countdown-words {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          justify-content: center;
          gap: 0;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #5c4033;
          line-height: 1.1;
          text-align: right;
        }
        .arena-countdown-colon {
          font-size: 1.7rem;
          font-weight: 700;
          line-height: 1;
          color: #5c4033;
          align-self: stretch;
          display: flex;
          align-items: center;
        }
        .arena-countdown-time {
          font-size: 1.95rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1;
          color: #3d2817;
          text-align: center;
        }
        .arena-howto-wrap {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
        }
        .arena-howto {
          width: fit-content;
          padding: 0.35rem 0.8rem;
          border: 1px solid rgba(61, 40, 23, 0.45);
          border-radius: 6px;
          background: rgba(255, 248, 240, 0.6);
          color: #3d2817;
          font-size: 0.78rem;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s;
          &:hover {
            background: rgba(255, 248, 240, 0.95);
          }
        }
        .arena-howto-popup {
          position: absolute;
          top: calc(100% + 0.4rem);
          right: 0;
          width: min(18rem, 70vw);
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
          background: rgba(255, 248, 235, 0.97);
          border: 1px solid rgba(61, 40, 23, 0.35);
          border-radius: 0.55rem;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
          padding: 0.7rem 0.75rem;
          color: #3d2817;
        }
        .arena-howto-popup-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .arena-howto-popup-title {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #5c4033;
        }
        .arena-howto-close {
          flex-shrink: 0;
          border: 1px solid rgba(61, 40, 23, 0.45);
          border-radius: 6px;
          background: rgba(255, 248, 240, 0.85);
          color: #3d2817;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          cursor: pointer;
          padding: 0.28rem 0.55rem;
          white-space: nowrap;
          transition: background 0.15s;
          &:hover {
            background: rgba(255, 248, 240, 1);
          }
        }
        .arena-tutorial {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .arena-tutorial-row {
          display: flex;
          gap: 0.45rem;
          align-items: center;
          font-size: 0.78rem;
          color: #5c4033;
          line-height: 1.4;
        }
        .arena-tutorial-key {
          flex-shrink: 0;
          width: 3.2rem;
          font-weight: 700;
          color: #3d2817;
        }
        .arena-tutorial-icon {
          flex-shrink: 0;
          width: 1.5rem;
          height: 1.5rem;
          object-fit: contain;
          display: block;
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
          line-height: 1.2;
        }
        .arena-enter {
          padding: 0.4rem 0.75rem;
          font-size: 0.78rem;
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
          white-space: nowrap;
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
          max-width: 14rem;
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
          line-height: 1.2;
        }
        .arena-notice {
          font-size: 0.75rem;
          font-weight: 600;
          color: #1e5c2f;
          line-height: 1.35;
          text-align: center;
          max-width: 14rem;
        }
        /* Portrait phones + landscape phones (short height). Width is locked in JS to
           the portrait size so landscape matches exactly (see portraitWidthRef). */
        @media (max-width: 640px), (orientation: landscape) and (max-height: 500px) {
          width: calc(100vw - 1rem);
          max-width: calc(100vw - 1rem);
          .arena-panel {
            display: block;
            width: 100%;
            max-width: 100%;
          }
          .arena-panel-content {
            padding: 0.75rem 3.5rem 0.9rem;
          }
          .arena-row {
            gap: 0.35rem;
            width: 100%;
            max-width: 100%;
          }
          .arena-col {
            min-width: 0;
            flex: 1 1 0;
            max-width: 4.85rem;
          }
          .arena-col-left {
            max-width: 4.85rem;
          }
          .arena-col-left .rank-open-btn {
            font-size: 0.58rem;
            padding: 0.28rem 0.35rem;
            white-space: nowrap;
            line-height: 1.2;
            width: 100%;
          }
          .arena-col-left .rank-popup {
            left: 0;
            transform: none;
            width: min(16rem, calc(100vmin - 2rem));
          }
          .arena-col-center {
            flex: 1.5 1 0;
            min-width: 0;
            max-width: 8.5rem;
          }
          .arena-countdown-words {
            font-size: 0.55rem;
            letter-spacing: 0.02em;
          }
          .arena-countdown-colon {
            font-size: 1.2rem;
          }
          .arena-countdown-time {
            font-size: 1.4rem;
          }
          .arena-enter,
          .arena-enter-test {
            font-size: 0.66rem;
            padding: 0.32rem 0.4rem;
            white-space: nowrap;
            text-align: center;
            line-height: 1.2;
            width: 100%;
            max-width: 100%;
          }
          .arena-howto {
            font-size: 0.64rem;
            padding: 0.28rem 0.38rem;
            white-space: nowrap;
            text-align: center;
            line-height: 1.2;
            width: 100%;
            max-width: 100%;
          }
          .arena-howto-popup {
            right: 0;
            left: auto;
            width: min(16rem, calc(100vmin - 2rem));
          }
          .arena-wallet-label,
          .arena-pot {
            font-size: 0.62rem;
            line-height: 1.25;
          }
          .arena-queued {
            font-size: 0.68rem;
            line-height: 1.25;
          }
          .arena-error,
          .arena-notice {
            font-size: 0.65rem;
            max-width: 8.5rem;
          }
          .arena-wallet-list {
            max-width: 8.5rem;
          }
        }
      `}
    >
      <div className='arena-panel'>
        <img className='arena-scroll' src={SCROLL_SRC} alt='' />
        <div className='arena-panel-content'>
          <div className='arena-row'>
            <div className='arena-col arena-col-left'>
              {wallet ? <div className='arena-wallet-label'>{truncateAddress(wallet)}</div> : null}
              <div className='arena-pot'>
                {queuedIds.length} queued · pot {formatSol(winnerLamports)} SOL
              </div>
              <QueueArenaRankings />
            </div>
            <div className='arena-col-center'>
              <div className='arena-countdown'>
                <div className='arena-countdown-words'>
                  <span>Next</span>
                  <span>Battle</span>
                </div>
                <div className='arena-countdown-colon'>/</div>
                <div className='arena-countdown-time'>{formatTime(remaining)}</div>
              </div>
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
                  {pending ? 'Verifying payment…' : `Join Battle (${formatFeeLabel(BR_ENTRY_FEE_LAMPORTS)} SOL)`}
                </button>
              )}
              {notice ? <div className='arena-notice'>{notice}</div> : null}
              {error ? <div className='arena-error'>{error}</div> : null}
            </div>
            <div className='arena-col'>
              {isSpectator ? (
                <button type='button' className='arena-enter-test' onClick={enterArena} disabled={pending}>
                  Fight for Free
                </button>
              ) : (
                <button type='button' className='arena-enter-test' onClick={becomeSpectator} disabled={pending}>
                  Spectate
                </button>
              )}
              <div className='arena-howto-wrap'>
                <button type='button' className='arena-howto' onClick={() => setShowHelp(v => !v)}>
                  How to Fight
                </button>
                {showHelp && (
                  <div className='arena-howto-popup'>
                    <div className='arena-howto-popup-header'>
                      <div className='arena-howto-popup-title'>How to Fight</div>
                      <button type='button' className='arena-howto-close' onClick={() => setShowHelp(false)}>
                        Close
                      </button>
                    </div>
                    <div className='arena-tutorial'>
                      <div className='arena-tutorial-row'>
                        <span className='arena-tutorial-key'>Attack</span>
                        <img className='arena-tutorial-icon' src={LEFT_CLICK_ICON} alt='' />
                        <span>LEFT CLICK (hold and drag in any direction)</span>
                      </div>
                      <div className='arena-tutorial-row'>
                        <span className='arena-tutorial-key'>Block</span>
                        <img className='arena-tutorial-icon' src={RIGHT_CLICK_ICON} alt='' />
                        <span>RIGHT CLICK (hold and drag in any direction)</span>
                      </div>
                      <div className='arena-tutorial-row'>
                        <span className='arena-tutorial-key'>Kick</span>
                        <img className='arena-tutorial-icon' src={F_KEY_ICON} alt='' />
                        <span>F KEY (breaks an opponent's block)</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
