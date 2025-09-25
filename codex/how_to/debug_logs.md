# How-To: Use the Postgres `debug_logs` Table for Instrumentation

This guide explains how the Next.js app records diagnostic events in Postgres and how to rely on that pipeline instead of ad-hoc `console.log` statements. It covers schema setup, runtime wiring, and practical commands for inspecting logs during investigations.

## 1. Ensure the Database Schema Exists

The debug infrastructure ships with migrations that create and maintain the table:

- `migrations/007_debug_logs.up.sql` — creates the `debug_logs` table, indexes, and a cleanup function that trims rows older than 24 hours.
- `migrations/019_fix_debug_logs_trigger.up.sql` — adjusts the `debug_logs_ws_guard` trigger so `workspace_id` stays consistent when `note_id` is supplied (and tolerates `NULL` note IDs).

If you are setting up a fresh environment, run the project’s migration workflow so these files execute (for local development we use the `annotation_dev` database). After migrations, confirm the table is present:

```bash
node - <<'NODE'
const { Client } = require('pg')
;(async () => {
  const client = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev' })
  await client.connect()
  const res = await client.query(`\n    SELECT table_name\n      FROM information_schema.tables\n     WHERE table_schema = 'public'\n       AND table_name = 'debug_logs'\n  `)
  console.log(res.rows)
  await client.end()
})().catch(err => { console.error(err); process.exit(1) })
NODE
```

If the query returns an empty array, re-run migrations or apply the two SQL files manually.

## 2. How the Application Writes Logs

Key implementation pieces already live in the repo:

- `lib/utils/debug-logger.ts`
  - Exposes `debugLog()` (object form or legacy string form).
  - Generates a session ID and POSTs to `/api/debug/log` with `component`, `action`, `metadata`, etc.
- `app/api/debug/log/route.ts`
  - Accepts POST requests, inserts rows into `debug_logs`, and tries to attach a default workspace ID when available.
  - Provides a GET endpoint (`/api/debug/log`) that returns the 20 most recent rows for quick checks.

Any client or server code can call `await debugLog({ component, action, metadata })` instead of logging to the console. Many subsystems already do this (e.g., collapsible-block selection instrumentation, autosave debugging), so you often just need to enable the relevant flags.

### Enabling Existing Instrumentation

Some features guard their logging with environment variables. Example: collapsible block selection checks `NEXT_PUBLIC_DEBUG_COLLAPSIBLE_SELECTION === 'true'`. Set it in `.env.local` and restart Next.js to capture rich selection traces without touching the console.

```ini
# .env.local
NEXT_PUBLIC_DEBUG_COLLAPSIBLE_SELECTION=true
```

## 3. Querying Logs During An Investigation

Use SQL (via `psql`, `pgcli`, or Node’s `pg` module) to inspect structured output. The following snippet mirrors what we used during the Shift+click analysis and is safe to adapt on the fly:

```bash
node - <<'NODE'
const { Client } = require('pg')
;(async () => {
  const client = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev' })
  await client.connect()
  const res = await client.query(`\n    SELECT id, component, action, metadata, created_at\n      FROM debug_logs\n     WHERE component = 'CollapsibleBlockSelection'\n       AND created_at > NOW() - INTERVAL '10 minutes'\n     ORDER BY id DESC\n     LIMIT 40\n  `)
  console.log(JSON.stringify(res.rows, null, 2))
  await client.end()
})().catch(err => { console.error(err); process.exit(1) })
NODE
```

Tips:

- Narrow by `component` and timeframe to keep output focused.
- `metadata` is stored as JSONB; pull nested fields with `metadata -> 'metadata' ->> 'fieldName'` in your SQL when you need precise values.
- Because the logger batches everything through Postgres, you get chronological ordering, consistent structure, and history beyond the browser session.

## 4. Adding New Instrumentation

When you need more signals:

1. Import the logger: `import { debugLog } from '@/lib/utils/debug-logger'`.
2. Emit events where state changes occur. Use concise `component` names and structured `metadata` (objects, not strings) so you can filter later.
3. If the logs are noisy, guard them behind an env flag just like the existing selection debug mode.

Example inline usage:

```ts
await debugLog({
  component: 'MyFeature',
  action: 'STATE_TRANSITION',
  metadata: {
    from: previousState,
    to: nextState,
    noteId,
  },
})
```

## 5. Why Prefer This Over `console.log`

- **Persistence**: Logs survive reloads and are visible to collaborators without screen sharing.
- **Structure**: JSON metadata allows filtering, grouping, and automated analysis (e.g., diffing snapshots during regressions).
- **Noise Control**: You can enable/disable instrumentation with environment flags instead of rewriting code between debugging sessions.
- **Audit Trail**: The `debug_logs` table provides evidence during post-mortems; link concrete row IDs in research docs instead of copying console screenshots.

By leaning on the Postgres-backed logger, investigations stay reproducible and you avoid the ephemerality and noise of console output.
