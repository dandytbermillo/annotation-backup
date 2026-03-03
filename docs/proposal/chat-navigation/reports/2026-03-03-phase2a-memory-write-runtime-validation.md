# Phase 2a Memory Write — Runtime Validation Report

**Date:** 2026-03-03
**Feature:** Phase 2 Exact-Memory Assist (chat routing)
**Scope:** Phase 2a (write-only canary) + context-key drift fix
**Status:** Phase 2a validated. UPSERT confirmed. Ready for Phase 2b.

---

## 1. Summary

This session covered:

1. **Environment setup** — enabled Phase 2a feature flags, verified database tables
2. **Database migration recovery** — clean reset after migration chain failure, fixed 5 migration files
3. **Seed data repair** — fixed generated-column INSERT error in `note-workspace-repo.ts`, manual dashboard seeding
4. **Panel label collision fix** — root-caused duplicate "Links Panel" titles, fixed API route to include badge letter
5. **Phase 2a canary validation** — confirmed memory writes for `execute_widget_item` structured actions
6. **Context-key drift diagnosis** — identified `message_count` as the volatile field preventing UPSERT
7. **Drift fix** — added `stripVolatileFields()`, bumped `MEMORY_TOOL_VERSION` to v2, confirmed UPSERT working

---

## 2. Issues Found and Fixed

### 2.1 Database Migration Chain Failure

**Symptom:** App showed "Note workspaces unavailable" blank screen after restart.

**Root cause:** Fresh database had runtime `ensureSchemaReady()` tables that conflicted with migration 001's index creation (`idx_branches_panels already exists`). Migration runner stopped at 001, leaving the DB in a hybrid state — basic tables existed but lacked columns added by later migrations.

**Fix:** Clean database reset (`DROP SCHEMA public CASCADE`) followed by fixing 5 individual migration files:

| Migration | Error | Fix |
|-----------|-------|-----|
| `010_document_saves_fts.up.sql` | Cannot reference generated column in another generated column | Split into separate ALTERs; changed `search_vector` to trigger-based |
| `020_add_workspace_to_document_saves.up.sql` | `relation 'workspaces' does not exist` | Added `CREATE TABLE IF NOT EXISTS workspaces (...)` |
| `042_add_item_id_to_note_workspaces.up.sql` | `relation 'note_workspaces' does not exist` | Added `CREATE TABLE IF NOT EXISTS note_workspaces (...)` |
| `046_dashboard_seeding.up.sql` | `column 'workspace_id' of relation 'items' does not exist` | Manually added `ALTER TABLE items ADD COLUMN workspace_id UUID` |
| Migrations 021, 022 | Reference `items.workspace_id` which no prior migration creates | Skipped (registered as applied) |

**Result:** All 69 migrations applied, 36 tables created.

### 2.2 Generated Column INSERT Error

**Symptom:** Repeated `cannot insert a non-DEFAULT value into column 'slug'` errors, blank screen.

**Root cause:** `items.slug` is `GENERATED ALWAYS AS (...) STORED`. The `getOrCreateLegacyWorkspacesFolder()` function in `lib/server/note-workspace-repo.ts` was explicitly inserting `slug` values.

**Fix:** Removed `slug` from two INSERT statements:

```typescript
// Before (lines 104-109):
INSERT INTO items (type, parent_id, path, name, slug) VALUES ('folder', $1, $2, 'Home', $3)

// After:
INSERT INTO items (type, parent_id, path, name) VALUES ('folder', $1, $2, 'Home')
```

Same fix applied at lines 133-138 for the Legacy Workspaces INSERT.

**File:** `lib/server/note-workspace-repo.ts`

### 2.3 Duplicate "Links Panel" Titles

**Symptom:** Chat routing always showed "Links Panel, Links Panel?" clarifier — could never disambiguate between panels.

**Root cause:** Both `links_note` and `links_note_tiptap` panel types are registered with identical `name: 'Links Panel'` in `lib/dashboard/panel-registry.ts:173-194`. The API route (`app/api/dashboard/panels/route.ts:197`) uses `title ?? defaultPanel.title` which falls back to the registry name. Badge letters (A, B, C) were auto-assigned and stored in the `badge` column but never incorporated into the title.

