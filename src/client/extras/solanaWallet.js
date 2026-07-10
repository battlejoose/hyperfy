import {
  clusterApiUrl,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import { BR_ENTRY_FEE_LAMPORTS } from '../../core/extras/solanaConfig.js'

function getRpcUrl() {
  return globalThis.env?.PUBLIC_SOLANA_RPC_URL || clusterApiUrl('mainnet')
}

function getPhantom() {
  const provider = globalThis.phantom?.solana ?? globalThis.solana
  return provider?.isPhantom ? provider : null
}

export function isPhantomInstalled() {
  return !!getPhantom()
}

export async function connectPhantom() {
  const phantom = getPhantom()
  if (!phantom) {
    throw new Error('Phantom wallet not found. Install Phantom to enter the arena.')
  }
  const resp = await phantom.connect()
  return resp.publicKey.toBase58()
}

/**
 * Silently reconnect to Phantom if the user already trusted this site.
 * Returns the wallet pubkey or null — never prompts or throws.
 */
export async function connectPhantomEager() {
  const phantom = getPhantom()
  if (!phantom) return null
  try {
    const resp = await phantom.connect({ onlyIfTrusted: true })
    return resp.publicKey.toBase58()
  } catch {
    return null
  }
}

export async function payEntryFee(treasuryPubkey, lamports = BR_ENTRY_FEE_LAMPORTS) {
  const phantom = getPhantom()
  if (!phantom?.publicKey) {
    throw new Error('Connect your wallet first')
  }

  const connection = new Connection(getRpcUrl(), 'confirmed')
  const fromPubkey = phantom.publicKey
  const toPubkey = new PublicKey(treasuryPubkey)

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const transaction = new Transaction({
    feePayer: fromPubkey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports,
    })
  )

  const { signature } = await phantom.signAndSendTransaction(transaction)
  try {
    await connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      'confirmed'
    )
  } catch (err) {
    // we already have the signature — the server verifies on-chain with
    // retries, so a client-side confirmation hiccup must not lose the payment
    console.warn('[solana] confirmTransaction failed, continuing with signature:', err)
  }

  return signature
}

/** True when the wallet error means the user declined, rather than a wallet/extension failure. */
export function isUserRejection(err) {
  if (!err) return false
  if (err.code === 4001) return true
  return /reject|declin|denied|cancell?ed/i.test(err.message || '')
}

export function getTreasuryPubkey() {
  return globalThis.env?.PUBLIC_SOLANA_TREASURY_PUBKEY ?? null
}
