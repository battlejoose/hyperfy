import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { isSpectatorSessionAvatar } from '../../core/extras/playerAvatars'
import { BR_ENTRY_FEE_LAMPORTS, BR_HOUSE_FEE_PERCENT, LAMPORTS_PER_SOL } from '../../core/extras/solanaConfig.js'
import {
  connectPhantom,
  connectPhantomEager,
  getTreasuryPubkey,
  isPhantomInstalled,
  isUserRejection,
  payEntryFee,
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

  // silently reconnect a previously-trusted wallet so the server can
  // auto-restore any unclaimed entry payment after a crash or rejoin
  useEffect(() => {
    let cancelled = false
    connectPhantomEager().then(pubkey => {
      if (cancelled || !pubkey) return
      setWallet(pubkey)
      world.network.send('setSolanaWallet', { wallet: pubkey })
    })
    return () => {
      cancelled = true
    }
  }, [world])

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

  const joinBattleRoyale = async () => {
    setError(null)
    const treasury = getTreasuryPubkey()
    if (!treasury) {
      setError('Arena payments are not configured')
      return
    }
    if (!isPhantomInstalled()) {
      setError('Phantom wallet not found')
      return
    }

    setPending(true)
    try {
      let activeWallet = wallet
      if (!activeWallet) {
        activeWallet = await connectPhantom()
        setWallet(activeWallet)
        world.network.send('setSolanaWallet', { wallet: activeWallet })
      }

      let signature = null
      try {
        signature = await payEntryFee(treasury, BR_ENTRY_FEE_LAMPORTS)
      } catch (err) {
        if (isUserRejection(err)) throw err
        // the wallet extension can die after broadcasting the transaction —
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
            ) : (
              <button type='button' className='arena-enter' onClick={joinBattleRoyale} disabled={pending}>
                {pending ? 'Verifying payment…' : `Join Battle Royale (${BR_ENTRY_FEE_SOL} SOL)`}
              </button>
            )}
            <div className='arena-pot'>
              {queuedIds.length} queued · pot {formatSol(winnerLamports)} SOL
            </div>
          </div>
          {error ? <div className='arena-error'>{error}</div> : null}
        </div>
      </div>
    </div>
  )
}
