import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { derivePath } from 'ed25519-hd-key'
import { mnemonicToSeedSync, validateMnemonic } from 'bip39'
import { BET_STAKE_LAMPORTS, BR_ENTRY_FEE_LAMPORTS } from './solanaConfig.js'

const DEFAULT_DERIVATION_PATH = "m/44'/501'/0'/0'"

let connection
let treasuryKeypair
let db

function keypairFromMnemonic(mnemonic, passphrase = '') {
  const normalized = mnemonic.trim().replace(/\s+/g, ' ')
  if (!validateMnemonic(normalized)) {
    throw new Error('[solana] Invalid treasury seed phrase')
  }
  const seed = mnemonicToSeedSync(normalized, passphrase)
  const path = process.env.SOLANA_TREASURY_DERIVATION_PATH || DEFAULT_DERIVATION_PATH
  const { key } = derivePath(path, seed.toString('hex'))
  return Keypair.fromSeed(key)
}

export function initSolanaPayments(database) {
  const rpcUrl = process.env.SOLANA_RPC_URL
  const mnemonic = process.env.SOLANA_TREASURY_SEED_PHRASE
  if (!rpcUrl || !mnemonic) {
    throw new Error('[envs] SOLANA_RPC_URL and SOLANA_TREASURY_SEED_PHRASE must be set')
  }
  connection = new Connection(rpcUrl, 'confirmed')
  treasuryKeypair = keypairFromMnemonic(mnemonic, process.env.SOLANA_TREASURY_SEED_PASSPHRASE ?? '')
  db = database
  return treasuryKeypair.publicKey.toBase58()
}

export function getTreasuryPublicKey() {
  if (!treasuryKeypair) return null
  return treasuryKeypair.publicKey.toBase58()
}

function getAccountKeys(tx) {
  const message = tx.transaction.message
  const loaded = tx.meta?.loadedAddresses
  if (message.version === 'legacy') {
    const keys = message.staticAccountKeys ?? message.accountKeys
    return {
      length: keys.length,
      get: i => keys[i],
    }
  }
  return message.getAccountKeys({
    accountKeysFromLookups: loaded,
  })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Check a single confirmed transaction against a fixed treasury transfer amount.
 * Throws 'not found' when the RPC has not seen the tx yet (retryable),
 * or a validation error when the tx exists but is not a valid payment.
 */
async function checkTreasuryPaymentTx(signature, walletPubkey, lamports, label = 'payment') {
  const tx = await connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
  if (!tx?.meta) {
    const err = new Error('Transaction not found')
    err.retryable = true
    throw err
  }
  if (tx.meta.err) {
    throw new Error('Transaction failed on-chain')
  }

  const treasuryPubkey = treasuryKeypair.publicKey
  const senderPubkey = new PublicKey(walletPubkey)
  const accountKeys = getAccountKeys(tx)

  let treasuryIndex = -1
  let senderIndex = -1
  for (let i = 0; i < accountKeys.length; i++) {
    const key = accountKeys.get(i)
    if (key.equals(treasuryPubkey)) treasuryIndex = i
    if (key.equals(senderPubkey)) senderIndex = i
  }

  if (treasuryIndex < 0 || senderIndex < 0) {
    throw new Error('Invalid transfer accounts')
  }

  const treasuryDelta = tx.meta.postBalances[treasuryIndex] - tx.meta.preBalances[treasuryIndex]
  const senderDelta = tx.meta.preBalances[senderIndex] - tx.meta.postBalances[senderIndex]

  if (treasuryDelta !== lamports) {
    throw new Error(`Incorrect ${label} amount`)
  }
  if (senderDelta < lamports) {
    throw new Error(`Sender did not pay ${label}`)
  }

  return true
}

async function recordSolanaTx(signature, playerId, type) {
  await db('solana_txs').insert({
    signature,
    player_id: playerId,
    type,
    created_at: new Date().toISOString(),
  })
}

async function verifyTreasuryPayment({
  signature,
  walletPubkey,
  playerId,
  lamports,
  type,
  label,
  attempts = 6,
  delayMs = 3000,
}) {
  const existing = await db('solana_txs').where('signature', signature).first()
  if (existing) {
    throw new Error('Transaction already used')
  }

  for (let attempt = 1; ; attempt++) {
    try {
      await checkTreasuryPaymentTx(signature, walletPubkey, lamports, label)
      break
    } catch (err) {
      if (!err.retryable || attempt >= attempts) throw err
      await sleep(delayMs)
    }
  }

  await recordSolanaTx(signature, playerId, type)
  return true
}

async function findRecentTreasuryPayment({
  walletPubkey,
  playerId,
  lamports,
  type,
  label,
  maxAgeSeconds = 600,
  attempts = 6,
  delayMs = 5000,
}) {
  const senderPubkey = new PublicKey(walletPubkey)

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const infos = await connection.getSignaturesForAddress(senderPubkey, { limit: 10 }, 'confirmed')
      const now = Date.now() / 1000
      for (const info of infos) {
        if (info.err) continue
        if (info.blockTime && now - info.blockTime > maxAgeSeconds) continue
        const existing = await db('solana_txs').where('signature', info.signature).first()
        if (existing) continue
        try {
          await checkTreasuryPaymentTx(info.signature, walletPubkey, lamports, label)
        } catch {
          continue
        }
        await recordSolanaTx(info.signature, playerId, type)
        return info.signature
      }
    } catch (err) {
      console.error(`[solana] ${label} recovery scan failed:`, err)
    }
    if (attempt < attempts) await sleep(delayMs)
  }

  return null
}

