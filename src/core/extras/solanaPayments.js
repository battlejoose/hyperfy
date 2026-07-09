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
import { BR_ENTRY_FEE_LAMPORTS } from './solanaConfig.js'

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

export async function verifyEntryPayment({ signature, walletPubkey, playerId }) {
  const existing = await db('solana_txs').where('signature', signature).first()
  if (existing) {
    throw new Error('Transaction already used')
  }

  const tx = await connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
  if (!tx?.meta || tx.meta.err) {
    throw new Error('Transaction not found or failed')
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

  if (treasuryDelta !== BR_ENTRY_FEE_LAMPORTS) {
    throw new Error('Incorrect entry fee amount')
  }
  if (senderDelta < BR_ENTRY_FEE_LAMPORTS) {
    throw new Error('Sender did not pay entry fee')
  }

  await db('solana_txs').insert({
    signature,
    player_id: playerId,
    type: 'br_entry',
    created_at: new Date().toISOString(),
  })

  return true
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
