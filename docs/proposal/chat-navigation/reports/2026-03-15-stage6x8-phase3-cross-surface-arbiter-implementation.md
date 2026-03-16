# Stage 6x.8 Phase 3 — Cross-Surface Arbiter Implementation Report

**Date**: 2026-03-15
**Slice**: 6x.8 Phase 3
**Status**: Complete — note.read_content and note.state_info migrated through shared arbiter
**Plan**: `stage6x8-cross-surface-semantic-routing-plan.md`
**Contract**: `stage6x8-phase2-semantic-contract.md`
**Predecessor**: `2026-03-15-stage6x8-phase1-deterministic-tier-audit.md`

---

## Summary

Phase 3 replaces the 6x.7 anchored-note resolver with a cross-surface semantic arbiter that classifies uncertain turns into `surface × intentFamily` pairs. Two note families are migrated:

- `note.read_content` → existing Stage 6 content pipeline (unchanged execution)
- `note.state_info` → new deterministic resolver from live UI state

The greeting-prefix bug (`DASHBOARD_META_PATTERN` blocking "hey pls summarize that note?") is fixed as part of this migration.

---

## What Was Implemented

### Greeting guard split (`content-intent-classifier.ts`)

`DASHBOARD_META_PATTERN` split into:
- `GREETING_PATTERN` — standalone greetings only (`/^(hello|hi|hey)\s*[.!?]?$/i`), classifier-only guard
- `META_ONLY_PATTERN` — true meta/help phrases, shared hard guard

New `isArbiterHardExcluded()` helper — checks input-level guards without requiring `activeNoteItemId`. Does NOT include `NOTE_NON_READ_PATTERN` so the arbiter can classify mutation verbs.

**Result**: "hey pls summarize that note?" reaches deterministic `SUMMARY_PATTERNS` directly. Standalone "hello" with active note reaches arbiter → ambiguous → safe clarifier.

### Cross-surface arbiter server route (`app/api/chat/cross-surface-arbiter/route.ts`)

- Gemini `gemini-2.0-flash`, `temperature: 0.1`, `maxOutputTokens: 200`
- 2000ms timeout via `Promise.race`
- Schema validation: surface enum, intentFamily enum, confidence 0-1, intentSubtype required for read_content
- Prompt classifies `surface × intentFamily` with optional `intentSubtype`

### Cross-surface arbiter client helper (`lib/chat/cross-surface-arbiter.ts`)

- `fetch('/api/chat/cross-surface-arbiter')` with 2500ms client timeout
- Returns raw response regardless of confidence (threshold applied in dispatcher)
- Validates `intentSubtype` for `read_content` decisions
- On timeout/error: `{ success: false }` — never throws

### State-info resolver (`lib/chat/state-info-resolvers.ts`)

Deterministic. No LLM. Pure function.

- Active note → "The open note is {title}."
- Multiple notes → "The active note is {title}. {N} notes are open."
- No note → "No note is currently open."

### Dispatcher wiring (`routing-dispatcher.ts`)

Replaced the entire 6x.7 resolver block (lines 1551-1717) with the arbiter path:

**Entry condition**: `isNoteRelated && !classifierMatch && !isArbiterHardExcluded`
- `isNoteRelated = activeNoteId || noteReferenceDetected`
- Note-reference pattern: `/\b(this|that|the|my|which|what|any|a)\s+(note|document|page)\b/i`

**Migrated-family gate**: `Set(['note:read_content', 'note:state_info'])`

**Outcome paths**:

| Path | Condition | Action |
|------|-----------|--------|
| Path 1: note.read_content | Migrated + above threshold + active note | Stage 6 handoff (executeS6Loop) |
| Path 1 (no anchor) | Migrated + above threshold + no active note | "No note is currently open." |
| Path 2: note.state_info | Migrated + above threshold | Deterministic resolver |
| Mutate | Any confidence | "I can't modify content yet." (never falls through) |
| Path 3: Non-migrated above threshold | Navigate, other surfaces | Fall through to existing routing |
| Path 4a: Migrated below threshold / ambiguous / unknown / timeout | — | Safe clarifier, early return |
| Path 4b: Non-migrated below threshold | — | Fall through to existing routing |

### Telemetry

5 new fields on `RoutingLogPayload`:
- `cross_surface_arbiter_called`
- `cross_surface_arbiter_surface`
- `cross_surface_arbiter_intent`
- `cross_surface_arbiter_confidence`
- `cross_surface_arbiter_result` (effective result after normalization)

