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
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js'
import { BR_ENTRY_FEE_LAMPORTS } from '../../core/extras/solanaConfig.js'

const SOLANA_CHAIN = 'solana:mainnet'
const LAST_WALLET_KEY = 'hyperfy:lastSolanaWallet'
const MWA_AUTH_TOKEN_KEY = 'hyperfy:mwaAuthToken'

// Solana Mobile / Chrome Android: LNA prompt + MWA association can hang if we
// wait forever. Keep these short so Join Battle unlocks for a retry.
const LNA_PERMISSION_TIMEOUT_MS = 25000
const MWA_SESSION_TIMEOUT_MS = 45000

const MWA_APP_IDENTITY = {
  name: 'Hyperfy Arena',
  // icon must be a relative URI resolved against uri (absolute URLs are rejected)
  uri: typeof window !== 'undefined' ? window.location.origin : undefined,
  icon: '/particle.png',
}

// After the tab/app is backgrounded, Chrome may drop the user-activation needed
// to launch the wallet Intent. Force a fresh "Open Wallet" tap in that case.
let pageWasBackgrounded = false
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pageWasBackgrounded = true
  })
  window.addEventListener('pagehide', () => {
    pageWasBackgrounded = true
  })
  window.addEventListener('pageshow', event => {
    if (event.persisted) pageWasBackgrounded = true
  })
}

function consumeNeedsFreshWalletGesture() {
  const needs = pageWasBackgrounded
  pageWasBackgrounded = false
  return needs
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function clearMwaAuthToken() {
  try {
    localStorage.removeItem(MWA_AUTH_TOKEN_KEY)
  } catch {}
}

function getRpcUrl() {
  return globalThis.env?.PUBLIC_SOLANA_RPC_URL || clusterApiUrl('mainnet-beta')
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
  return getWallets()
    .get()
    .filter(isSolanaStandardWallet)
    .map(wallet => ({ name: wallet.name, icon: wallet.icon, wallet }))
}

/** Subscribe to wallets being registered/unregistered. Returns unsubscribe. */
export function onSolanaWalletsChange(callback) {
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

/** Wallets injected directly into the page (browser extension or wallet in-app browser). */
export function getInjectedSolanaWallets() {
  return getSolanaWallets().filter(w => !w.name?.includes('Mobile Wallet Adapter'))
}

export function isMobileUserAgent() {
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent)
}

/** Mobile Wallet Adapter is Android-only and needs a secure context. */
export function isMwaSupported() {
  return typeof window !== 'undefined' && window.isSecureContext && /android/i.test(navigator.userAgent)
}

/**
 * Chrome/Android now gates MWA's localhost WebSocket behind Local Network /
 * "Apps on your device" permission. If we open the wallet before that is
 * granted, the system prompt and wallet race and the session fails.
 *
 * Flow matches @solana-mobile/wallet-standard-mobile:
 * 1) query permission  2) if prompt, show Continue → fetch localhost to
 * trigger the browser prompt while we're still foreground  3) wait for
 * grant  4) require a fresh click before returning so `transact()` can
 * launch the wallet from a trusted gesture.
 */
async function queryLoopbackPermission() {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null
  for (const name of ['loopback-network', 'local-network-access', 'local-network']) {
    try {
      return await navigator.permissions.query({ name })
    } catch {
      // name not recognized in this browser
    }
  }
  return null
}

function showMwaPermissionSheet({ title, body, actionLabel, runOnAction }) {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div')
    overlay.setAttribute('data-mwa-lna', '1')
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:10050',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:1.25rem',
      'box-sizing:border-box',
      'background:rgba(4,6,10,0.72)',
      'backdrop-filter:blur(2px)',
      'font-family:ui-monospace,SF Mono,Menlo,Consolas,monospace',
    ].join(';')

    const card = document.createElement('div')
    card.style.cssText = [
      'width:min(22rem,100%)',
      'padding:1.25rem 1.3rem 1.15rem',
      'border-radius:0.35rem',
      'border:1px solid rgba(212,175,95,0.35)',
      'background:linear-gradient(180deg,rgba(18,20,26,0.98),rgba(10,12,16,0.99))',
      'color:rgba(240,240,240,0.95)',
      'box-shadow:0 18px 48px rgba(0,0,0,0.55)',
    ].join(';')

    const kicker = document.createElement('div')
    kicker.textContent = 'WALLET ACCESS'
    kicker.style.cssText =
      'font-size:0.65rem;letter-spacing:0.16em;color:rgba(212,175,95,0.9);margin-bottom:0.4rem'

    const heading = document.createElement('div')
    heading.textContent = title
    heading.style.cssText =
      'font-size:1.15rem;font-weight:700;letter-spacing:0.03em;color:#f5e6c8;margin-bottom:0.55rem'

    const text = document.createElement('div')
    text.textContent = body
    text.style.cssText =
      'font-size:0.78rem;line-height:1.45;color:rgba(255,255,255,0.7);margin-bottom:1.1rem'

    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:0.5rem'

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.style.cssText = [
      'flex:0 0 auto',
      'padding:0.7rem 0.9rem',
      'border-radius:0.25rem',
      'border:1px solid rgba(255,255,255,0.18)',
      'background:rgba(255,255,255,0.04)',
      'color:rgba(255,255,255,0.8)',
      'font:inherit',
      'font-size:0.78rem',
      'cursor:pointer',
    ].join(';')

    const actionBtn = document.createElement('button')
    actionBtn.type = 'button'
    actionBtn.textContent = actionLabel
    actionBtn.style.cssText = [
      'flex:1 1 auto',
      'padding:0.7rem 0.9rem',
      'border-radius:0.25rem',
      'border:1px solid rgba(251,191,36,0.45)',
      'background:rgba(251,191,36,0.14)',
      'color:#fbbf24',
      'font:inherit',
      'font-size:0.78rem',
      'font-weight:700',
      'letter-spacing:0.04em',
      'cursor:pointer',
    ].join(';')

    const cleanup = () => overlay.remove()

    cancelBtn.onclick = () => {
      cleanup()
      reject(new Error('Wallet connection cancelled'))
    }
    actionBtn.onclick = async () => {
      actionBtn.disabled = true
      cancelBtn.disabled = true
      try {
        // Keep runOnAction inside this click so Chrome still treats wallet
        // launch as a trusted user gesture.
        const result = runOnAction ? await runOnAction() : undefined
        cleanup()
        resolve(result)
      } catch (err) {
        cleanup()
        reject(err)
      }
    }

    actions.append(cancelBtn, actionBtn)
    card.append(kicker, heading, text, actions)
    overlay.append(card)
    document.body.append(overlay)
  })
}

