# Scope Trigger-Word Typo Correction — Implementation Report

**Date**: 2026-02-27
**Feature**: Trigger-word fuzzy matching in scope-typo replay resolver
**Scope**: Private `correctScopeTriggerTypo()` function, replay resolver integration, path 3a-ii, 6 integration tests
**Builds on**: scope-uncertain-detection-gap-fix (2026-02-26), scope-typo-clarifier-one-turn-replay (2026-02-26)

---

## Problem

When a user types `"rom active widget"` (typo for `"from active widget"`) as a reply to the scope-typo clarifier ("Did you mean: from active widget, from active panel, from chat?"), the replay resolver classified it as "unrelated" and cleared the pending state. The user's subsequent correct `"from active widget"` then had no pending to replay from, resulting in `"What would you like to find in the widget?"` instead of replaying the original intent.

### Debug Log Evidence

```
02:42:02 scope_cue_typo_gate — "open sample2 from actives widgets" → saved pending (turnCount=19)
02:42:12 scope_cue_typo_gate_unrelated — "rom active widget" → CLEARED pending (BUG)
02:42:20 scope_cue_widget_empty_after_strip — "from active widget" → standalone, no pending
```

### Root Cause

`resolveScopeCue()`, `detectScopeCueTypo()`, and `detectScopeTriggerUnresolved()` all require **exact** `"from"`/`"in"` trigger words (hardcoded at `input-classifiers.ts` lines 527, 603):

```typescript
if (trigger !== 'from' && trigger !== 'in') continue
```

`"rom"` (Levenshtein 1 from `"from"`) failed all three detectors, returning `scope: 'none'`. The replay resolver then hit path 3c (unrelated command guard) and cleared the pending state.

---

## Solution

Added **trigger-word fuzzy matching** scoped exclusively to the `pendingScopeTypoClarifier` replay resolver (clarifier-reply context). Never used in standalone routing.

### Design Principles

1. **Private function**: `correctScopeTriggerTypo` is module-private (not exported) — unreachable from normal routing or other modules
2. **Only corrects "from"**: `"in"` (2 chars) excluded — too many false positives
3. **Tightened replay criteria**: Replay only when corrected input resolves to `confidence === 'high'` AND `scope ∈ {chat, widget, dashboard, workspace}`
4. **Safety ladder preserved**: Replay returns `{ handled: false, replaySignal }` — goes through full routing chain

---

## Changes

### File 1: `lib/chat/chat-routing-clarification-intercept.ts`

#### New import (line 82)

```typescript
import { levenshteinDistance } from '@/lib/chat/typo-suggestions'
```

#### New private function (lines 84–135)

```typescript
function correctScopeTriggerTypo(input: string): {
  correctedInput: string
  originalTrigger: string
  correctedTrigger: string
} | null
```

**Rules**:
- Only corrects `"from"` (4 chars): Levenshtein ≤ 1, candidate first-token length ≥ 3
- `"in"` excluded entirely (too short for safe fuzzy matching)
- Only checks the **first token** (trigger position)
- Returns `null` if already exact (`"from"`/`"in"`) or no match — `dist > 0` guard
- Preserves original spacing of the rest of the input

**Coverage**:

| Input | Distance | Correction |
|-------|----------|------------|
| `"rom"` | 1 (delete 'f') | → `"from"` |
| `"fom"` | 1 (delete 'r') | → `"from"` |
| `"fron"` | 1 (sub m→n) | → `"from"` |
| `"frm"` | 1 (delete 'o') | → `"from"` |
| `"grom"` | 1 (sub f→g) | → `"from"` |
| `"froma"` | 1 (insert 'a') | → `"from"` |
| `"from"` | 0 (exact) | NOT corrected |
| `"run"` | 3 | NOT corrected |
| `"rm"` | — (length < 3) | NOT corrected |

#### Replay resolver modification (lines 291–322, 327–358)

**Trigger correction block** (lines 291–322): After `resolveScopeCue(candidate)` returns `scope: 'none'`, tries `correctScopeTriggerTypo(candidate)`. If corrected, re-runs `resolveScopeCue` on corrected input and updates `candidateScope`.

**Tightened path 3a** (line 328): Added `VALID_CONFIRMATION_SCOPES` whitelist guard:

```typescript
const VALID_CONFIRMATION_SCOPES = new Set(['chat', 'widget', 'dashboard', 'workspace'])
if (candidateScope.scope !== 'none' && candidateScope.confidence === 'high' && VALID_CONFIRMATION_SCOPES.has(candidateScope.scope)) {
  // → REPLAY
}
```

**New path 3a-ii** (lines 340–358): Handles trigger corrected + non-high scope (e.g., `"rom actve widgt"` where both trigger AND scope words are mangled):

```typescript
if (triggerCorrected && candidateScope.scope !== 'none' && candidateScope.confidence !== 'high') {
  // Show clarifier: "I think you're trying to specify a scope. Try..."
  // Does NOT create new pendingScopeTypoClarifier (prevents infinite loop)
}
```

#### Debug logs added

- `scope_cue_typo_gate_trigger_corrected` — emitted when trigger correction is attempted (includes original/corrected trigger, re-resolved scope and confidence)
- `scope_cue_typo_gate_trigger_corrected_low_confidence` — emitted when trigger was corrected but scope confidence is non-high (path 3a-ii)
- Enhanced existing `scope_cue_typo_gate_unrelated` and `scope_cue_typo_gate_non_confirmation` with `triggerCorrected` metadata

### File 2: `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts`

