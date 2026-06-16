import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { isSpectatorSessionAvatar } from '../../core/extras/playerAvatars'
import { ENTRY_FEE_LAMPORTS } from '../../core/extras/solanaConfig.js'
import {
  connectPhantom,
  getTreasuryPubkey,
  isPhantomInstalled,
  payEntryFee,
} from '../extras/solanaWallet.js'

const SCROLL_SRC = '/assets/scroll.png'
const ENTRY_FEE_SOL = ENTRY_FEE_LAMPORTS / 1_000_000_000

function truncateAddress(address) {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

export function PlayerQueueList({ world }) {
  const [player, setPlayer] = useState(() => world.entities?.player)
  const [wallet, setWallet] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onPlayer = p => setPlayer(p)
    world.on('player', onPlayer)
    return () => world.off('player', onPlayer)
  }, [world])

  useEffect(() => {
    const onResult = data => {
      setPending(false)
      if (!data?.ok) {
        setError(data?.error || 'Failed to enter the arena')
        return
      }
      setError(null)
    }
    world.on('enterArenaResult', onResult)
    return () => world.off('enterArenaResult', onResult)
  }, [world])

  const isSpectator = player && isSpectatorSessionAvatar(player.data.sessionAvatar)

  if (!isSpectator) return null

  const connectWallet = async () => {
    setError(null)
    try {
      const pubkey = await connectPhantom()
      setWallet(pubkey)
      world.network.send('setSolanaWallet', { wallet: pubkey })
    } catch (err) {
      setError(err.message || 'Failed to connect wallet')
    }
  }

  const enterArena = async () => {
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

      const signature = await payEntryFee(treasury)
      world.network.send('enterArena', { signature, wallet: activeWallet })
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
        width: min(27rem, calc(100vw - 2rem));
        pointer-events: auto;
        z-index: 997;
        .arena-panel {
          position: relative;
          width: 100%;
          min-height: 15rem;
          padding: 18% 26% 19%;
          box-sizing: border-box;
          border: none;
          overflow: hidden;
          background: transparent;
        }
        .arena-scroll {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 118%;
          height: 135%;
          transform: translate(-50%, -50%);
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
        .arena-wallet,
        .arena-enter {
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
        .arena-wallet {
          color: #3d2817;
          background: rgba(255, 248, 235, 0.65);
          border: 1px solid rgba(61, 40, 23, 0.35);
          &:hover:not(:disabled) {
            background: rgba(255, 248, 235, 0.85);
            border-color: rgba(61, 40, 23, 0.65);
          }
          &:disabled {
            opacity: 0.35;
            cursor: not-allowed;
          }
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
        .arena-error {
          font-size: 0.72rem;
          color: #7a1515;
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
          <p className='arena-subtitle'>
            Enter the arena to fight as a gladiator. Entry fee: {ENTRY_FEE_SOL} SOL. If you fall, return here as a
            spectator.
          </p>
          <div className='arena-actions'>
            {!wallet ? (
              <button type='button' className='arena-wallet' onClick={connectWallet} disabled={pending}>
                Connect Wallet
              </button>
            ) : (
              <button type='button' className='arena-wallet' onClick={connectWallet} disabled={pending}>
                {truncateAddress(wallet)}
              </button>
            )}
            <button type='button' className='arena-enter' onClick={enterArena} disabled={pending}>
              {pending ? 'Processing…' : `Enter the Arena (${ENTRY_FEE_SOL} SOL)`}
            </button>
          </div>
          {error ? <div className='arena-error'>{error}</div> : null}
        </div>
      </div>
    </div>
  )
}
