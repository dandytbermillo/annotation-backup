# Knowledge Index

## Quick Reference
- [Patterns](#patterns) - Reusable solutions
- [Errors](#errors) - Common issues & fixes  
- [Decisions](#decisions) - Architecture choices

## Patterns

### YJS Integration
- **Location**: `patterns/yjs-integration.md`
- **Topics**: Binary parsing, Y.Doc handling, sync strategies
- **Key Pattern**: Always use Y.Doc methods, never parse binary directly

### PostgreSQL Adapters
- **Location**: `patterns/postgres-adapters.md`
- **Topics**: Connection pooling, transaction handling, migrations
- **Key Pattern**: Use prepared statements, handle connection errors

### Testing Strategies
- **Location**: `patterns/testing.md`
- **Topics**: YJS mocking, integration test setup, e2e flows
- **Key Pattern**: Test sync at protocol level, not implementation

## Errors

### YJS Sync Failures
- **Location**: `errors/yjs-sync.md`
- **Common**: Binary format issues, version conflicts
- **Fix**: Use proper YJS encoding/decoding methods

### Database Connection
- **Location**: `errors/database.md`
- **Common**: Pool exhaustion, transaction deadlocks
- **Fix**: Proper pool configuration, retry logic

## Decisions

### PostgreSQL vs SQLite
- **Location**: `decisions/database-choice.md`
- **Choice**: PostgreSQL for web, SQLite option for Electron
- **Rationale**: Better JSON support, concurrent access

### YJS vs Operational Transform
- **Location**: `decisions/crdt-choice.md`
- **Choice**: YJS for all collaborative features
- **Rationale**: Better offline support, proven library

### Sync Architecture
- **Location**: `decisions/sync-architecture.md`
- **Choice**: Adapter pattern with pluggable providers
- **Rationale**: Flexibility for different persistence backends

## Search Tips
- Use `/context search <query>` for full-text search
- Prefix with category: `error:connection` or `pattern:yjs`
- Recent items are weighted higher in results