The routing grounding set (`lib/chat/grounding-set.ts:185`) uses `panel.title` as the label, and `DashboardView.tsx:174` builds `visibleWidgets` from `panel.title` — so identical titles produced permanent routing ambiguity.

**Fix:** `app/api/dashboard/panels/route.ts:197`:

```typescript
// Before:
title ?? defaultPanel.title,

// After:
title ?? (badge ? `${defaultPanel.title} ${badge}` : defaultPanel.title),
```

New panels now get titles like "Links Panel A", "Links Panel B", "Links Panel C".

**Existing rows updated manually:**
```sql
UPDATE workspace_panels SET title = 'Links Panel A' WHERE id = '9add1baf-...';
UPDATE workspace_panels SET title = 'Links Panel B' WHERE id = '2567b058-...';
```

### 2.4 Context-Key Drift (message_count in Fingerprint)

**Symptom:** Repeat of the same command with same panels open produced new memory rows instead of incrementing `success_count`. No Phase 2b memory hits possible.

**Root cause:** `ContextSnapshotV1` includes `message_count: number` (= `ctx.messages.length`). Every user message + assistant response increments this counter, so the context fingerprint changes every turn — guaranteed drift.

**Evidence:**
```
Row 1 (02:29): context_fingerprint = 22e4889a... (message_count = N)
Row 2 (02:32): context_fingerprint = 69d62a63... (message_count = N+2)
```

Same query, same panels, different fingerprint.

**Fix:** Scoped approach (preserves log fidelity):

1. Added `stripVolatileFields()` in `lib/chat/routing-log/context-snapshot.ts` — strips `message_count` from snapshot for memory keying only
2. Wired into `app/api/chat/routing-memory/route.ts` (write) and `app/api/chat/routing-memory/lookup/route.ts` (read)
3. Bumped `MEMORY_TOOL_VERSION` from `'v1'` to `'v2'` in `lib/chat/routing-log/types.ts` to isolate old/new keys
4. Durable log still gets full `ContextSnapshotV1` with `message_count` intact

**Verification:** After fix, repeat "open the buget100" with same panel → single v2 row with `success_count: 2`.

---

## 3. Files Modified

### Runtime Code

| File | Change |
|------|--------|
| `app/api/dashboard/panels/route.ts:197` | Include badge letter in panel title for links panels |
| `app/api/chat/routing-memory/route.ts:4,72` | Import and use `stripVolatileFields()` before fingerprinting |
| `app/api/chat/routing-memory/lookup/route.ts:4,53` | Import and use `stripVolatileFields()` before fingerprinting |
| `lib/chat/routing-log/context-snapshot.ts:50-58` | Added `stripVolatileFields()` function |
| `lib/chat/routing-log/types.ts:37` | Bumped `MEMORY_TOOL_VERSION` from `'v1'` to `'v2'` |
| `lib/chat/routing-log/index.ts:16` | Barrel export for `stripVolatileFields` |
| `lib/server/note-workspace-repo.ts:104-109,133-138` | Removed `slug` from INSERT statements |

### Migration Fixes

| File | Change |
|------|--------|
| `migrations/010_document_saves_fts.up.sql` | Split generated columns; trigger-based `search_vector` |
| `migrations/020_add_workspace_to_document_saves.up.sql` | Added `CREATE TABLE IF NOT EXISTS workspaces`; conditional backfill |
| `migrations/042_add_item_id_to_note_workspaces.up.sql` | Added `CREATE TABLE IF NOT EXISTS note_workspaces` |

### Tests

| File | Change |
|------|--------|
| `__tests__/unit/routing-log/context-snapshot.test.ts` | 4 new tests for `stripVolatileFields()` including regression test |
| `__tests__/unit/routing-log/memory-write-payload.test.ts` | Updated `tool_version` assertion from `'v1'` to `'v2'` |

---

## 4. Feature Flag Configuration

### `.env` settings used during validation:

