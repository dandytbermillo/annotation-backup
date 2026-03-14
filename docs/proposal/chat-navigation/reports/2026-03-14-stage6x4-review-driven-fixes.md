# Stage 6x.4 — Review-Driven Fixes

**Date**: 2026-03-14
**Scope**: Telemetry correctness, provenance normalization, test coverage
**Status**: All findings resolved, all tests passing
**Predecessor**: `2026-03-14-stage6x4-runtime-fixes-and-content-surfacing.md`

---

## Summary

After the content-answer surfacing was implemented and runtime-proven, a structured review identified 7 findings across 4 rounds. All findings were valid. This report documents the fixes applied in response.

---

## Round 1: Telemetry Gap and Provenance Badge Crash

### Finding 1.1 — High: Surfaced answer path bypassed durable S6 telemetry

**Problem**: The dispatcher called `executeS6Loop()` directly at `routing-dispatcher.ts:1480`, bypassing the controller wrappers (`runS6ShadowLoop`, `runS6EnforcementLoop`) that write durable log rows. The database entries shown during verification were from earlier shadow-mode runs, not from the surfaced-answer path.

**Fix**:
- Exported `writeDurableEnforcementLog` from `stage6-loop-controller.ts` (was private)
- Added `void writeDurableEnforcementLog(s6Params, loopResult)` to the surfaced-answer branch at `routing-dispatcher.ts:1494`

**Files**: `lib/chat/stage6-loop-controller.ts`, `lib/chat/routing-dispatcher.ts`

### Finding 1.2 — Low: Missing `_devProvenanceHint` caused badge crash

**Problem**: The return result from the content-answered branch had no `_devProvenanceHint`. The UI's `ProvenanceBadge` component looked up `PROVENANCE_STYLES['content_answered']` which didn't exist, crashing with `Cannot read properties of undefined (reading 'className')`.

**Fix**:
- Added `'content_answered'` to `ChatProvenance` type union at `chat-navigation-context.tsx:390`
- Added `content_answered` entry to `PROVENANCE_STYLES` in `ChatMessageList.tsx:35` (teal badge, "Content Answer" label)
- Set `_devProvenanceHint: 'content_answered'` on the dispatcher return at `routing-dispatcher.ts:1516`

**Files**: `lib/chat/chat-navigation-context.tsx`, `components/chat/ChatMessageList.tsx`, `lib/chat/routing-dispatcher.ts`

---

## Round 2: Provenance Semantics in Durable Log and Mapping

### Finding 2.1 — Low: Durable provenance was `s6_enforced:fallback` for content answers

**Problem**: `writeDurableEnforcementLog` computed provenance as `isExecuted ? 's6_enforced:<actionType>' : 's6_enforced:fallback'`. Since `content_answered` is not `action_executed`, successful content answers were logged as "fallback."

**Fix**: Added `isContentAnswered = result.outcome === 'content_answered'` check. Provenance is now:
```
's6_enforced:content_answered'  // for content_answered outcomes
's6_enforced:<actionType>'      // for action_executed outcomes
's6_enforced:fallback'          // for everything else
```

**File**: `lib/chat/stage6-loop-controller.ts:283-286`

### Finding 2.2 — Low: Generic routing-log mapping didn't handle `content_answered`

**Problem**: `provenanceToDecisionSource()` and `deriveResultStatus()` in `mapping.ts` had no case for `'content_answered'`. If the provenance flowed through `buildRoutingLogPayload()`, it would degrade to `decision_source: 'clarifier'` and `result_status: 'clarified'`.

**Fix**:
- `provenanceToDecisionSource('content_answered')` → `'llm'`
- `deriveResultStatus(true, 'content_answered', ...)` → `'executed'`

**File**: `lib/chat/routing-log/mapping.ts:60,96`

**Tests added** (2 new assertions in `mapping.test.ts`):
- `content_answered → llm` (decision source)
- `content_answered + handled → executed` (result status)

**Test result**: 25/25 pass

---

## Round 3: Durable `result_status` Still Wrong

