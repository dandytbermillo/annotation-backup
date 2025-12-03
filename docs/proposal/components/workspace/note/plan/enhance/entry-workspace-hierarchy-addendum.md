# Entry-Workspace Hierarchy — Addendum

Operational concerns, edge cases, and future improvements to address during or after implementation of the [Entry-Workspace Hierarchy Plan](./entry-workspace-hierarchy-plan.md).

This document serves as a living checklist. Items can be checked off as they are addressed during development, testing, and rollout phases.

---

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Complete
- [N/A] Not applicable / Deferred

---

## Terminology Note

> **Important:** Throughout this project, `entryId` in application code maps to the existing `items.id` column in the database. We are **not** creating a new `entries` table. The `items` table (which already supports hierarchical folders/notes) serves as our Entry model. The database column is `item_id`; the API/code uses `entryId` for clarity.

---

## Migration Execution Order

The migrations **must** be executed in this exact sequence:

```
Step 1: Add nullable item_id column
        ALTER TABLE note_workspaces ADD COLUMN item_id UUID;
        (No constraints yet — safe, reversible)
        ↓
Step 2: Backfill existing workspaces
        Create default "Workspace Root" item per user
        UPDATE note_workspaces SET item_id = <root_item_id> WHERE user_id = <user_id>;
        ↓
Step 3: Add new unique index (one default per entry)
        CREATE UNIQUE INDEX note_workspaces_unique_default_per_entry
          ON note_workspaces(user_id, item_id) WHERE is_default;
        ↓
Step 4: Drop old unique index (one default per user)
        DROP INDEX note_workspaces_unique_default_per_user;
        ↓
Step 5: Enforce item_id NOT NULL
        ALTER TABLE note_workspaces ALTER COLUMN item_id SET NOT NULL;
        ↓
Step 6: Add FK constraint with cascade behavior
        ALTER TABLE note_workspaces ADD CONSTRAINT fk_note_workspaces_item
          FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;
```

