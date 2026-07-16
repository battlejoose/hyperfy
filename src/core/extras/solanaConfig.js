/** Battle royale queue entry fee. */
export const BR_ENTRY_FEE_LAMPORTS = 10_000_000 // 0.01 SOL
/** Fixed pari-mutuel bet stake (same as entry by default). */
export const BET_STAKE_LAMPORTS = 10_000_000 // 0.01 SOL
/** Percent of the pot kept by the game server; the rest goes to the winner. */
export const BR_HOUSE_FEE_PERCENT = 5
/** Length of the queue/free-play period between battle royales. */
export const BR_QUEUE_DURATION_SECONDS = 5 * 60
/** Final window of the queue when joins lock and pari-mutuel betting is open. */
export const BETTING_WINDOW_SECONDS = 60

export const LAMPORTS_PER_SOL = 1_000_000_000
