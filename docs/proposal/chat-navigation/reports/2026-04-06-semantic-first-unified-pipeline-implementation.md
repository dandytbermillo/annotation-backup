# Semantic-First Unified Pipeline — Implementation Report

**Date:** 2026-04-06
**Scope:** Active-clarifier bounded arbiter + semantic-first escape + B1 removal + no-clarifier convergence
**Status:** Phase 1 complete, Phases 2-4 pending

---

## Summary

This session implemented a unified semantic pipeline for the chat routing system. The system moved from 4 competing retrieval/execution lanes (B1 exact-memory, semantic hints, surface resolver, known-noun) to a single semantic retrieval system that serves both active-clarifier and no-clarifier modes. Surface-manifest validation and known-noun product rules are preserved as shared policy, not as independent routing lanes.

---

## Architecture Before

```
No-clarifier:
  1. B1 exact memory → direct execute (Memory-Exact)
  2. Surface resolver → direct execute (Deterministic-Surface)
  3. Stage 5 semantic replay → direct execute (Memory-Semantic)
  4. Known-noun → direct execute (Deterministic)
  5. LLM → execute (Auto-Executed)

Active-clarifier:
  1. B1 → escape evidence
  2. Surface → escape evidence
  3. Known-noun → escape evidence
  4. Semantic → escape evidence
  5. Bounded LLM arbiter → execute from all escape candidates
```

## Architecture After

```
Both modes — one shared pipeline:
  1. Semantic retrieval (lookupSemanticHints) → candidates (learned + curated seeds)
  2. B2 semantic lookup (lookupSemanticMemory) → candidates (learned rows)
  3. Merge into unified replay candidate pool (deduped, curated seeds bypass Gate 0)
  4. Active-panel item evidence (from widget snapshots)
  5. Note-sibling evidence (from note-command-manifest)
  6. Shared validation (manifest, visibility, container, duplicate-family, question guard)
  7. Rewrite-assisted re-query for typo/noise recovery

No-clarifier:
  - Strong safe winner → execute directly (Memory-Semantic)
  - Useful but not safe candidates → generate clarification from shared set
  - Empty set → downstream LLM (if also no safe winner → clarification)

Active-clarifier:
  - Escape candidates from unified pool → bounded arbiter decides
  - If one safe winner → Bounded-Selection
  - If useful but not safe → escape-only clarifier (replaces original, pauses it)
  - If unresolved → re-show clarification
```

---

## Slices Implemented

### Slice B2: Semantic-First Active-Clarifier Escape

**Commits:** `a68df028`, `450e6687`, `ecee02c5`, `57fd5256`, `2ebd34de`, `34199698`

**Changes:**
- Removed surface resolver and known-noun as active-clarifier escape lanes
- Semantic retrieval (`lookupSemanticHints`) is the sole escape evidence source
- Rewrite-assisted re-query for typo recovery (Gemini LLM, 1500ms timeout, one pass max)
- Concrete semantic execution via `selectedCandidate` (not `candidates[0]`)
- Manifest-based target resolution for curated seeds without concrete panel UUIDs
- Human-readable escape candidate labels (from `surfaceType`, not raw `intent_id`)
- `ConcreteEscapeAction` discriminated union narrowed to semantic + active_panel_item + note_sibling
- `EscapeEvidence` narrowed to semantic only (B1, surface, known-noun removed)
- `ExecutionSourceTag` and `_executionSource` for evidence-based provenance
- Pre-arbiter shared validation (question guard, visibility, duplicate-family)
- Escape paths return `handled: true` for proper propagation through `dispatchRoutingInner`

**Runtime verified:**
- "openn recent" during active clarifier → Bounded-Selection ✅
- "openn recent widget" → Bounded-Selection ✅
- "pls open that recent widget" → Bounded-Selection ✅
- "open budget100" during active clarifier → Bounded-Selection (active-panel item) ✅
- Post-escape resume ("from chat", "the first option from chat") → works ✅
- No-clarifier "open recent" → Deterministic-Surface (unchanged at that point) ✅

