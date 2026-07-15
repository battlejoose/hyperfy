# Arena Rating & Ranking

Wallet-keyed persistent ratings for **paid Battle Royale** only. Free-play arena combat does not affect rating.

## Rating deltas

| Event | Delta |
|-------|--------|
| Starting rating | 1000 |
| Kill (paid BR) | +15 |
| Win (paid BR) | +50 |
| Death / elimination (paid BR) | −10 (floor at 0) |

Disconnect while still alive in a paid battle counts as a death.

## Storage

Table `arena_ratings` (SQLite by default; Postgres only when `DB_URI` is an explicit postgres URL):

| Column | Notes |
|--------|--------|
| `wallet_pubkey` | Primary key — Solana wallet |
| `username` | Last known display name at wallet connect |
| `rating` | Current arena rating |
| `kills` / `deaths` / `wins` | Lifetime paid-BR stats only |
| `updated_at` | Last mutation time |

Identity for ratings is the **wallet**, not the session user UUID. `users.wallet_pubkey` still links the current session for payments.

## Hooks ([`ServerNetwork.js`](../src/core/systems/ServerNetwork.js))

| Hook | Action |
|------|--------|
| `onSetSolanaWallet` | Upsert wallet row + sync username |
| `recordKill` | +kill rating if `phase === 'battle'` and both players are in `br.queued` |
| `handleBattleRoyaleElimination` | +death rating for eliminated queued wallet |
| `endBattleRoyale` | +win rating for winner wallet (before queue clear) |

DB writes are async with `.catch` so failures never block combat or payouts.

## API & UI

- `GET /api/arena/leaderboard?limit=25&wallet=<optional>` → `{ players, you }`
- Client: full scrollable rankings on the title screen; in-game queue UI has a Rankings button that toggles a closable popup (same pattern as How to Fight)
  ([`ArenaRankings.js`](../src/client/components/ArenaRankings.js) / [`TitleScreen.js`](../src/client/components/TitleScreen.js) / [`PlayerQueueList.js`](../src/client/components/PlayerQueueList.js))
- Leaderboard fetch uses `PUBLIC_API_URL` correctly when it already ends in `/api` (e.g. `https://host/api/arena/leaderboard`)
- Loading overlay uses the same gladiator title background (`/assets/gladiatorbackground.webp`)
- Proximo title clip stops when the arena becomes ready
- Battle Royale victory: server broadcasts `brVictory` to everyone when a match ends (`pending` → `complete`/`failed`). Client shows a shared victory sheet with winner name, abbreviated wallet, payout amount, a progress bar/spinner while the Solana payout is pending, then the tx hash + Solscan link when confirmed ([`BattleRoyaleVictory.js`](../src/client/components/BattleRoyaleVictory.js)). The old winner-only chat “You won X SOL!” message is removed.
- Android MWA entry payments call `ensureLoopbackNetworkAccess()` first ([`solanaWallet.js`](../src/client/extras/solanaWallet.js)): if Chrome still needs Local Network / “Apps on your device” permission, one sheet handles Continue → browser Allow → **Select wallet**. The second tap is required — after the system permission dialog Chrome has consumed the user gesture, so auto-starting `transact()` opens the wallet without an MWA connection.

## Heroku / database

Ratings work on SQLite or Postgres. **Do not auto-bind Heroku `DATABASE_URL`.**

The first rating deploy did that and silently loaded a different Postgres world DB, which referenced hashed sky/terrain assets that are not on the dyno — that is what blacked out the arena.

| Config | Behavior |
|--------|----------|
| `DB_URI=local` (or non-postgres) | SQLite in `{WORLD}/db.sqlite` — **same as before ratings** |
| `DB_URI=postgres://…` | Postgres (set this explicitly to your Heroku `DATABASE_URL` value if you want Postgres) |

On Heroku dynos, Postgres connections enable SSL automatically when `DYNO` is set. Migrations (including `arena_ratings`) run on boot.

## Code map

| File | Role |
|------|------|
| [`src/core/extras/arenaRating.js`](../src/core/extras/arenaRating.js) | Delta constants |
| [`src/core/extras/arenaRatingService.js`](../src/core/extras/arenaRatingService.js) | Knex helpers |
| [`src/server/db.js`](../src/server/db.js) | Migration + DB_URI selection (no DATABASE_URL auto-switch) |
| [`src/server/index.js`](../src/server/index.js) | Leaderboard HTTP route |
