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

Table `arena_ratings`:

| Column | Notes |
|--------|--------|
| `wallet_pubkey` | Primary key — Solana wallet |
| `username` | Last known display name at wallet connect |
| `rating` | Current arena rating (all-time) |
| `kills` / `deaths` / `wins` | Lifetime paid-BR stats only |
| `daily_day` | Current hourly period key (`YYYY-MM-DDTHH` UTC) for the rotating board |
| `daily_rating` | This hour’s rating (starts at 1000 each UTC hour; same kill/win/death deltas) |
| `daily_kills` / `daily_deaths` / `daily_wins` | This hour’s paid-BR stats only |
| `updated_at` | Last mutation time |

Identity for ratings is the **wallet**, not the session user UUID. `users.wallet_pubkey` still links the current session for payments.

**Hourly board:** a parallel rating that uses the same deltas as all-time. When the UTC hour rolls, the next paid-BR event for a wallet **resets** that wallet to `daily_rating = 1000` and zero hourly K/D/W before applying the event (lazy wipe). Rows from prior hours are excluded from the hourly leaderboard. Resets at the **top of each UTC hour**.

Ratings use a **separate DB connection** from the world ([`ratingsDb.js`](../src/server/ratingsDb.js)):

| Environment | Ratings store |
|-------------|----------------|
| Heroku (`DYNO` + `DATABASE_URL`) | Postgres schema `arena_ratings` (override with `RATINGS_DB_URI` / `RATINGS_DB_SCHEMA`) |
| Local / no Postgres URL | Same as world DB (SQLite) |

The world DB stays on SQLite by default so `ASSETS=local` never loads a foreign Postgres world with missing hashed assets. Only the ratings table lives in Heroku Postgres, so rankings survive dyno restarts.

## Hooks ([`ServerNetwork.js`](../src/core/systems/ServerNetwork.js))

| Hook | Action |
|------|--------|
| `onSetSolanaWallet` | Upsert wallet row + sync username |
| `recordKill` | +kill rating if `phase === 'battle'` and both players are in `br.queued` |
| `handleBattleRoyaleElimination` | +death rating for eliminated queued wallet |
| `endBattleRoyale` | +win rating for winner wallet (before queue clear) |

DB writes are async with `.catch` so failures never block combat or payouts.

## API & UI

- `GET /api/arena/leaderboard?limit=25&wallet=<optional>&period=all|daily` → `{ period, resetsAt, players, you }`
  - `period=all` (default): all-time `rating` + lifetime K/D/W
  - `period=daily`: current UTC hour’s `daily_rating` (starts at 1000 each hour, same deltas) + hourly K/D/W; `resetsAt` is the next UTC hour
- Client: **All Time** / **Hourly** tabs on the title-screen rankings and the in-game Rankings popup
  ([`ArenaRankings.js`](../src/client/components/ArenaRankings.js) / [`TitleScreen.js`](../src/client/components/TitleScreen.js) / [`PlayerQueueList.js`](../src/client/components/PlayerQueueList.js))
- Leaderboard fetch uses `PUBLIC_API_URL` correctly when it already ends in `/api` (e.g. `https://host/api/arena/leaderboard`)
- Loading overlay uses the same gladiator title background (`/assets/gladiatorbackground.webp`)
- Proximo title clip stops when the arena becomes ready
- Battle Royale victory: server broadcasts `brVictory` to everyone when a match ends (`pending` → `complete`/`failed`). Client shows a shared victory sheet with winner name, abbreviated wallet, payout amount, a progress bar/spinner while the Solana payout is pending, then the tx hash + Solscan link when confirmed ([`BattleRoyaleVictory.js`](../src/client/components/BattleRoyaleVictory.js)). The old winner-only chat “You won X SOL!” message is removed.
- Final 10s before a battle starts (queue phase, ≥2 queued): full-screen center countdown in [`MatchRound.js`](../src/client/components/MatchRound.js) with `timerclap.mp3` each second, last 5s of `proximospeech.mp3` at full volume when the countdown hits 10, and `horns.mp3` once when it hits 6. Skipped if the queue would roll over (<2 queued).
- Android MWA entry payments ([`solanaWallet.js`](../src/client/extras/solanaWallet.js) / [`PlayerQueueList.js`](../src/client/components/PlayerQueueList.js)): Local Network Access when needed, then always an “Open Wallet” tap so association starts from a trusted gesture. Entry blockhash is prefetched on Join (and during Open Wallet) with `processed` commitment so desktop + mobile wallet approval UIs are not blocked on a slow RPC; client confirmation is non-blocking. Failed sessions with a stale `auth_token` clear the token and retry once. No Phantom/Solflare in-app-browser deep-link fallback — Android Chrome + MWA only.

## Heroku / database

| Config | Behavior |
|--------|----------|
| World `DB_URI=local` (default) | SQLite world DB — arena assets stay correct with `ASSETS=local` |
| Ratings (automatic on Heroku) | Uses `DATABASE_URL` Postgres in schema `arena_ratings` only |
| `RATINGS_DB_URI` | Optional explicit ratings Postgres URL |
| `RATINGS_DB_SCHEMA` | Optional schema name (default `arena_ratings`) |

**Do not** point the world `DB_URI` at Heroku `DATABASE_URL` unless you intend the whole world to live in that Postgres. That once loaded stale world rows with hashed sky/terrain assets missing from the dyno and blacked out the arena.

Attach the Heroku Postgres addon (`DATABASE_URL`). No extra config is required for ratings persistence — boot logs should show: `arena ratings using Postgres schema "arena_ratings"`.

## Code map

| File | Role |
|------|------|
| [`src/core/extras/arenaRating.js`](../src/core/extras/arenaRating.js) | Delta constants |
| [`src/core/extras/arenaRatingService.js`](../src/core/extras/arenaRatingService.js) | Knex helpers |
| [`src/server/db.js`](../src/server/db.js) | World DB migration + DB_URI selection |
| [`src/server/ratingsDb.js`](../src/server/ratingsDb.js) | Separate ratings DB (Heroku Postgres / local fallback) |
| [`src/server/index.js`](../src/server/index.js) | Leaderboard HTTP route |