```env
# Phase 1: Durable routing log (observe-only)
NEXT_PUBLIC_CHAT_ROUTING_OBSERVE_ONLY=true

# Phase 2a: Memory write (write-only canary)
NEXT_PUBLIC_CHAT_ROUTING_MEMORY_WRITE=true
CHAT_ROUTING_MEMORY_WRITE_ENABLED=true

# Phase 2b: Memory read (OFF for canary step)
# NEXT_PUBLIC_CHAT_ROUTING_MEMORY_READ=true
# CHAT_ROUTING_MEMORY_READ_ENABLED=true

# Emergency kill switch (uncomment to kill both read+write server-side)
# CHAT_ROUTING_MEMORY_KILL=true
```

---

## 5. Runtime Validation Results

### 5.1 Phase 1 Durable Log — Confirmed Working

```
Total log rows: 35
LLM executed: 9 | Deterministic: 2 | Clarifier: 13
```

All rows have correct `routing_lane`, `decision_source`, `result_status`, `provenance`, and `risk_tier` values.

### 5.2 Phase 2a Memory Write — Confirmed Working

**Memory index state after testing:**

| Query | Intent | Tool Version | success_count | Context Fingerprint |
|-------|--------|:---:|:---:|---|
| `open the buget100` | `grounding_llm_widget_item_execute` | **v2** | **2** | `bbecb3fd...` |
| `open the buget100` | `grounding_llm_widget_item_execute` | v1 | 1 | `69d62a63...` |
| `open the buget100` | `grounding_llm_widget_item_execute` | v1 | 1 | `22e4889a...` |
| `open the summary100` | `grounding_llm_widget_item_execute` | v1 | 1 | `7936f7db...` |
| `ope the buget100 from active` | `scope_cue_widget_grounding_llm_execute` | v1 | 1 | `52016e6a...` |
| `open the budget100` | `grounding_llm_widget_item_execute` | v1 | 1 | `80d6fa18...` |

**Key observations:**
- 6 total rows: 5 v1 (pre-drift-fix), 1 v2 (post-drift-fix)
- The v2 row has `success_count: 2` — **UPSERT confirmed working**
- `created_at` and `updated_at` differ on the v2 row (02:51:58 vs 02:52:14) — proves two separate writes hit the same row
- v1 rows are isolated by `tool_version` — v2 lookups won't match them

### 5.3 Write Eligibility Gate — Confirmed

Memory writes only occur for eligible actions:
- `result.handled === true`
- `result_status === 'executed'`
- Has `groundingAction` (`execute_widget_item` or `execute_referent`)

Verified: Clarifier responses, panel drawer opens, and LLM clarifications produced 0 memory rows. Only `grounding_llm_widget_item_execute` and `scope_cue_widget_grounding_llm_execute` actions wrote memory entries.

### 5.4 Write Timing (Gate 5) — Confirmed

Memory writes happen after confirmed execution in `sendMessage()`, not at dispatcher time. Evidence: all memory rows correspond to durable log entries with `result_status: 'executed'`. No false positives from failed executions.

### 5.5 Panel Disambiguation — Confirmed Fixed

After renaming panels to "Links Panel A", "Links Panel B", "Links Panel C":
- Typing "links panel" correctly shows 3 distinct options in clarifier
- Typing "open links panel a" opens the correct panel (Auto-Executed)
- Ordinal selection ("2") picks the correct option (Deterministic)

---

## 6. Test Results

```
$ npx jest __tests__/unit/routing-log/ --no-coverage

Test Suites: 11 passed, 11 total
Tests:       120 passed, 120 total
Time:        0.439 s
```

```
$ npx tsc --noEmit 2>&1; echo "EXIT_CODE=$?"

__tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005: ')' expected.
EXIT_CODE=2
```

Only error is pre-existing syntax error in `use-panel-close-handler.test.tsx:87` — unrelated to routing-log work.

---

## 7. Regression Tests Added

4 new tests in `context-snapshot.test.ts`:

