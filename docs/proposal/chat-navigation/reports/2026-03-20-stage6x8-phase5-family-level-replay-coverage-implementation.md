# Stage 6x.8 Phase 5 — Family-Level Replay Coverage Implementation Report

**Date:** 2026-03-20
**Status:** Phase A (audit) + Phase B (hardening) complete. Phase C/D (systematic family validation + context-key audit) pending.

## Summary

Replaced query-specific replay fixes with a family-level replay coverage framework for all approved Phase 5 navigation families: `open_entry`, `open_workspace`, `open_panel`, `go_home`. The work covered:

1. Navigation writeback via existing pending-write pipeline
2. First-class B1 replay for Phase 5 navigation rows
3. Payload hardening (reject incomplete rows)
4. Replay success gating (after confirmed execution)
5. Arbiter bypass for home-navigation imperatives
6. Near-tie clarifier removal (retrieval-level near-ties don't block LLM)
7. Parity invariant tests (query fingerprint + context snapshot)

**Design doc:** `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-family-level-replay-coverage-addendum.md`

## Changes

### 1. Navigation Writeback (`navigate/route.ts`)

Extended `phase5_pending_write` to cover successful navigation executions. Gated on `resolution.action` (executed action), not `intent.intent` (LLM classification):

```typescript
const RESOLUTION_ACTION_TO_WRITEBACK = {
  'navigate_entry': 'open_entry',
  'navigate_workspace': 'open_workspace',
  'navigate_home': 'go_home',
  'open_panel_drawer': 'open_panel',
} as const
```

Uses `phase5_replay_query_text` (raw trimmed input) for writeback keying and `phase5_context_snapshot` (shared replay snapshot from dispatcher) for context fingerprint parity.

### 2. First-Class B1 Replay (`memory-action-builder.ts`, `memory-validator.ts`)

Extended B1 to replay Phase 5 navigation rows as `navigationReplayAction` — a closed discriminated union:

```typescript
| { type: 'open_entry'; entryId; entryName; dashboardWorkspaceId }
| { type: 'open_workspace'; workspaceId; workspaceName; entryId; entryName; isDefault }
| { type: 'open_panel'; panelId; panelTitle }
| { type: 'go_home' }
```

Validator accepts Phase 5 nav action types with lighter validation (final target validation happens in `executeAction`). Builder reconstructs `navigationReplayAction` from stored `slots_json`.

### 3. Navigation Replay Execution (`chat-navigation-panel.tsx`)

Replay branch converts `navigationReplayAction` → `IntentResolutionResult` → `executeAction(resolution)`. Success message and memory logs fire only after confirmed execution. Failed replay shows error message with no Memory-Exact provenance.

### 4. Payload Hardening (`memory-write-payload.ts`)

`buildPhase5NavigationWritePayload` rejects incomplete payloads:
- `open_entry` without `dashboardWorkspaceId` → null
- `open_workspace` without `entryId`/`entryName` → null
- `open_panel` without `panelTitle` → null

### 5. Shared Replay Snapshot (`routing-dispatcher.ts`)

`phase5ReplaySnapshot` computed once from live UI state, unconditionally. B1 uses it directly (no recomputation). Panel forwards it to navigate route for writeback. Eliminates context fingerprint mismatch between write and lookup.

### 6. Arbiter Bypass Fixes (`routing-dispatcher.ts`)

**`isActionNavigationCommand`:** Replaced the old arbiter bypass patchwork (3 separate checks) with one function. Action verbs (`open`/`show`/`go to`/`switch to`) bypass arbiter. State-info guard protects queries like "which panel is open?".

**`HOME_NAV_BYPASS`:** Home-navigation imperatives (`return home`, `take me home`, `back home`) bypass arbiter regardless of surface context. Narrow pattern — does not affect state-info queries.

### 7. Near-Tie Removal (`routing-dispatcher.ts`)

Removed retrieval-level near-tie clarifier. Near-tie metadata preserved in telemetry but doesn't block LLM fallback. Genuine execution ambiguity handled by resolver downstream.

### 8. Provenance Persistence (`chat-navigation-context.tsx`, `ChatMessageList.tsx`)

Provenance badges persisted in message metadata. Survives entry/workspace navigation remounts. `provenanceMap` (in-memory) is immediate overlay; `message.provenance` (persisted) is durable fallback.

### 9. Curated Seed Policy

Seeds cover stable command families only (`go home`, `take me home`, `return home`, `open links panel b`, `open navigator`, history/verify seeds). User-specific targets (budget100, budget300) are NOT pre-seeded — learned from successful real usage via writeback.

## Test Results

```
Test Suites: 28 passed, 28 total
Tests:       423+ passed
```

### Key test suites and counts

| Suite | Tests |
|-------|-------|
| content-intent-dispatcher-integration | 64 |
| phase5-semantic-lookup-route | 17 |
| phase5-retrieval-normalization | 36 |
| phase5-semantic-hints | 30 |
| phase5-navigation-write | 13 |
| phase5-info-intent-write | 7 |
| phase5-pending-promotion | 16 |
| phase5-replay-parity | 7 |
| phase5-provenance-persistence | 11 |
| routing-log/semantic-lookup-route | 7 |
| routing-log/b2-attach-path | 5 |
| state-info-resolvers | 16 |

### Proof levels

| Seam | Proof Level |
|------|------------|
| Incomplete payload rejection | Automated test ✅ |
| Raw replay-query parity | Automated test ✅ |
| Shared replay-snapshot parity | Automated test ✅ |
| HOME_NAV_BYPASS regression | Automated test ✅ |
| Near-tie doesn't block LLM | Automated test ✅ |
| Action-nav arbiter bypass | Automated test ✅ |
| Replay success after confirmed execution | Code-verified ⚠️ |
| Failed replay provenance gating | Code-verified ⚠️ |

## Runtime Verification (Smoke Tests)

| Input | Context | Result | Status |
|-------|---------|--------|--------|
| "hello pls open the budget100" | Home | Memory-Exact (learned) | ✅ |
| "hello pls open the budget200" | Home | Memory-Exact (learned) | ✅ |
| "hello there open links panel b" | Home | Auto-Executed → Memory-Exact | ✅ |
| "please open workspace budget100" | on entry | Auto-Executed → Memory-Exact | ✅ |
| "can you pls again return home" | workspace | "Going home..." Auto-Executed → Memory-Exact | ✅ |
| "again pls return home" | on Home | "Already on Home" LLM-Influenced | ✅ (no writeback) |
| "hey can please open the budget" | Home | LLM-Clarifier with 3 options | ✅ (ambiguity) |
| "which panel is open?" | dashboard | Deterministic state-info | ✅ (arbiter runs) |
| "is any panel open?" | dashboard | State-info answer | ✅ (arbiter runs) |

## Coverage Matrix

| Family | First-turn works | Pending write | Promotion | B1 replay | Memory-Exact | Exclusions |
|--------|-----------------|---------------|-----------|-----------|-------------|------------|
| open_entry | ✅ | ✅ | ✅ | ✅ | ✅ | Failed/ambiguous → no write |
| open_workspace | ✅ | ✅ | ✅ | ✅ | ✅ | Failed/ambiguous → no write |
| open_panel | ✅ | ✅ | ✅ | ✅ | ✅ | Missing panelTitle → no write |
| go_home | ✅ | ✅ | ✅ | ✅ | ✅ | Already-on-Home → no write |

## Known Limitations

1. **Replay-failure gating is code-verified, not test-proven.** The replay branch correctly gates success message and provenance on confirmed execution, but no dedicated automated test covers the failure path.

2. **Context fingerprint volatility.** Navigation changes `active_panel_count` between entries. B1 may miss on the immediate next repeat after promotion due to context change. One extra turn usually suffices for the async write to land.

3. **Async promotion race.** `recordMemoryEntry` is fire-and-forget. The very next rapid repeat may miss B1 because the DB write hasn't completed. Known limitation — not blocking for typical user interaction timing.

4. **Provenance badge lost on entry navigation (partially fixed).** Dispatcher-originated messages persist provenance in metadata. Navigate-executed messages set provenance via `setProvenance` after response — may be lost on remount. Partially mitigated by the persistence fix.

5. **`isLikelyNavigateCommand` still exported.** No longer used for arbiter entry but stays exported. Cleanup deferred.

## Files Modified (This Session)

| File | Change |
|------|--------|
| `lib/chat/routing-dispatcher.ts` | `isActionNavigationCommand`, `HOME_NAV_BYPASS`, `phase5ReplaySnapshot`, `navigationReplayAction` type, near-tie removal, arbiter entry refactor, provenance state-info fix |
| `lib/chat/routing-log/memory-action-builder.ts` | First-class `navigationReplayAction` for Phase 5 nav rows |
| `lib/chat/routing-log/memory-validator.ts` | Accept Phase 5 nav action types |
| `lib/chat/routing-log/memory-write-payload.ts` | `buildPhase5NavigationWritePayload` with replay-required fields + incomplete rejection |
| `app/api/chat/navigate/route.ts` | Navigation writeback via `RESOLUTION_ACTION_TO_WRITEBACK`, `phase5_replay_query_text`, `phase5_context_snapshot`, panel-field mapping |
| `components/chat/chat-navigation-panel.tsx` | Navigation replay execution, provenance persistence, `HOME_NAV_BYPASS` forwarding, stale-closure fix |
| `lib/chat/chat-navigation-context.tsx` | `ChatMessage.provenance`, `pendingPhase5Write` state, provenance in metadata persistence/hydration |
| `components/chat/ChatMessageList.tsx` | Provenance badge fallback to `message.provenance` |
| `app/api/chat/routing-memory/semantic-lookup/route.ts` | Multi-pass retrieval, normalization, exact-hit, lowered floor |
| `scripts/seed-phase5-curated-exemplars.ts` | Curated seed cleanup (stable families only) |

## Phase C/D Implementation (2026-03-20)

### Phase C: Replay Reconstruction Verification

4 new tests added to `memory-action-builder.test.ts` proving each family reconstructs `navigationReplayAction` (not synthetic text re-resolution):
- `open_entry` → `{ type: 'open_entry', entryId, entryName, dashboardWorkspaceId }` ✅
- `open_workspace` → `{ type: 'open_workspace', workspaceId, workspaceName, entryId, entryName, isDefault }` ✅
- `open_panel` → `{ type: 'open_panel', panelId, panelTitle }` ✅
- `go_home` → `{ type: 'go_home' }` ✅

### Phase D: Navigation-Specific Context Fingerprint

**Problem:** B1 exact replay used the same context fingerprint for all rows. Navigation changes ephemeral UI state (`active_panel_count`, `has_pending_options`, etc.) between turns, causing fingerprint mismatches and missed replays.

**Fix:** `stripVolatileFieldsForNavigation` — keeps only `version` + `latch_enabled`. Used by:
- Memory write route (`routing-memory/route.ts`) — for Phase 5 nav intent IDs
- B1 lookup route (`routing-memory/lookup/route.ts`) — when `navigation_replay_mode` flag is set
- Dispatcher — passes `navigation_replay_mode: true` when `isActionNavigationCommand || HOME_NAV_BYPASS` matches

Full `context_snapshot` still stored for diagnostics. Only fingerprint policy changed.

### Home-Navigation Arbiter Bypass

`HOME_NAV_BYPASS` pattern added to arbiter exclusion — "return home", "take me home", "back home" bypass the arbiter regardless of surface context. Previously, these could be intercepted by the arbiter inside entry workspaces.

### Replay-Failure Gating

9 replay-failure contract tests prove: failed `executeAction` → no success message, no Memory-Exact provenance, no memory log/write.

### Near-Tie Removal

Retrieval-level near-tie clarifier removed. Near-tie metadata preserved in telemetry but doesn't block LLM fallback. Genuine ambiguity handled by resolver downstream.

## Updated Coverage Matrix

| Family | First-turn | Writeback | Promotion | B1 Replay | Memory-Exact | Context Key | Exclusions |
|--------|-----------|-----------|-----------|-----------|-------------|-------------|------------|
| open_entry | ✅ | ✅ | ✅ | ✅ | ✅ | Navigation-minimal | Failed/ambiguous |
| open_workspace | ✅ | ✅ | ✅ | ✅ | ✅ | Navigation-minimal | Failed/ambiguous |
| open_panel | ✅ | ✅ | ✅ | ✅ | ✅ | Navigation-minimal | Missing panelTitle |
| go_home | ✅ | ✅ | ✅ | ✅ | ✅ | Navigation-minimal | Already-on-Home |

## Updated Proof Levels

| Seam | Proof Level |
|------|------------|
| Replay reconstruction (4 families) | Automated test ✅ |
| Incomplete payload rejection | Automated test ✅ |
| Raw replay-query parity | Automated test ✅ |
| Shared replay-snapshot parity | Automated test ✅ |
| HOME_NAV_BYPASS regression | Automated test ✅ |
| Near-tie doesn't block LLM | Automated test ✅ |
| Action-nav arbiter bypass | Automated test ✅ |
| Navigation-specific fingerprint | Runtime-verified ✅ |
| Replay success after confirmed execution | Automated test ✅ (contract-level) |
| Failed replay provenance gating | Automated test ✅ (contract-level) |

## Next Steps

1. **Broader command coverage** — validate built-in panel commands ("open recent", "open widget manager") within the panel family
2. **`isLikelyNavigateCommand` cleanup** — remove from arbiter entry seam or deprecate
3. **Commit** — all changes still uncommitted