### Slice 4c/4d/4e: Active-Panel Item + Note-Sibling Candidates

**Commits:** `fc14b053`, `5cdac83a`

**Changes:**
- **4c:** Active-panel item evidence collection from widget snapshots during active clarification
  - Scoping ladder: scope cue → widgetSelectionContext → activeSnapshotWidgetId → all widgets
  - Manifest `execute_item` check (only eligible widget types)
  - Cross-widget ambiguity → clarify; within-widget duplicate labels → clarify
  - DB panel type mapping (`links_note_tiptap` → `links_panel`)
  - Execution via `execute_widget_item` action type
- **4d:** Note-sibling bounded candidates
  - Tier 4.2 (state-info) and 4.25 (navigate) gated by `hasLiveClarification` + rollout flag
  - Evidence stores full `resolvedCommand` for replay without re-resolving
  - Navigate replays via `_noteManifestNavigate` + `_resolvedNoteCommand`
  - State-info replays via `resolveNoteStateInfo()` with bounded provenance
- **4e:** Note-specific rollout gate (`NEXT_PUBLIC_NOTE_SIBLING_BOUNDED_ENABLED`)

### Semantic Execution Family Coverage

**Commit:** `8be9e441`

**Changes:**
- Added `open_entry`, `open_workspace`, `go_home` execution paths to active-clarifier semantic escape handler
- Tightened `open_entry` guard: requires `dashboardWorkspaceId` (no empty-string fallback)
- 4 dispatcher-level integration tests proving end-to-end execution
- `STAGE6_SHADOW_ENABLED` gate fix for semantic escape test infrastructure

### Slice B3: B1 / memory_exact Removal

**Commits:** `5a1cb4ad`, `c6d4b14b`, `4d890774`, `ea2054b6`

**Changes:**
- Deleted B1 lookup endpoint (`app/api/chat/routing-memory/lookup/route.ts`)
- Deleted `lookupExactMemory()` function (kept `MemoryLookupResult` type for `SemanticCandidate`)
- Removed entire B1 memory lookup block from dispatcher (~140 lines)
- Removed `buildRoutingLogPayloadFromMemory()` function
- Removed B1 from escape evidence, candidate injection, outer wrapper handler
- Removed `b1` from `EscapeEvidence` and `ConcreteEscapeAction`
- Removed `memory_exact` from `ChatProvenance`, `ExecutionSourceTag`, badge styles
- Replaced `memory_exact` with `memory_semantic` in `buildResultFromMemory` and all test assertions
- Added null guard in `ProvenanceBadge` for legacy `memory_exact` from older sessions
- Removed stale B1 test files (`memory-reader.test.ts`, `b1-note-manifest-cache.test.ts`)
- Analytics/schema compatibility preserved (`DecisionSource` type, DB schema keep `memory_exact` for existing logs)

### No-Clarifier Convergence Phase 1

**Commits:** `88c327fa`, `d3be99f2`, `bdfd4473`

**Changes:**
- **Unified candidate pool:** Merged B2 learned rows + Phase 5 curated seeds into one replay evaluation pool
- **Phase 5 moved before Stage 5:** `lookupSemanticHints` runs before Stage 5 evaluation so curated seeds are available
- **Gate 0 bypass for curated seeds:** `from_curated_seed === true` skips context fingerprint check
- **Surface resolver no longer executes directly** in no-clarifier mode — falls through to semantic pipeline
- **Stage 5 handles `surface_manifest_execute`:** `list_items` (API call + chat answer) and `open_surface` (panel drawer) execution paths
- **`surface_manifest_execute` in Stage 5 allowlist** and `buildResultFromMemory` handler
- **`validateMemoryCandidate`** recognizes `surface_manifest_execute` as valid action type
- **Selector-aware `open_panel` re-resolution:** Uses duplicateFamily + instanceLabel > singleton family > title match. Wrong-panel safety guard validates resolved title tokens against user input.
- **No-clarifier clarification-first rule:** When unified pool has useful candidates but no safe winner, generates clarification from shared candidates (not Auto-Executed)
- **Active-clarifier escape-only re-show:** When escape candidates exist during active clarification, replaces original clarifier with escape-only options, pauses original for resume
- **Active-clarifier escape uses unified pool (Step 1d):** Replaced separate Phase 5 `lookupSemanticHints` for escape evidence with unified replay pool conversion
- **Per-variant curated seeds:** links panel a/b/c/d, widget manager, open recent widget, open the recent widget
- **`TARGET_FAMILY` expanded:** recent, widget manager, demo added to `detectHintScope`