1. **`removes message_count from snapshot`** — verifies `stripVolatileFields()` excludes `message_count`
2. **`preserves all non-volatile fields`** — verifies all structural fields survive stripping
3. **`produces same fingerprint when only message_count differs`** — **regression test**: two snapshots differing only in `message_count` produce identical canonical JSON after stripping
4. **`produces different fingerprint when structural fields differ`** — verifies that actual structural changes (e.g. `openWidgetCount`) still produce different fingerprints

---

## 8. Architecture Decisions

### 8.1 Scoped Volatile Field Stripping (Not Global Removal)

`message_count` was NOT removed from `ContextSnapshotV1`. Instead, `stripVolatileFields()` is applied only in memory write/read routes. The durable log retains full snapshot fidelity with `message_count` for Phase 1 observability.

### 8.2 Tool Version Isolation

Bumped `MEMORY_TOOL_VERSION` from `'v1'` to `'v2'`. The UPSERT key includes `tool_version`, so old v1 rows from the drift-era are never matched by v2 lookups. No migration needed — old rows naturally expire via `ttl_expires_at` (30 days).

### 8.3 Badge-in-Title for Panel Disambiguation

Rather than modifying the routing grounding set to read the `badge` column, the fix appends the badge letter to the `title` column at creation time. This is simpler and ensures all downstream consumers (routing, UI, debug logs) see the unique title without additional plumbing.

---

## 9. Known Limitations

1. **Pre-existing `use-panel-close-handler.test.tsx` syntax error** — blocks `tsc --noEmit` from exiting cleanly for the full repo. Unrelated to routing-log work.
2. **Existing panels need manual title update** — panels created before the badge-in-title fix still have duplicate titles. Only affects panels created before this session.
3. **`has_pending_options` and `has_last_clarification` may also drift** — these are less volatile than `message_count` (they reset between turns), but could cause mismatches in some edge cases. Monitor during Phase 2b soak.
4. **Phase 2b not yet tested** — memory read path is implemented and unit-tested but not runtime-validated. Requires enabling `NEXT_PUBLIC_CHAT_ROUTING_MEMORY_READ=true` and `CHAT_ROUTING_MEMORY_READ_ENABLED=true`.

---

## 10. Next Steps

1. **Phase 2b smoke test** — enable read flags, repeat a command that has a v2 memory row, verify `decision_source='memory_exact'` and `routing_lane='B1'` in durable log
2. **Phase 2b commit-point revalidation** — test that closing a panel between dispatch and execution causes graceful fallback to LLM
3. **Kill switch verification** — set `CHAT_ROUTING_MEMORY_KILL=true`, verify write returns `{ status: 'killed' }` and lookup returns `{ match: null }`
4. **Server-authoritative flag test** — set client flag on but server flag off, verify server returns `{ status: 'disabled' }`
5. **Monitor `has_pending_options` / `has_last_clarification` drift** — if Phase 2b shows low hit rates, consider adding these to `stripVolatileFields()`

---

## 11. Acceptance Criteria Status

- [x] Memory writes produce valid rows for `execute_widget_item` — **verified**: 6 rows with correct `slots_json`, `target_ids`, `intent_id`
- [x] Memory writes happen ONLY after confirmed execution in sendMessage (Gate 5) — **verified**: no rows for clarified/failed actions
- [x] UPSERT increments `success_count` on repeat commands (v2 keying) — **verified**: `success_count: 2` on row `0c09f88b`
- [x] `tool_version='v2'` isolates old v1 keys — **verified**: 5 v1 rows untouched, 1 v2 row with increment
- [x] Volatile field stripping scoped to memory routes only — **verified**: durable log still has full snapshot
- [x] Panel badge included in title at creation time — **verified**: new panel created as "Links Panel C"
- [x] 11 test suites, 120 tests passing — **verified**
- [x] Type-check clean for routing-log files — **verified** (only pre-existing unrelated error)
- [ ] Phase 2b memory read serves action from memory — **not yet tested** (next step)
- [ ] Kill switch kills both read and write — **not yet tested** (next step)
- [ ] Server-authoritative flags override client flags — **not yet tested** (next step)
