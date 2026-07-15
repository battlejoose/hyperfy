import Knex from 'knex'

import { ensureArenaRatingsTable } from './db.js'

let ratingsDb = null
let ratingsDbPromise = null

function isPostgresUri(uri) {
  return typeof uri === 'string' && (uri.startsWith('postgres://') || uri.startsWith('postgresql://'))
}

/**
 * Resolve where arena ratings should live.
 *
 * World data stays on the main DB (SQLite by default) so ASSETS=local never
 * loads a foreign Postgres world with missing hashed sky/terrain files.
 *
 * Ratings need to survive Heroku dyno restarts, so on Heroku we use
 * DATABASE_URL Postgres in a dedicated schema that only holds arena_ratings.
 *
 * Priority:
 * 1. RATINGS_DB_URI (explicit override)
 * 2. DATABASE_URL when running on a Heroku dyno
 * 3. Fall back to the world DB (local SQLite / explicit DB_URI)
 */
function resolveRatingsPostgresUri() {
  if (isPostgresUri(process.env.RATINGS_DB_URI)) return process.env.RATINGS_DB_URI
  if (process.env.DYNO && isPostgresUri(process.env.DATABASE_URL)) return process.env.DATABASE_URL
  return null
}

export async function getRatingsDB(fallbackDb) {
  if (ratingsDb) return ratingsDb
  if (ratingsDbPromise) return ratingsDbPromise

  ratingsDbPromise = (async () => {
    const uri = resolveRatingsPostgresUri()
    if (!uri) {
      if (process.env.DYNO) {
        console.warn(
          '[db] arena ratings falling back to world SQLite on Heroku — ratings will not persist across restarts. Attach Heroku Postgres (DATABASE_URL) or set RATINGS_DB_URI.'
        )
      } else {
        console.log('[db] arena ratings using world database')
      }
      await ensureArenaRatingsTable(fallbackDb)
      ratingsDb = fallbackDb
      return ratingsDb
    }

    // Dedicated schema so we never read/write world entities/settings in
    // Heroku Postgres (that is what blacked out the arena before).
    const schema = process.env.RATINGS_DB_SCHEMA || 'arena_ratings'
    const useSsl = !!process.env.DYNO || process.env.RATINGS_DB_SSL === '1'
    const db = Knex({
      client: 'pg',
      connection: useSsl
        ? { connectionString: uri, ssl: { rejectUnauthorized: false } }
        : uri,
      pool: { min: 0, max: 5 },
      searchPath: [schema],
      useNullAsDefault: true,
    })

    if (schema !== 'public') {
      await db.raw(`CREATE SCHEMA IF NOT EXISTS ??`, [schema])
    }
    await ensureArenaRatingsTable(db)
    console.log(`[db] arena ratings using Postgres schema "${schema}"`)
    ratingsDb = db
    return ratingsDb
  })().catch(err => {
    ratingsDbPromise = null
    throw err
  })

  return ratingsDbPromise
}
