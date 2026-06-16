import { Keypair } from '@solana/web3.js'
import { generateMnemonic, mnemonicToSeedSync } from 'bip39'
import { derivePath } from 'ed25519-hd-key'

const derivationPath = "m/44'/501'/0'/0'"
const mnemonic = generateMnemonic(128)
const seed = mnemonicToSeedSync(mnemonic)
const { key } = derivePath(derivationPath, seed.toString('hex'))
const keypair = Keypair.fromSeed(key)

console.log('=== Solana Treasury Wallet ===')
console.log('')
console.log('SOLANA_TREASURY_SEED_PHRASE=')
console.log(mnemonic)
console.log('')
console.log('Treasury address (fund on mainnet):')
console.log(keypair.publicKey.toBase58())
console.log('')
console.log('Derivation path:', derivationPath)
