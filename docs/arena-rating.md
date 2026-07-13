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

Table `arena_ratings` (SQLite locally, Postgres on Heroku):

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
- Client: **Arena Rankings** toggle (bottom-left) in [`ArenaRankings.js`](../src/client/components/ArenaRankings.js)

## Heroku Postgres

1. Attach the **Heroku Postgres** add-on (sets `DATABASE_URL`).
2. **Unset `DB_URI`** on the dyno (or set it to the postgres URI). If `DB_URI=local`, the app uses SQLite and ignores `DATABASE_URL`.
3. For world meshes/textures on Heroku, use `ASSETS=s3` — local `world/assets` is ephemeral on dynos.
4. Migrations (including `arena_ratings`) run automatically on boot (`Procfile`: `web: npm start`).

Local default remains SQLite via `DB_URI=local`.

## Code map

| File | Role |
|------|------|
| [`src/core/extras/arenaRating.js`](../src/core/extras/arenaRating.js) | Delta constants |
| [`src/core/extras/arenaRatingService.js`](../src/core/extras/arenaRatingService.js) | Knex helpers |
| [`src/server/db.js`](../src/server/db.js) | Migration + `DATABASE_URL` resolve |
| [`src/server/index.js`](../src/server/index.js) | Leaderboard HTTP route |
