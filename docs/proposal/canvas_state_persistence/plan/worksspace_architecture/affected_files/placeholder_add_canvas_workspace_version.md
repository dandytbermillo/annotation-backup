This placeholder represents the future migration files (up/down) that will add a `version` column to `canvas_workspace_notes` (and optionally `panels`).

When implementing Phase 1, create migration files similar to:
- `migrations/0xx_add_canvas_workspace_version.up.sql`
- `migrations/0xx_add_canvas_workspace_version.down.sql`

Ensure they:
1. Add the `version` column with default 0 and NOT NULL constraint.
2. Backfill existing rows.
3. Update any triggers/indexes needed for monotonic increments.
