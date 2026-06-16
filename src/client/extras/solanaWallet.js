import {
  clusterApiUrl,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import { ENTRY_FEE_LAMPORTS } from '../../core/extras/solanaConfig.js'

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

export async function payEntryFee(treasuryPubkey, lamports = ENTRY_FEE_LAMPORTS) {
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
  await connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    'confirmed'
  )

  return signature
}

export function getTreasuryPubkey() {
  return globalThis.env?.PUBLIC_SOLANA_TREASURY_PUBKEY ?? null
}
