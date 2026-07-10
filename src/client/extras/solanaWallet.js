import { getWallets } from '@wallet-standard/app'
import bs58 from 'bs58'
import {
  clusterApiUrl,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
  registerMwa,
} from '@solana-mobile/wallet-standard-mobile'
import { BR_ENTRY_FEE_LAMPORTS } from '../../core/extras/solanaConfig.js'

const SOLANA_CHAIN = 'solana:mainnet'
const LAST_WALLET_KEY = 'hyperfy:lastSolanaWallet'

function getRpcUrl() {
  return globalThis.env?.PUBLIC_SOLANA_RPC_URL || clusterApiUrl('mainnet-beta')
}

// register Mobile Wallet Adapter as a standard wallet so Android users can
// connect their native wallet apps (Phantom, Solflare, Seed Vault, ...)
let mwaRegistered = false
function ensureMwa() {
  if (mwaRegistered || typeof window === 'undefined') return
  mwaRegistered = true
  try {
    registerMwa({
      appIdentity: {
        name: 'Hyperfy Arena',
        uri: window.location.origin,
      },
      authorizationCache: createDefaultAuthorizationCache(),
      chains: [SOLANA_CHAIN],
      chainSelector: createDefaultChainSelector(),
      onWalletNotFound: createDefaultWalletNotFoundHandler(),
    })
  } catch (err) {
    console.warn('[solana] Mobile Wallet Adapter registration failed:', err)
  }
}

function isSolanaStandardWallet(wallet) {
  return (
    wallet.chains?.some(chain => chain.startsWith('solana:')) &&
    'standard:connect' in wallet.features &&
    ('solana:signAndSendTransaction' in wallet.features || 'solana:signTransaction' in wallet.features)
  )
}

/** All detected Solana wallets: [{ name, icon, wallet }] */
export function getSolanaWallets() {
  ensureMwa()
  return getWallets()
    .get()
    .filter(isSolanaStandardWallet)
    .map(wallet => ({ name: wallet.name, icon: wallet.icon, wallet }))
}

/** Subscribe to wallets being registered/unregistered. Returns unsubscribe. */
export function onSolanaWalletsChange(callback) {
  ensureMwa()
  const { on } = getWallets()
  const offRegister = on('register', callback)
  const offUnregister = on('unregister', callback)
  return () => {
    offRegister()
    offUnregister()
  }
}

export function isAnyWalletAvailable() {
  return getSolanaWallets().length > 0
}

/**
 * Mobile Wallet Adapter launches an app-switch to the wallet for every
 * operation, and Android Chrome blocks that unless it comes from a fresh user
 * gesture — so connect and pay must be separate taps for these wallets.
 */
export function walletNeedsSeparateGesture(walletName) {
  return !!walletName?.includes('Mobile Wallet Adapter')
}

// currently connected wallet + account
let connected = null // { wallet, account, pubkey }

export function getConnectedPubkey() {
  return connected?.pubkey ?? null
}

function pickSolanaAccount(accounts) {
  if (!accounts?.length) return null
  return accounts.find(account => account.chains?.some(chain => chain.startsWith('solana:'))) ?? accounts[0]
}

async function connectStandardWallet(wallet, { silent = false } = {}) {
  const connectFeature = wallet.features['standard:connect']
  const { accounts } = await connectFeature.connect(silent ? { silent: true } : undefined)
  const account = pickSolanaAccount(accounts)
  if (!account) {
    throw new Error(`${wallet.name} has no Solana account`)
  }
  connected = { wallet, account, pubkey: account.address }
  try {
    localStorage.setItem(LAST_WALLET_KEY, wallet.name)
  } catch {}
  return connected.pubkey
}

/** Connect a specific wallet by name (from getSolanaWallets). Returns the pubkey. */
export async function connectWallet(walletName) {
  const entry = getSolanaWallets().find(w => w.name === walletName)
  if (!entry) {
    throw new Error(`Wallet "${walletName}" not found`)
  }
  return connectStandardWallet(entry.wallet)
}

/**
 * Silently reconnect the wallet the user picked last time, if it still trusts
 * this site. Returns the pubkey or null — never prompts or throws.
 */
export async function connectWalletEager() {
  ensureMwa()
  let lastName = null
  try {
    lastName = localStorage.getItem(LAST_WALLET_KEY)
  } catch {}
  if (!lastName) return null
  const entry = getSolanaWallets().find(w => w.name === lastName)
  if (!entry) return null
  try {
    return await connectStandardWallet(entry.wallet, { silent: true })
  } catch {
    return null
  }
}

export function disconnectWallet() {
  const wallet = connected?.wallet
  connected = null
  try {
    localStorage.removeItem(LAST_WALLET_KEY)
  } catch {}
  wallet?.features['standard:disconnect']?.disconnect().catch(() => {})
}

/**
 * Pay the battle royale entry fee with the connected wallet.
 * Returns the transaction signature (base58).
 */
export async function payEntryFee(treasuryPubkey, lamports = BR_ENTRY_FEE_LAMPORTS) {
  if (!connected) {
    throw new Error('Connect your wallet first')
  }
  const { wallet, account } = connected

  const connection = new Connection(getRpcUrl(), 'confirmed')
  const fromPubkey = new PublicKey(account.address)
  const toPubkey = new PublicKey(treasuryPubkey)

  const {
    context: { slot: minContextSlot },
    value: { blockhash, lastValidBlockHeight },
  } = await connection.getLatestBlockhashAndContext('confirmed')

  // versioned (v0) transaction — mobile wallets parse these far more
  // reliably than legacy transactions with placeholder signatures
  const message = new TransactionMessage({
    payerKey: fromPubkey,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports,
      }),
    ],
  }).compileToV0Message()
  const transaction = new VersionedTransaction(message)
  const serialized = new Uint8Array(transaction.serialize())

  let signature
  const sendFeature = wallet.features['solana:signAndSendTransaction']
  if (sendFeature) {
    const [result] = await sendFeature.signAndSendTransaction({
      account,
      chain: SOLANA_CHAIN,
      transaction: serialized,
      // minContextSlot is required by Phantom via Mobile Wallet Adapter —
      // without it the request errors before the approval screen appears
      options: { commitment: 'confirmed', minContextSlot },
    })
    signature = bs58.encode(result.signature)
  } else {
    // wallet can only sign — broadcast the signed transaction ourselves
    const signFeature = wallet.features['solana:signTransaction']
    const [result] = await signFeature.signTransaction({
      account,
      chain: SOLANA_CHAIN,
      transaction: serialized,
    })
    signature = await connection.sendRawTransaction(result.signedTransaction)
  }

  try {
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  } catch (err) {
    // we already have the signature — the server verifies on-chain with
    // retries, so a client-side confirmation hiccup must not lose the payment
    console.warn('[solana] confirmTransaction failed, continuing with signature:', err)
  }

  return signature
}

/** True when the wallet error means the user declined, rather than a wallet failure. */
export function isUserRejection(err) {
  if (!err) return false
  if (err.code === 4001) return true
  return /reject|declin|denied|cancell?ed|dismiss/i.test(err.message || '')
}

export function getTreasuryPubkey() {
  return globalThis.env?.PUBLIC_SOLANA_TREASURY_PUBKEY ?? null
}
