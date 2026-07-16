# Arena Rating & Ranking

Wallet-keyed persistent ratings for **paid arena events** (Battle Royale and bracket Tournament). Free-play arena combat does not affect rating.

## Paid event cycle

The arena alternates modes each queue cycle (`ServerNetwork` `battleRoyale.mode`):

`Battle Royale → Tournament → Battle Royale → …`

- Shared queue: same 5‑minute timer, `0.01 SOL` entry (`BR_ENTRY_FEE_LAMPORTS`), 5% house cut, winner pot payout.
- Mode flips after a completed event **and** when a queue timer rolls over without enough fighters (&lt; 2), so the next queue always advertises the other option.
- `matchState.mode` is the **upcoming** event during queue (and names the current event while it is live).
- Join packet name stays `joinBattleRoyale` (less churn); UI copy is mode-aware.

### Tournament rules

- Sequential **1v1** matches in the arena (one pair at a time).
- Bracket built from connected queued players; odd rounds give **one random bye** (no power-of-2 padding).
- Waiting bracket players stay as Saracen in the stands; only the current pair fight as Crusader.
- Disconnect / death of a live fighter eliminates them; opponent advances. If a fighter is gone when their match starts, the opponent auto-wins.
- Champion gets the same pot payout + win rating as a BR winner (`brVictory` UI). Match winners get kill rating; losers get death rating.

Helpers: [`tournamentBracket.js`](../src/core/extras/tournamentBracket.js). Overlay: [`TournamentBracket.js`](../src/client/components/TournamentBracket.js).

## Rating deltas

| Event | Delta |
|-------|--------|
| Starting rating | 1000 |
| Kill (paid event) | +15 |
| Win (paid event champion) | +50 |
| Death / elimination (paid event) | −10 (floor at 0) |

Disconnect while still alive in a paid fight counts as a death.

## Storage

Table `arena_ratings`:

| Column | Notes |
|--------|--------|
| `wallet_pubkey` | Primary key — Solana wallet |
| `username` | Last known display name at wallet connect |
| `rating` | Current arena rating (all-time) |
| `kills` / `deaths` / `wins` | Lifetime paid-event stats only |
| `daily_day` | Current hourly period key (`YYYY-MM-DDTHH` UTC) for the rotating board |
| `daily_rating` | This hour’s rating (starts at 1000 each UTC hour; same kill/win/death deltas) |
| `daily_kills` / `daily_deaths` / `daily_wins` | This hour’s paid-event stats only |
| `updated_at` | Last mutation time |

Table `arena_last_hour` (frozen previous hour):

| Column | Notes |
|--------|--------|
| `wallet_pubkey` | Primary key |
| `username` / `rating` / `kills` / `deaths` / `wins` | Copy of that hour’s hourly stats at wipe time |
| `period` | Archived hour key (`YYYY-MM-DDTHH` UTC) |

Identity for ratings is the **wallet**, not the session user UUID. `users.wallet_pubkey` still links the current session for payments.

**Hourly board:** a parallel rating that uses the same deltas as all-time. When the UTC hour rolls, the next paid-event rating write for a wallet **resets** that wallet to `daily_rating = 1000` and zero hourly K/D/W before applying the event (lazy wipe). Rows from prior hours are excluded from the hourly leaderboard. Resets at the **top of each UTC hour**.

**Last Hour board:** before that wipe (and whenever the hourly list is read after a rollover), the previous hour’s top board is copied into `arena_last_hour` and replaced each hour. The UI **Last Hour** tab shows that frozen list.

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
| `recordKill` | +kill rating if `phase` is `battle` or `tournament` and both players are in `br.queued` |
| `handleBattleRoyaleElimination` / tournament branch | +death rating for eliminated queued wallet |
| `endBattleRoyale` / `endTournament` | +win rating for champion wallet (before queue clear); then flip `mode` |

DB writes are async with `.catch` so failures never block combat or payouts.

## API & UI

- `GET /api/arena/leaderboard?limit=25&wallet=<optional>&period=all|daily|last` → `{ period, resetsAt, players, you }`
  - `period=all` (default): all-time `rating` + lifetime K/D/W
  - `period=daily`: current UTC hour’s `daily_rating` (starts at 1000 each hour, same deltas) + hourly K/D/W; `resetsAt` is the next UTC hour
  - `period=last`: frozen previous UTC hour board from `arena_last_hour`
- Client: **All Time** / **Hourly** / **Last Hour** tabs on the title-screen rankings and the in-game Rankings popup
  ([`ArenaRankings.js`](../src/client/components/ArenaRankings.js) / [`TitleScreen.js`](../src/client/components/TitleScreen.js) / [`PlayerQueueList.js`](../src/client/components/PlayerQueueList.js))
- Leaderboard fetch uses `PUBLIC_API_URL` correctly when it already ends in `/api` (e.g. `https://host/api/arena/leaderboard`)
- Loading overlay uses the same gladiator title background (`/assets/gladiatorbackground.webp`)
- Proximo title clip stops when the arena becomes ready
- Event victory: server broadcasts `brVictory` to everyone when a BR or tournament ends (`pending` → `complete`/`failed`). Client shows a shared victory sheet with winner name, abbreviated wallet, payout amount, a progress bar/spinner while the Solana payout is pending, then the tx hash + Solscan link when confirmed ([`BattleRoyaleVictory.js`](../src/client/components/BattleRoyaleVictory.js)).
- Tournament: server broadcasts `tournamentBracket` (rounds, highlight, status `preview`/`result`/`final`). Client overlay highlights the current match, marks losers, and hides during the live duel ([`TournamentBracket.js`](../src/client/components/TournamentBracket.js)).
- Final 10s before a paid event starts (queue phase, ≥2 queued): full-screen center countdown in [`MatchRound.js`](../src/client/components/MatchRound.js) with mode-aware label (“Battle begins” / “Tournament begins”), `timerclap.mp3` each second, last 5s of `proximospeech.mp3` at full volume when the countdown hits 10, and `horns.mp3` once when it hits 6. Skipped if the queue would roll over (<2 queued).
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
| [`src/core/extras/tournamentBracket.js`](../src/core/extras/tournamentBracket.js) | Bracket pairings, byes, advance |
| [`src/client/components/TournamentBracket.js`](../src/client/components/TournamentBracket.js) | Bracket overlay UI |
| [`src/server/db.js`](../src/server/db.js) | World DB migration + DB_URI selection |
| [`src/server/ratingsDb.js`](../src/server/ratingsDb.js) | Separate ratings DB (Heroku Postgres / local fallback) |
| [`src/server/index.js`](../src/server/index.js) | Leaderboard HTTP route |
