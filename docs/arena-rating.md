# Arena Rating

Persistent arena rating for **paid battle royale** matches. Ratings are stored on the `users` table in PostgreSQL (or SQLite locally) via Knex migrations.

---

## Rating rules

Rating only changes during an active **paid** battle royale (`phase === 'battle'` and the player paid the entry fee for that cycle).

| Event | Rating change | Stat updated |
|-------|---------------|--------------|
| Kill another paid fighter | **+15** | `arena_kills` |
| Die / eliminated (combat or disconnect) | **−10** | `arena_deaths` |
| Win the battle royale | **+50** | `arena_wins` |

- Starting rating: **1000**
- Minimum rating: **0**
- Free-play arena kills (queue period, non-queued players) do **not** affect rating.

When a paid battle starts, every queued player gets `arena_matches` incremented once for that cycle.

---

## Database

Migration adds columns to `users`:

| Column | Type | Default |
|--------|------|---------|
| `arena_rating` | integer | 1000 |
| `arena_wins` | integer | 0 |
| `arena_kills` | integer | 0 |
| `arena_deaths` | integer | 0 |
| `arena_matches` | integer | 0 |

### Connection

| Environment | Config |
|-------------|--------|
| Local dev | `DB_URI=local` → SQLite in `{WORLD}/db.sqlite` |
| Remote Postgres | `DB_URI=postgres://...` |
| Heroku | Add **Heroku Postgres** — app reads `DATABASE_URL` automatically (with SSL) |

Optional: set `DB_SCHEMA` for a non-`public` Postgres schema.

---

## Server hooks

| File | Role |
|------|------|
| `src/core/extras/arenaRating.js` | Constants |
| `src/core/extras/arenaRatingService.js` | DB read/write |
| `src/core/systems/ServerNetwork.js` | Kill/death/win hooks, broadcasts |

Integration points:

- `recordKill` → `applyArenaKillRating` when both players are paid BR fighters
- `handleBattleRoyaleElimination` → `applyArenaDeathRating` (once per player per match)
- `endBattleRoyale` → `applyArenaWinRating` for the winner
- `beginBattleRoyale` → `recordPaidBattleRoyaleMatches`

---

## Client / API

| Surface | Payload |
|---------|---------|
| Snapshot | `arenaRating`, `arenaLeaderboard` |
| Packet `arenaRating` | Player’s updated stats after a change |
| Packet `arenaLeaderboard` | Top 25 ranked players |
| `GET /api/arena/leaderboard` | Same leaderboard JSON for external use |

UI: `ArenaRankings.js` (top-left panel) shows your rating and the live top-25 list.

---

## Heroku deploy notes

1. Add Heroku Postgres add-on to the app.
2. Deploy with the included `Procfile` (`web: npm start`).
3. Ensure required env vars from `.env.example` are set in Heroku config.
4. No need to set `DB_URI` manually if `DATABASE_URL` is present from the add-on.