Added 6 integration tests in new `describe('dispatchRouting: trigger-word typo correction in replay')` block:

| Test | Input | Expected |
|------|-------|----------|
| 1 | `"rom active widget"` after pending | Trigger corrected, replay succeeds |
| 2 | `"fom active panel"` after pending | Trigger corrected, replay succeeds |
| 3 | `"fron chat"` after pending | Trigger corrected, replay with chat scope |
| 4 | `"rom actve widgt"` after pending | Trigger corrected, scope not high → clarifier re-shown |
| 5 | `"run active widget"` after pending | No correction (dist > 1), clears pending |
| 6 | `"from active widget"` after pending | Existing path 3a (no correction needed), replay |

---

## Modified Replay Resolver Flow

```
pendingScopeTypoClarifier is active
User types input
  │
  ├─ 1. TTL check (turn + 1 exactly) ── FAIL → clear, fall through
  ├─ 2. Drift check (fingerprint match) ── FAIL → clear, fall through
  └─ 3. Scope-based confirmation:
       │
       ├─ stripLeadingAffirmation(input)
       ├─ resolveScopeCue(candidate)
       │
       ├─ [NEW] If scope === 'none':
       │    └─ correctScopeTriggerTypo(candidate)
       │         ├─ Corrected → resolveScopeCue(correctedInput) → update candidateScope
       │         └─ Not corrected → no change
       │
       ├─ 3a:  scope ∈ VALID_SCOPES && confidence === 'high'
       │        → REPLAY (handled: false, replaySignal)
       │
       ├─ [NEW] 3a-ii: triggerCorrected && scope !== 'none' && confidence !== 'high'
       │        → Show scope hint clarifier (handled: true, no new pending)
       │
       ├─ 3b:  affirmed && !remainder → "Which scope?" (ambiguous yes)
       ├─ 3c:  isNewQuestionOrCommand && !affirmed → clear, fall through
       └─ 3d:  else → clear, fall through
```

---

## Safety Analysis

| Concern | Mitigation | Verified |
|---------|-----------|----------|
| Standalone execution with typo trigger | `correctScopeTriggerTypo` is **private** — defined at line 104, called only at line 298 inside `pendingScopeTypoClarifier` block. Grep confirms no exports or external imports. | ✓ |
| False positive corrections | Only `"from"` correctable (4 chars, distance ≤ 1). `"in"` excluded. Min length 3. | ✓ |
| Loose replay after correction | Tightened: `VALID_CONFIRMATION_SCOPES` whitelist + `confidence === 'high'` required | ✓ |
| Trigger + scope both mangled | Path 3a-ii shows one-shot clarifier, does NOT create new `pendingScopeTypoClarifier` | ✓ |
| Recursive replay | Depth guard at `routing-dispatcher.ts:1229` (`currentReplayDepth >= 1`). Re-invoked intercept has `pendingScopeTypoClarifier: null` (line 1294). | ✓ |
| `"rom"` parsed as affirmation | Not in `AFFIRMATION_TOKENS`. `stripLeadingAffirmation("rom ...")` returns `{ affirmed: false }` | ✓ |
| Feature flag | Entire path gated on `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1` — no new flag | ✓ |

---

## Verification

### Type-check

```bash
$ npx tsc --noEmit
# Only pre-existing error: __tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005
# No new errors from our changes
```

### Test results

```bash
$ npx jest --no-coverage __tests__/unit/chat/ __tests__/integration/chat/
# Test Suites: 37 passed, 37 total
# Tests:       933 passed, 933 total
```

All 6 new trigger-typo integration tests pass. All 137 selection-intent-arbitration tests pass (unit + integration combined).

### Debug log trace (from live test session)

After fix deployed, the replay flow works correctly:

```
02:42:26 scope_cue_typo_gate — "open sample2 from actives widgets" → saved pending
02:42:31 scope_cue_typo_gate_replay — "from active widget" → replayInput="open sample2 from active widget"
02:42:31 scope_cue_typo_gate_replay_dispatch → w_recent_widget → LLM select, confidence 0.9

02:43:01 scope_cue_typo_gate — "open summary144 from actives widgets" → saved pending
02:43:12 scope_cue_typo_gate_replay — "from active panel" → replayInput="open summary144 from active panel"
02:43:12 scope_cue_typo_gate_replay_dispatch → w_links_d → LLM select, confidence 1.0
```

---

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `lib/chat/chat-routing-clarification-intercept.ts` | +55 | Private `correctScopeTriggerTypo()`, import, trigger correction block, path 3a-ii, tightened 3a guard, enhanced debug logs |
| `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` | +120 | 6 integration tests for trigger-typo replay |

---

## Relationship to Prior Work

This report covers the **trigger-word typo correction** addition. It builds on three prior implementation phases:

1. **Widget Scope-Cue System** (2026-02-26): `resolveScopeCue()`, exact patterns, `handleScopeCuePhase`
2. **Scope-Typo Clarifier + One-Turn Replay** (2026-02-26): `pendingScopeTypoClarifier`, replay resolver, depth guard
3. **Scope-Uncertain Detection Gap** (2026-02-26): `scope_uncertain` confidence, `detectScopeTriggerUnresolved()`, SCOPE_VOCAB plurals
4. **Replay Resolver Reorder** (2026-02-26): Scope check before unrelated-command guard — fixed bare "from active widget" after clarifier

This phase adds **trigger-word fuzzy matching** (`"rom"` → `"from"`) as the final piece, addressing the gap where the scope trigger word itself is misspelled.