**Why this order matters:**
- Steps 1-2 must complete before Step 3 (new index requires all rows to have item_id)
- Step 3 must succeed before Step 4 (don't drop old protection until new one is in place)
- Steps 5-6 are "stabilization" phase after rollout is verified

---

## Pre-Implementation (Required)

These items should be addressed before or at the start of implementation.

### Migration Safety

- [ ] Each migration file has corresponding `.down.sql` rollback script
- [ ] Rollback scripts tested locally (apply up → verify → apply down → re-apply up)
- [ ] Pre-check query to identify rows that would violate new constraints before adding them

### Constraint Changes (from main plan)

- [ ] Drop old per-user default index: `note_workspaces_unique_default_per_user`
- [ ] Add new per-entry default index: `note_workspaces_unique_default_per_entry ON (user_id, item_id) WHERE is_default`
- [ ] Decide FK behavior: `ON DELETE CASCADE` (deleting entry removes its workspaces) — verify this is desired
- [ ] Verify rollback scripts handle constraint recreation correctly
- [ ] Test: What happens if backfill leaves some rows with NULL item_id when adding new index?

### Access Control

- [ ] All workspace API endpoints include `WHERE user_id = $currentUser`
- [ ] Entry (item) access validated before workspace operations
- [ ] Document access control rules in API layer

---

## During Implementation (As Encountered)

Address these as the relevant features are built.

### Error Handling

- [ ] Entry fetch failure — Show cached list with stale indicator; retry button
- [ ] Workspace list fetch failure — Graceful degradation; retry option
- [ ] Workspace creation failure — Rollback or allow retry; don't leave orphan entry
- [ ] Workspace save failure — Already handled by existing retry logic; verify entry-scoped behavior
- [ ] Entry creation failure — Clear error message; no partial state

### Edge Cases

| Scenario | Handling | Status |
|----------|----------|--------|
| User deletes the entry they're currently viewing | Redirect to next entry or root; show toast | [ ] |
| Entry has no workspaces (all deleted) | Auto-create default workspace OR show "Create workspace" prompt | [ ] |
| User on Workspace A; another tab deletes Entry containing A | Detect stale state; show toast and redirect | [ ] |
| Workspace belongs to soft-deleted entry | Hidden from normal UI; visible in trash/recovery | [ ] |
| Entry deleted while workspace runtime is hot | Allow natural save cycle to complete before removal | [ ] |
| User creates workspace but entry was just deleted | Return clear error; don't create orphan workspace | [ ] |

### API Backward Compatibility

- [ ] During rollout: `entryId` optional in APIs (legacy support)
- [ ] Document which endpoints accept optional vs required `entryId`
- [ ] After stabilization: `entryId` required; legacy paths removed

---

## Before Wide Rollout (Required)

Complete these before enabling the feature flag for all users.

### Observability

#### Metrics

- [ ] `entry_switch_latency_ms` — Time to load entry's workspaces
- [ ] `entry_switch_count` — Number of entry switches per session
- [ ] `workspace_save_error_rate` — Failed saves, grouped by entry
- [ ] `migration_backfill_progress` — Percentage of workspaces with `item_id` set

#### Alerts

- [ ] Backfill stalled (no progress for 1 hour)
- [ ] Error rate > 1% for any entry operation
- [ ] Constraint violation during migration
- [ ] Workspace save failures spike

#### Debug Mode

- [ ] Feature flag to enable verbose logging during rollout
- [ ] Entry/workspace operations logged to `debug_logs` table

### Performance Testing

- [ ] Entry with 50+ workspaces — Measure load time
- [ ] Entry with 100+ workspaces — Verify UI doesn't freeze
- [ ] 500+ entries in navigator — Measure render performance
- [ ] Rapid entry switching (10 switches in 5 seconds) — Verify no race conditions
- [ ] Concurrent workspace saves across entries — Verify no conflicts

### Rollback Testing

- [ ] Rollback tested for: Add nullable `item_id` column
- [ ] Rollback tested for: Add new unique index
- [ ] Rollback tested for: Drop old unique index
- [ ] Rollback tested for: Enforce `item_id NOT NULL`
- [ ] Rollback tested for: Add FK constraint
- [ ] Full rollback sequence tested end-to-end

### Security Review

- [ ] Verify user cannot access another user's entries
- [ ] Verify user cannot access another user's workspaces
- [ ] Verify cascade delete doesn't leak data across users
- [ ] API rate limiting for entry/workspace operations

---

## Post-Stable (Future Improvements)

These can be addressed after the feature is stable in production.

### Performance Optimizations

- [ ] Workspace list caching — Cache `listWorkspaces(entryId)` results for 30s
- [ ] Entry navigator virtualization — Use virtual list for 100+ entries
- [ ] Workspace pagination — Lazy-load if entry has >20 workspaces
- [ ] Prefetch adjacent entries — Load likely-next entry's workspace list

### Feature Enhancements

- [ ] Move workspace between entries
- [ ] Duplicate workspace to another entry
- [ ] Cross-tab sync for entry/workspace deletions
- [ ] Bulk operations (delete multiple entries/workspaces)
- [ ] Entry templates (pre-configured workspace sets)

### Operational

- [ ] Detailed operational runbook
- [ ] Disaster recovery procedures
- [ ] Data export/import for entries and workspaces

---

## Rollback Procedures

Document the rollback steps for each migration as they are written.

### Migration: Add `item_id` Column

```sql
-- Rollback
ALTER TABLE note_workspaces DROP COLUMN IF EXISTS item_id;
```

### Migration: Add New Unique Index

```sql
-- Rollback
DROP INDEX IF EXISTS note_workspaces_unique_default_per_entry;
-- Recreate old index if needed
CREATE UNIQUE INDEX note_workspaces_unique_default_per_user
  ON note_workspaces(user_id)
  WHERE is_default;
```

### Migration: Drop Old Unique Index

```sql
-- Rollback (recreate the old index)
CREATE UNIQUE INDEX note_workspaces_unique_default_per_user
  ON note_workspaces(user_id)
  WHERE is_default;
```

### Migration: Enforce `item_id NOT NULL`

```sql
-- Rollback
ALTER TABLE note_workspaces ALTER COLUMN item_id DROP NOT NULL;
```

### Migration: Add FK Constraint

```sql
-- Rollback
ALTER TABLE note_workspaces DROP CONSTRAINT IF EXISTS fk_note_workspaces_item;
```

---

## Architecture Principles (Reference)

These principles from the main plan should be maintained throughout implementation:

1. **Single Canvas, Swapped State** — The canvas component is reused across all entries. Switching entries or workspaces mounts different state into the same canvas.

2. **Unlimited Entries** — Entries live in the database (`items` table). Only the selected entry's workspaces are fetched. The UI supports arbitrary entry counts via search, filtering, and tree collapse.

3. **Bounded Memory** — Regardless of entry/workspace count, only `MAX_HOT_RUNTIMES` (4 desktop, 2 tablet) workspace runtimes exist in memory. LRU eviction with pre-eviction persistence handles the rest.

4. **Entry as Organizational Layer** — Entries group workspaces but don't affect runtime behavior. Workspace runtimes are keyed by UUID, independent of entry.

---

## Open Questions

Document questions that arise during implementation:

| Question | Context | Resolution |
|----------|---------|------------|
| (Add as discovered) | | |

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-12-03 | Initial addendum created | Claude |
| 2025-12-03 | Added: Terminology Note (entryId → items.id), Migration Execution Order, Constraint Changes checklist | Claude |