export async function verifyEntryPayment({ signature, walletPubkey, playerId, attempts = 6, delayMs = 3000 }) {
  return verifyTreasuryPayment({
    signature,
    walletPubkey,
    playerId,
    lamports: BR_ENTRY_FEE_LAMPORTS,
    type: 'br_entry',
    label: 'entry fee',
    attempts,
    delayMs,
  })
}

/**
 * Recovery path: the player says they paid but the wallet never returned a
 * signature (e.g. the Phantom extension port died mid-flow). Scan the wallet's
 * recent transactions for an unclaimed entry payment to the treasury.
 * Returns the signature when found and recorded, or null.
 */
export async function findRecentEntryPayment({ walletPubkey, playerId, maxAgeSeconds = 600, attempts = 6, delayMs = 5000 }) {
  return findRecentTreasuryPayment({
    walletPubkey,
    playerId,
    lamports: BR_ENTRY_FEE_LAMPORTS,
    type: 'br_entry',
    label: 'entry fee',
    maxAgeSeconds,
    attempts,
    delayMs,
  })
}

export async function verifyBetPayment({ signature, walletPubkey, playerId, attempts = 6, delayMs = 3000 }) {
  return verifyTreasuryPayment({
    signature,
    walletPubkey,
    playerId,
    lamports: BET_STAKE_LAMPORTS,
    type: 'bet',
    label: 'bet',
    attempts,
    delayMs,
  })
}

export async function findRecentBetPayment({ walletPubkey, playerId, maxAgeSeconds = 600, attempts = 6, delayMs = 5000 }) {
  return findRecentTreasuryPayment({
    walletPubkey,
    playerId,
    lamports: BET_STAKE_LAMPORTS,
    type: 'bet',
    label: 'bet',
    maxAgeSeconds,
    attempts,
    delayMs,
  })
}

/** Send lamports from the treasury to a wallet (e.g. the battle royale winner's pot). */
export async function sendPayout(walletPubkey, lamports, playerId, type = 'br_win') {
  if (!connection || !treasuryKeypair) return null
  if (!lamports || lamports <= 0) return null

  try {
    const toPubkey = new PublicKey(walletPubkey)
    const balance = await connection.getBalance(treasuryKeypair.publicKey)
    const minRequired = lamports + 5000
    if (balance < minRequired) {
      console.error('[solana] Treasury balance too low for payout:', balance, 'needed:', minRequired)
      return null
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasuryKeypair.publicKey,
        toPubkey,
        lamports,
      })
    )

    const signature = await sendAndConfirmTransaction(connection, tx, [treasuryKeypair])

    await db('solana_txs').insert({
      signature,
      player_id: playerId,
      type,
      created_at: new Date().toISOString(),
    })

    return signature
  } catch (err) {
    console.error('[solana] Payout failed:', err)
    return null
  }
}