/**
 * Ensure Local Network / Apps-on-device permission is granted, then launch the
 * wallet from a trusted "Open Wallet" click.
 *
 * Per Solana Mobile web guidance: MWA association must start from a user
 * gesture, and LNA must be granted before the localhost WebSocket opens —
 * otherwise Chrome races the system prompt with the wallet Intent and the
 * session silently fails (especially after the tab was backgrounded).
 *
 * We always require the Open Wallet tap (not just after LNA / resume) so
 * every payment starts from a fresh trusted gesture — silent reuse of the
 * Join Battle click is what made second joins flaky on Chrome Android.
 */
async function ensureLoopbackNetworkAccess(runAfterGranted) {
  if (!runAfterGranted) return

  // Consume background flag even when we always show Open Wallet — keeps
  // future callers honest if the flow changes.
  consumeNeedsFreshWalletGesture()

  const status = await queryLoopbackPermission()

  if (status?.state === 'denied') {
    throw new Error(
      'Local network / Apps on your device access is blocked. Allow it in the browser site settings, then try again.'
    )
  }

  if (status?.state === 'prompt') {
    await showMwaPermissionSheet({
      title: 'Allow wallet connections',
      body: 'Your browser will ask to allow apps on your device. Tap Allow so we can open your Solana wallet.',
      actionLabel: 'Continue',
      runOnAction: async () => {
        const granted = new Promise((resolve, reject) => {
          const finish = () => {
            status.onchange = null
            clearTimeout(timer)
            if (status.state === 'granted') resolve()
            else {
              reject(
                new Error(
                  status.state === 'denied'
                    ? 'Allow local network access to connect your wallet.'
                    : 'Local network permission timed out. Tap Join Battle and Allow when prompted.'
                )
              )
            }
          }
          status.onchange = finish
          const timer = setTimeout(finish, LNA_PERMISSION_TIMEOUT_MS)
        })
        try {
          await fetch('http://localhost/', { mode: 'no-cors', cache: 'no-store' })
        } catch {
          // expected — we only need the permission side-effect
        }
        await granted
      },
    })
  }

  return showMwaPermissionSheet({
    title: 'Open your wallet',
    body: 'Authorize and approve the battle entry payment in your Solana wallet.',
    actionLabel: 'Open Wallet',
    runOnAction: runAfterGranted,
  })
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
  let lastName = null
  try {
    lastName = localStorage.getItem(LAST_WALLET_KEY)
  } catch {}
  if (!lastName) return null
  // stale entry from the retired wallet-standard MWA integration
  if (lastName.includes('Mobile Wallet Adapter')) {
    try {
      localStorage.removeItem(LAST_WALLET_KEY)
    } catch {}
    return null
  }
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

/**
 * Pay the battle royale entry fee through the Mobile Wallet Adapter protocol
 * (Android). Authorize and sign-and-send both run inside ONE transact session.
 *
 * Speed: kick off getLatestBlockhash in parallel with authorize so the wallet
 * is not sitting idle on a slow RPC before signAndSend appears.
 * Reliability: always launch from "Open Wallet"; on failure with a cached
 * auth_token, clear it and retry once with a fresh authorize.
 * Returns { signature, walletPubkey } (both base58).
 */
export async function payEntryFeeMwa(treasuryPubkey, lamports = BR_ENTRY_FEE_LAMPORTS) {
  const connection = new Connection(getRpcUrl(), 'confirmed')
  const toPubkey = new PublicKey(treasuryPubkey)

  // Warm the RPC while the user taps through Open Wallet / LNA sheets.
  connection.getLatestBlockhashAndContext('processed').catch(() => {})

  const runSession = async ({ useAuthToken }) => {
    let cachedAuthToken = null
    if (useAuthToken) {
      try {
        cachedAuthToken = localStorage.getItem(MWA_AUTH_TOKEN_KEY)
      } catch {}
    } else {
      clearMwaAuthToken()
    }

    return withTimeout(
      transact(async wallet => {
        // Fetch blockhash in parallel with authorize — waiting until after
        // authorize is what made the approval screen take so long to appear.
        const startedAt = Date.now()
        let blockhashPromise = connection.getLatestBlockhashAndContext('processed')

        let auth
        try {
          auth = await wallet.authorize({
            chain: SOLANA_CHAIN,
            identity: MWA_APP_IDENTITY,
            auth_token: cachedAuthToken || undefined,
          })
        } catch (err) {
          if (!cachedAuthToken) throw err
          clearMwaAuthToken()
          cachedAuthToken = null
          auth = await wallet.authorize({
            chain: SOLANA_CHAIN,
            identity: MWA_APP_IDENTITY,
          })
        }
        try {
          localStorage.setItem(MWA_AUTH_TOKEN_KEY, auth.auth_token)
        } catch {}

        const addressBytes = Uint8Array.from(atob(auth.accounts[0].address), c => c.charCodeAt(0))
        const fromPubkey = new PublicKey(addressBytes)

        let blockhashResult
        try {
          blockhashResult = await blockhashPromise
        } catch {
          blockhashResult = await connection.getLatestBlockhashAndContext('processed')
        }
        // If authorize took a long time, refresh so the wallet doesn't reject
        // a near-expired blockhash.
        if (Date.now() - startedAt > 8000) {
          blockhashResult = await connection.getLatestBlockhashAndContext('processed')
        }

        const {
          context: { slot: minContextSlot },
          value: { blockhash, lastValidBlockHeight },
        } = blockhashResult

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

        const signatures = await wallet.signAndSendTransactions({
          transactions: [transaction],
          minContextSlot,
        })

        return {
          signature: signatures[0],
          walletPubkey: fromPubkey.toBase58(),
          blockhash,
          lastValidBlockHeight,
        }
      }),
      MWA_SESSION_TIMEOUT_MS,
      'Wallet connection timed out. Tap Join Battle to try again.'
    )
  }

  let result
  try {
    result = await ensureLoopbackNetworkAccess(() => runSession({ useAuthToken: true }))
  } catch (err) {
    if (isUserRejection(err)) throw err
    // Silent reauth with a stale token often opens the wallet without a tx on
    // the second join — clear and retry once with a fresh authorize.
    console.warn('[solana] MWA session failed, retrying without cached auth token:', err)
    clearMwaAuthToken()
    result = await ensureLoopbackNetworkAccess(() => runSession({ useAuthToken: false }))
  }

  // Server verifies on-chain — don't block the UI on client confirmation.
  connection
    .confirmTransaction(
      {
        signature: result.signature,
        blockhash: result.blockhash,
        lastValidBlockHeight: result.lastValidBlockHeight,
      },
      'confirmed'
    )
    .catch(err => console.warn('[solana] confirmTransaction failed, continuing with signature:', err))

  return { signature: result.signature, walletPubkey: result.walletPubkey }
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