Serialized in `routing-log/route.ts`. Threaded into `writeDurableEnforcementLog` for content early-return path via existing resolver telemetry pattern.

---

## Test Results

```
$ npm run type-check
→ zero errors

$ npx jest --testPathPattern "content-intent-classifier|content-intent-dispatcher|stage6-loop-route|stage6-loop-controller|routing-log/mapping"
→ 173/173 pass (5 suites)

Breakdown:
  content-intent-classifier: 53/53
  content-intent-dispatcher-integration: 33/33
  stage6-loop-route: 46/46
  stage6-loop-controller: 18/18
  routing-log/mapping: 25/25 (includes content_answered mapping)
```

### Test coverage

Coverage is consolidated into existing test files, not separate dedicated files:

- **Classifier tests** (`content-intent-classifier.test.ts`): greeting split, `isArbiterHardExcluded`, `META_ONLY_PATTERN`
- **Integration tests** (`content-intent-dispatcher-integration.test.ts` §7): arbiter content/state_info/navigate/mutate/ambiguous/timeout paths, telemetry observability, greeting-prefixed deterministic path

Dedicated `cross-surface-arbiter.test.ts` and `state-info-resolvers.test.ts` files were planned but coverage was consolidated into the above suites. This is a reporting deviation from the plan, not a coverage gap.

---

## Files Modified

### New files (3)
| File | Purpose |
|------|---------|
| `lib/chat/cross-surface-arbiter.ts` | Client helper for cross-surface semantic arbiter |
| `app/api/chat/cross-surface-arbiter/route.ts` | Server route (Gemini call + schema validation) |
| `lib/chat/state-info-resolvers.ts` | Deterministic note-state resolver |

### Modified files (6)
| File | Change |
|------|--------|
| `lib/chat/content-intent-classifier.ts` | Split `DASHBOARD_META_PATTERN`; add `isArbiterHardExcluded`; add `GREETING_PATTERN` classifier guard |
| `lib/chat/routing-dispatcher.ts` | Replace 6x.7 resolver block with arbiter + migrated-family gate + 6 outcome paths |
| `lib/chat/routing-log/payload.ts` | 5 arbiter telemetry fields |
| `app/api/chat/routing-log/route.ts` | Serialize arbiter telemetry |
| `lib/chat/stage6-loop-controller.ts` | Accept arbiter telemetry in `writeDurableEnforcementLog` (existing parameter) |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | §7 rewritten for arbiter; §4/§5 control tests updated |

---

## What This Fixes

1. **Greeting-prefix bug**: "hey pls summarize that note?" now reaches deterministic content classifier (no longer blocked by `DASHBOARD_META_PATTERN`)
2. **Natural phrasing for note content**: "explain about that note content", "tell me about that note" → arbiter classifies as `note.read_content` → Stage 6 answers
3. **Note state queries**: "which note is open?" → arbiter classifies as `note.state_info` → deterministic resolver answers from live UI state
4. **Mutation queries**: "edit this note" → arbiter classifies as `mutate` → immediate bounded not-supported response

## What This Does Not Change

- Stage 6 content pipeline (executeS6Loop, grounding, citations, surfacing) — unchanged
- Deterministic classifier fast path (SUMMARY/QUESTION/FIND_TEXT patterns) — unchanged
- Existing Tier 0-4 routing — unchanged
- `/api/chat/navigate` execute-intent path — unchanged
- Non-note surfaces (panel_widget, dashboard, workspace) — deferred to Phase 4

---

## Phase 2 Contract Compliance

| Contract item | Status |
|---|---|
| Arbiter schema (§1) | Implemented: `surface × intentFamily × confidence × reason × intentSubtype?` |
| Phase 3 entry rule (§2) | Implemented: note-related + not deterministic win + not hard-excluded |
| Migrated-family gate (§3) | Implemented: `note:read_content` and `note:state_info` |
| Stage 6 handoff (§4) | Implemented: classification only, executeS6Loop unchanged |
| State-info resolvers (§5) | Implemented: deterministic note resolver from uiContext |
| Confidence threshold (§6) | Implemented: 0.75 |
| Latency rule (§7) | Implemented: one arbiter call, no stacked LLM |
| Fallback policies (§8) | Implemented: unknown → clarifier, mutate → not-supported, ambiguous → clarifier |

---

## Next Steps

- **Phase 4**: Extend to panel_widget/dashboard/workspace state_info
- **Phase 5**: Telemetry evals across surfaces
- **6x.7 deprecation**: The anchored-note resolver code remains but is no longer called by the dispatcher. Can be removed in a cleanup pass.