**Runtime verified:**
- "open recent" (no clarifier) → Memory-Semantic ✅
- "open links panel a/b" → Memory-Semantic ✅ (re-resolved by title/selector)
- "pls open widget manager" → Memory-Semantic ✅
- "can you pls open links panel b" (no clarifier, first time) → Safe Clarifier "Did you mean?" ✅
- "can you pls open links panel b" (no clarifier, after writeback) → Bounded-Selection ✅
- "can you pls open links panel b" (active clarifier, after writeback) → Bounded-Selection ✅ (Step 1d)
- "can you pls open links panel b" (active clarifier, first time) → escape-only "Did you mean?" ✅ (Step 1c)

---

## Plan Documents Created/Updated

| Document | Purpose |
|----------|---------|
| `lane-removal-capability-preservation-plan.md` | Parent architecture plan — one shared pipeline, capability preservation |
| `semantic-first-active-clarifier-escape-plan.md` | Semantic-first active-clarifier model (governs Slice B2) |
| `active-clarifier-bounded-candidate-flow.md` | Active-clarifier bounded candidate flow summary |
| `no-clarifier-convergence-plan.md` | No-clarifier convergence to shared semantic pipeline |
| `soft-marinating-hickey.md` (detailed plan) | Implementation-level detailed plan with Steps 1-1d, Phases 1-4 |

---

## Files Modified

### Runtime (19 files)

| File | Changes |
|------|---------|
| `lib/chat/routing-dispatcher.ts` | Unified replay pool, surface removal, Stage 5 handlers, escape evidence, clarification-first, active-panel item, note-sibling |
| `lib/chat/chat-routing-clarification-intercept.ts` | Escape candidate injection, buildConcreteEscapeAction, pre-arbiter validation, escape-only re-show |
| `lib/chat/chat-routing-types.ts` | ConcreteEscapeAction, EscapeEvidence, SelectedSemanticCandidate, ExecutionSourceTag narrowed |
| `lib/chat/chat-routing-arbitration.ts` | choiceId preservation for reroute decisions |
| `lib/chat/chat-navigation-context.tsx` | ChatProvenance updated (memory_exact removed) |
| `lib/chat/known-noun-routing.ts` | Shared validators exported (validateVisibility, validateDuplicateFamily, detectQuestionGuard) |
| `lib/chat/routing-log/stage5-evaluator.ts` | Allowlist expanded, Gate 0 curated seed bypass, visibleWidgets parameter |
| `lib/chat/routing-log/memory-action-builder.ts` | surface_manifest_execute handler, memory_semantic provenance |
| `lib/chat/routing-log/memory-validator.ts` | surface_manifest_execute validation |
| `lib/chat/routing-log/memory-reader.ts` | Narrowed to type-only (lookupExactMemory removed) |
| `lib/chat/routing-log/index.ts` | lookupExactMemory export removed |
| `components/chat/ChatMessageList.tsx` | memory_exact badge removed, ProvenanceBadge null guard |
| `components/chat/chat-navigation-panel.tsx` | memory_exact → memory_semantic provenance, _executionSource preference |
| `scripts/seed-phase5-curated-exemplars.ts` | Per-variant panel seeds, widget manager seed |
| `app/api/chat/routing-memory/lookup/route.ts` | **Deleted** (B1 endpoint) |

