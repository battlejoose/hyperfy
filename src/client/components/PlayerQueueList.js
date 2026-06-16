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
        width: min(18rem, calc(100vw - 2rem));
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        pointer-events: auto;
        z-index: 997;
        background: rgba(15, 16, 24, 0.72);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 12px 48px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(8px);
        padding: 0.85rem 1rem;
        .arena-title {
          font-size: 0.95rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.95);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .arena-subtitle {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.55);
          line-height: 1.35;
        }
        .arena-wallet,
        .arena-enter {
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(255, 255, 255, 0.06);
          color: white;
          border-radius: 8px;
          padding: 0.55rem 0.75rem;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
          &:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.28);
          }
          &:disabled {
            opacity: 0.55;
            cursor: not-allowed;
          }
        }
        .arena-error {
          font-size: 0.78rem;
          color: #f87171;
          line-height: 1.35;
        }
      `}
    >
      <div className='arena-title'>The Arena</div>
      <div className='arena-subtitle'>
        Enter the arena to fight as a gladiator. Entry fee: {ENTRY_FEE_SOL} SOL. If you fall, return here as a
        spectator.
      </div>
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
      {error ? <div className='arena-error'>{error}</div> : null}
    </div>
  )
}