### Finding 3.1 — Medium: Content-answered durable rows marked `failed`

**Problem**: Even after fixing provenance, `result_status` was computed from `isExecuted ? 'executed' : 'failed'` at `stage6-loop-controller.ts:309`. Content-answered rows got `provenance: 's6_enforced:content_answered'` but `result_status: 'failed'` — incoherent.

**Fix**: Changed to `(isExecuted || isContentAnswered) ? 'executed' : 'failed'`.

**File**: `lib/chat/stage6-loop-controller.ts:309`

### Finding 3.2 — Low: No controller test for content_answered durable rows

**Problem**: The mapping tests covered `content_answered`, but the controller's `writeDurableEnforcementLog` had no direct test verifying `provenance` and `result_status` for content-answered outcomes. Existing tests only covered `action_executed` (line 403) and `abort` (line 419).

**Fix**: Added test `'writes content_answered provenance and executed status for content answers'` to `stage6-loop-controller.test.ts`. Verifies:
- `provenance: 's6_enforced:content_answered'`
- `result_status: 'executed'`
- `s6_outcome: 'content_answered'`
- `s6_answer_outcome: 'answered'`
- `s6_answer_grounded: true`
- `s6_answer_cited_count: 2`

**File**: `__tests__/unit/chat/stage6-loop-controller.test.ts`

**Test result**: 18/18 pass

---

## All Files Modified (This Phase)

| File | Change |
|------|--------|
| `lib/chat/stage6-loop-controller.ts` | Exported `writeDurableEnforcementLog`; exported `executeS6Loop`; content_answered provenance; result_status fix |
| `lib/chat/routing-dispatcher.ts` | Added durable log call; set `_devProvenanceHint: 'content_answered'`; imported `writeDurableEnforcementLog` |
| `lib/chat/chat-navigation-context.tsx` | Added `'content_answered'` to `ChatProvenance` union |
| `components/chat/ChatMessageList.tsx` | Added `content_answered` to `PROVENANCE_STYLES` |
| `lib/chat/routing-log/mapping.ts` | Added `content_answered` to `provenanceToDecisionSource` and `deriveResultStatus` |
| `__tests__/unit/routing-log/mapping.test.ts` | 2 new tests for content_answered mapping |
| `__tests__/unit/chat/stage6-loop-controller.test.ts` | 1 new test for content_answered durable row |

---

## Test Results

```
$ npx jest --testPathPattern routing-log/mapping
→ 25/25 pass

$ npx jest --testPathPattern stage6-loop-controller
→ 18/18 pass

$ npm run type-check
→ zero errors
```

---

## Verification: Durable Log State After All Fixes

```sql
SELECT provenance, result_status, semantic_hint_metadata->>'s6_outcome' as outcome
FROM chat_routing_durable_log
WHERE semantic_hint_metadata->>'s6_outcome' = 'content_answered'
ORDER BY created_at DESC LIMIT 1;

-- Expected after fix:
-- provenance: s6_enforced:content_answered
-- result_status: executed
-- outcome: content_answered
```

---

## Cumulative Session Summary

This session (2026-03-14) implemented and hardened the following across 5 phases:

| Phase | Scope | Files |
|-------|-------|-------|
| Part 1: Infrastructure | Note/panel creation fixes (phantom `workspace_id` columns) | 11 files |
| Part 2: Gemini compat | Auto-fill `itemId`/`citedSnippetIds`, timeout/token increases | 2 files |
| Part 3: Answer surfacing | Await loop, surface answer in chat (partial 6x.5) | 2 files |
| Part 4: Telemetry + badge | Durable log on surfaced path, `content_answered` provenance | 5 files |
| Part 5: Normalization | Correct `result_status`, mapping coverage, controller test | 3 files |

**Total unique files modified**: 18 production files + 3 test files

**Test suites passing**:
- `stage6-loop-route`: 40/40
- `stage6-loop-controller`: 18/18
- `routing-log/mapping`: 25/25
- `content-intent`: 70/70
- Type-check: zero errors
