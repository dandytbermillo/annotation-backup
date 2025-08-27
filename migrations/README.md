# Database Migrations

This directory contains PostgreSQL migration files for the YJS annotation system.

## Migration Naming Convention

- `XXX_description.up.sql` - Forward migration
- `XXX_description.down.sql` - Rollback migration

Where `XXX` is a sequential number (001, 002, etc.)

## Running Migrations

### Apply migrations:
```bash
# Using psql directly
psql $POSTGRES_URL -f migrations/001_initial_schema.up.sql

# Or with Docker
docker exec -i postgres-persistence-postgres-1 psql -U postgres -d annotation_system < migrations/001_initial_schema.up.sql
```

### Rollback migrations:
```bash
psql $POSTGRES_URL -f migrations/001_initial_schema.down.sql
```

## Important Notes

1. **YJS is the runtime CRDT** - These tables only persist YJS state
2. **No awareness/presence data** - Ephemeral data is never persisted
3. **Binary data** - YJS updates are stored as BYTEA, not JSON
4. **Idempotent** - Migrations can be run multiple times safely

## Current Migrations

- `001_initial_schema` - Base tables for notes, branches, panels, connections, and YJS updates