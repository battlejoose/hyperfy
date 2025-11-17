# 🐘 Heroku Postgres Setup Guide

This guide will help you set up persistent storage for your Hyperfy world on Heroku using Postgres. By default, Hyperfy uses SQLite which gets wiped on every Heroku restart because Heroku's filesystem is ephemeral. Using Postgres ensures all your world data (3D objects, blueprints, entities, settings) persists across restarts.

## Why Postgres on Heroku?

- **Persistent Storage**: Heroku's filesystem is ephemeral - files are deleted on every restart
- **SQLite files get wiped**: The default SQLite database (`db.sqlite`) is stored on the filesystem and disappears on restart
- **Postgres is persistent**: Heroku Postgres stores data in a managed database that persists across restarts
- **Automatic backups**: Heroku Postgres includes automatic daily backups

## Setup Steps

### 1. Add Heroku Postgres Addon

In your Heroku dashboard or via CLI:

```bash
# Via Heroku CLI
heroku addons:create heroku-postgresql:mini

# Or use a different plan (see pricing below)
heroku addons:create heroku-postgresql:hobby-dev  # Free tier
```

### 2. Verify DATABASE_URL is Set

Heroku automatically sets the `DATABASE_URL` environment variable when you add the Postgres addon. Verify it's set:

```bash
heroku config:get DATABASE_URL
```

You should see a connection string like:
```
postgres://user:password@host:port/database
```

### 3. Deploy Your Application

The code automatically detects `DATABASE_URL` and uses Postgres instead of SQLite. No code changes needed!

When your app starts, you should see in the logs:
```
[db] using Postgres database
```

Instead of:
```
[db] using SQLite database
```

## How It Works

Hyperfy's database system (`src/server/db.js`) automatically:

1. **Checks for Postgres**: Looks for `DATABASE_URL` (Heroku) or `DB_URI` environment variables
2. **Detects connection type**: If the connection string starts with `postgres://` or `postgresql://`, it uses Postgres
3. **Configures SSL**: Automatically enables SSL with proper settings for Heroku Postgres
4. **Runs migrations**: Automatically creates and updates database tables as needed
5. **Loads world data**: On startup, loads all blueprints, entities, and settings from the database

## What Gets Persisted

All world data is stored in Postgres:

- **Blueprints** (`blueprints` table) - App definitions and templates
- **Entities** (`entities` table) - All 3D objects placed in the world (position, rotation, scale, state)
- **Users** (`users` table) - Player accounts and permissions
- **Settings** (`config` table) - World settings (title, description, voice settings, etc.)
- **Spawn points** (`config` table) - Player spawn locations

## Heroku Postgres Plans

### Free Tier (Hobby Dev)
- **Cost**: Free
- **Database size**: 10,000 rows
- **Connections**: 20
- **Backups**: Manual only
- **Good for**: Development and testing

### Mini Plan
- **Cost**: $5/month
- **Database size**: 10 GB
- **Connections**: 25
- **Backups**: Automatic daily backups (7 days retention)
- **Good for**: Small production deployments

### Standard Plans
- **Cost**: $50+/month
- **Database size**: 64 GB+
- **Connections**: 120+
- **Backups**: Automatic daily backups with point-in-time recovery
- **Good for**: Production deployments with high traffic

## Troubleshooting

### Database Not Connecting

**Error**: `Connection timeout` or `SSL required`

**Solution**: The code automatically handles SSL for Heroku Postgres. If you see SSL errors, check:
1. Verify `DATABASE_URL` is set: `heroku config:get DATABASE_URL`
2. Check Heroku Postgres addon is active: `heroku addons`
3. Check server logs for `[db] using Postgres database` message

### Data Not Persisting

**Symptom**: Objects disappear after restart

**Solution**: 
1. Verify Postgres is being used (check logs for `[db] using Postgres database`)
2. Check if `DATABASE_URL` is set correctly
3. Verify migrations ran successfully (check logs for `[db] migration` messages)

### Migration Errors

**Error**: `relation "config" already exists` or similar

**Solution**: This usually means migrations already ran. The migration system is idempotent and should handle this automatically. If you see persistent errors:
1. Check database connection is working
2. Verify you have proper permissions on the database
3. Check server logs for specific migration errors

## Manual Database Access

You can access your Postgres database directly:

```bash
# Via Heroku CLI
heroku pg:psql

# Or connect with any Postgres client using DATABASE_URL
heroku config:get DATABASE_URL
```

## Environment Variables

The system checks for these environment variables (in order):

1. `DATABASE_URL` - Heroku's standard Postgres connection string (automatically set)
2. `DB_URI` - Alternative connection string (if not using Heroku)
3. Falls back to SQLite if neither is set

### Optional: Custom Schema

You can use a custom schema instead of `public`:

```bash
heroku config:set DB_SCHEMA=my_schema
```

## Migration from SQLite to Postgres

If you have existing data in SQLite and want to migrate:

1. **Export SQLite data** (if needed):
   ```bash
   # On your local machine
   sqlite3 world/db.sqlite .dump > backup.sql
   ```

2. **Add Heroku Postgres**:
   ```bash
   heroku addons:create heroku-postgresql:mini
   ```

3. **Deploy your app** - The migrations will run automatically

4. **Import data** (if you exported):
   - Connect to Heroku Postgres: `heroku pg:psql`
   - Manually import or use a migration script

**Note**: The migration system will automatically create all necessary tables. Existing SQLite data won't automatically transfer - you'll need to manually migrate if needed.

## Best Practices

1. **Use Mini plan or higher for production** - Free tier has row limits
2. **Monitor database size** - Check usage: `heroku pg:info`
3. **Set up backups** - Mini+ plans include automatic backups
4. **Monitor connections** - Check connection pool usage in logs
5. **Use connection pooling** - Already configured (min: 2, max: 10 connections)

## Additional Resources

- [Heroku Postgres Documentation](https://devcenter.heroku.com/articles/heroku-postgresql)
- [Heroku Postgres Plans](https://elements.heroku.com/addons/heroku-postgresql)
- [Postgres SSL Configuration](https://devcenter.heroku.com/articles/heroku-postgresql#ssl-connections)