### Tests (6 files)

| File | Tests |
|------|-------|
| `bounded-arbiter-escape.test.ts` | 34 tests — escape builder, shared validation, semantic families, 4c/4d |
| `selection-intent-arbitration-dispatcher.test.ts` | 66 tests — dispatcher-level semantic execution, integration |
| `memory-action-builder.test.ts` | 16 tests — memory_semantic provenance |
| `note-manifest-memory.test.ts` | 14 tests — note manifest replay |
| `phase5-panel-registry-coverage.test.ts` | 40 tests — panel registry coverage |
| `stage5-shadow-telemetry.test.ts` | 38 tests — Stage 5 telemetry |
| **Total** | **208 tests passing** |

### Deleted Test Files

| File | Reason |
|------|--------|
| `memory-reader.test.ts` | Tests deleted `lookupExactMemory` |
| `b1-note-manifest-cache.test.ts` | Tests removed B1 note cache path |

---

## What's Removed

| Component | Status |
|-----------|--------|
| B1 exact-memory lookup (`lookupExactMemory`) | Deleted |
| B1 lookup API endpoint | Deleted |
| `memory_exact` provenance/badge | Removed |
| Surface resolver direct execution (both modes) | Removed |
| Known-noun escape evidence (active clarifier) | Removed |
| Surface escape evidence (active clarifier) | Removed |
| `__escape_b1_*` candidates | Removed |
| `__escape_surface_*` candidates | Removed |
| `__escape_known_noun_*` candidates | Removed |
| `buildRoutingLogPayloadFromMemory()` | Removed |
| 4 boolean escape flags (`_b1EscapeAction` etc.) | Replaced with `ConcreteEscapeAction` |

## What's Preserved

| Component | Status |
|-----------|--------|
| Surface-manifest definitions | Kept as validation/policy |
| Surface-manifest execution policies | Kept (open_surface, list_items, execute_item) |
| Known-noun product rules | Exported as shared validators |
| Semantic writeback/learning | Active |
| Analytics/schema compatibility | `DecisionSource` type and DB schema keep `memory_exact` for existing logs |
| No-clarifier known-noun routing | Still active at Tier 4 (Phase 2 pending) |
| `deterministic_surface` provenance | Still in code (Phase 3 pending) |

---

## Remaining Work (Phases 2-4)

### Phase 2: Known-Noun Convergence
- Remove known-noun direct execution at Tier 4
- Migrate trailing-? open-vs-docs, fuzzy near-match, unknown-noun fallback to shared pipeline

### Phase 3: Provenance Unification
- Remove `deterministic_surface` from `ChatProvenance` and badge styles
- Unify all successful replay under `memory_semantic`

### Phase 4: Cleanup
- Refactor surface resolver to manifest validation only
- Remove known-noun Tier 4 execution path
- Rebaseline tests for shared-pipeline behavior
- Remove diagnostic console.log statements

### Known Issues
- "show recent" resolves as `open_drawer` instead of `list_items` (seed ranking issue)
- `deterministic_surface` badge still shows for some no-clarifier paths that bypass Phase 5
- Some wrapper variants ("cn you open...") fall through to LLM due to `detectHintScope` pattern gaps

---

## Verification Commands

```bash
npm run type-check
npx jest __tests__/unit/chat/bounded-arbiter-escape.test.ts --no-coverage
npx jest __tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts --no-coverage
npx jest __tests__/unit/routing-log/memory-action-builder.test.ts --no-coverage
npx jest __tests__/unit/chat/note-manifest-memory.test.ts --no-coverage
npx jest __tests__/unit/chat/phase5-panel-registry-coverage.test.ts --no-coverage
npx jest __tests__/unit/chat/stage5-shadow-telemetry.test.ts --no-coverage
```

All 208 tests passing. Type-check clean.
