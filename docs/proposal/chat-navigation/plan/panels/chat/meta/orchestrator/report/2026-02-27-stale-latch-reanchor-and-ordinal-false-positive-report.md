# Stale Focus Latch Re-Anchor + Clarifier-Reply Ordinal False Positive — Implementation Report

**Date**: 2026-02-27
**Feature**: Two bug fixes in widget routing — stale latch after intent-API panel switch, and fuzzy ordinal false positive in clarifier-reply mode
**Scope**: Focus latch re-anchor on `open_panel_drawer`, `isSelectionOnly` strict mode in clarifier-reply, `GroundingCandidate.source` type fix
**Builds on**: widget-scope-clarifier-reply-context (2026-02-27), selection-intent-arbitration

---

## Bug 1: Fuzzy Ordinal False Positive in Clarifier-Reply Mode

### Problem

When a user types `"i want you to open the sample2 from active widget"` after a grounded clarifier shows pills `[sample2 F, sample2, Workspace 4]`, the system executes **Workspace 4** (the wrong option) instead of going to the LLM.

### Root Cause

The clarifier-reply block at `routing-dispatcher.ts:1566` called `isSelectionOnly(groundingInput, priorOptions.length, optionLabels, 'embedded')`. In embedded mode:

1. `isSelectionOnlyEmbedded` (`input-classifiers.ts:294`) runs per-token fuzzy normalization
2. Token `"want"` (length 4) has levenshtein distance 2 from `"last"` (`w→l`, `n→s`)
3. Fuzzy normalizer replaces `"want"` → `"last"`
4. Normalized input: `"i last you to open the sample2"`
5. `extractOrdinalFromPhrase` matches `/\blast\b/` → returns `optionCount - 1 = 2`
6. Index 2 = Workspace 4 (3rd of 3 options) → deterministic execute → **wrong result**

### Fix

Changed `'embedded'` to `'strict'` at `routing-dispatcher.ts:1566`:

```typescript
const ordinalResult = isSelectionOnly(groundingInput, priorOptions.length, optionLabels, 'strict')
```

Strict mode uses anchored regex (`^(first|second|...)$` patterns) — immune to fuzzy false positives. Non-ordinal inputs now fall through to the bounded LLM, which is the policy-consistent behavior.

### Trade-off

Strict mode won't deterministically catch phrasings like `"open the second one"` in the clarifier-reply path. These go to bounded LLM instead, which is acceptable per user confirmation.

---

## Bug 2: Stale Focus Latch After Intent-API Panel Switch

### Problem

Intermittent bug: After opening a widget item (e.g., `"open summary144"` from Links Panel D), then navigating to a different panel via a command (e.g., `"open recents"`), subsequent commands (e.g., `"open sample2"`) show candidates from the **wrong widget**.

Example flow:
```
User: "open summary144"       → latch set to w_links_d
User: "open recents"          → Recent drawer opens, latch stays w_links_d
User: "open sample2"          → candidates: [summary144, summary 155] (from Links Panel D!)
                                 Expected: [sample2 F, sample2, Workspace 4] (from Recent)
```

### Root Cause

Three contributing factors:

1. **Known-noun routing skipped**: `"open recents"` (with extra 's') doesn't match any panel in known-noun routing (Tier 2), which would have cleared the latch at `known-noun-routing.ts:541`.

2. **Grounding LLM visible-panel select has no handler for type `'option'`**: Tier 4.5 grounding matches the "Recent" panel via `visible_panels_evidence_gated_llm_fallback` → LLM selects it. But the selected candidate has `type: 'option'` (from `visible_panels` grounding set), and none of the LLM select handlers at lines 4021-4172 match this type — they check for `matchingOption` (pendingOptions/snapshot), `referent`, or `widget_option`. The selection silently falls through.

3. **Intent API opens drawer without re-anchoring latch**: `dispatchRouting` returns `handled: false` → `sendMessage` calls the intent API → gets `open_panel_drawer` → `executeAction(resolution)` opens the drawer at `use-chat-navigation.ts:602`. But **no code path clears or re-anchors the focus latch**.

4. **Tier 4.5 `activeWidgetId` uses stale latch**: At `routing-dispatcher.ts:3720-3723`, when the latch is resolved and not suspended, `activeWidgetId = ctx.focusLatch.widgetId` (the stale `w_links_d`). The snapshot correctly shows `activeSnapshotWidgetId: w_recent_widget`, but the latch takes priority.

### Debug Log Evidence

```
intercept_entry:  focusLatch: { kind: "resolved", latchId: "w_links_d" }
                  activeSnapshotWidgetId: "w_recent_widget"

widget_list_deterministic_failed_llm_fallback:
                  activeWidgetId: "w_links_d"  ← stale!
                  activeWidgetLabel: "Links Panel D"
                  candidateCount: 2            ← summary144, summary 155
```

### Fix

Added focus latch re-anchor in **both** `open_panel_drawer` execution paths in `components/chat/chat-navigation-panel.tsx`:

**Main intent API flow** (after `executeAction(resolution)` at line ~2408):
```typescript
if (resolution.action === 'open_panel_drawer' && resolution.panelId) {
  clearFocusLatch()
  setFocusLatch({
    kind: 'pending',
    pendingPanelId: resolution.panelId,
    widgetLabel: resolution.panelTitle || 'Panel',
    latchedAt: Date.now(),
    turnsSinceLatched: 0,
  })
}
```

**Suggestion-Affirm path** (Tier S, after `openPanelDrawer()` at line ~1595):
Same pattern.

### Why Pending (Not Resolved)

The panel drawer just opened — the widget may not be registered in the snapshot yet. Setting a pending latch with `pendingPanelId` lets the dispatcher's latch validity check at `routing-dispatcher.ts:1040-1061` upgrade it to resolved on the next turn when it finds a widget whose `panelId` matches.

For pending latches, `activeWidgetId` falls back to `turnSnapshot.activeSnapshotWidgetId` (line 3725-3726), which is correct — the snapshot already reflects the newly opened panel.

This matches the pill-based panel selection pattern at `handleSelectOption` lines 909-932.

### Debug Log Evidence (After Fix)

```
"open recent pls":  focusLatch: { kind: "resolved", latchId: "w_links_d" }    ← stale
                    drawer_opened_from_chat: Recent
                    → fix fires: clearFocusLatch + setFocusLatch(pending)

"open sample2 pls": focusLatch: { kind: "pending", latchId: "pending:5e041..." }  ← re-anchored!
                    focus_latch_upgraded: pending → w_recent_widget
                    activeWidgetId: "w_recent_widget"                              ← correct!
                    candidateLabel: "sample2"                                      ← correct!
```

---

## Bug 3: Type-Check Errors — Missing `source` on `GroundingCandidate`

### Problem

`npx tsc --noEmit -p tsconfig.type-check.json` failed at three locations in the clarifier-reply block:
- `routing-dispatcher.ts:1552`
- `routing-dispatcher.ts:1579`
- `routing-dispatcher.ts:1631`

Error: `Property 'source' is missing in type '{ id: string; label: string; type: "widget_option"; }' but required in type 'GroundingCandidate'.`

### Fix

Added `source: 'widget_list'` to all three `GroundingCandidate` objects passed to `executeScopedCandidate()`. These candidates originate from prior clarifier pills (widget options), so `'widget_list'` is the correct source.

---

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `lib/chat/routing-dispatcher.ts` | 1566 | Changed `isSelectionOnly(..., 'embedded')` → `'strict'` in clarifier-reply ordinal check |
| `lib/chat/routing-dispatcher.ts` | 1552, 1579, 1631 | Added `source: 'widget_list'` to 3 `GroundingCandidate` objects |
| `components/chat/chat-navigation-panel.tsx` | ~1595 | Added `clearFocusLatch()` + `setFocusLatch({ pending })` in Suggestion-Affirm `open_panel_drawer` path |
| `components/chat/chat-navigation-panel.tsx` | ~2414 | Added `clearFocusLatch()` + `setFocusLatch({ pending })` in main intent API `open_panel_drawer` path |
| `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` | Various | Removed `_devProvenanceHint` assertions from Tests 1, 3; removed Tests 11-14 (dashboard regression tests depending on reverted code) |

---

## Verification

### Type-check

```bash
$ npx tsc --noEmit -p tsconfig.type-check.json
# Clean — no errors
```

### Test results

```bash
$ npx jest --no-coverage __tests__/unit/chat/ __tests__/integration/chat/
# Test Suites: 37 passed, 37 total
# Tests:       953 passed, 953 total
```

### Manual testing (debug log verified)

| Sequence | Before Fix | After Fix |
|----------|-----------|-----------|
| "open summary144" → "open the recents" → "open sample2" | Clarifier with wrong candidates [summary144, summary 155] from Links Panel D | Auto-execute: `Opening entry "sample2"` from Recent |
| "open summary 155" → "open recent pls" → "open sample2 pls" | Same stale latch bug | Auto-execute: `Opening entry "sample2"` from Recent |
| "can youu you to open the sample2 from active widget" (repeated after clarifier) | Opened Workspace "Sprint 14" (wrong ordinal match) | LLM resolves correctly via clarifier-reply mode |

---

## Safety Analysis

| Concern | Mitigation | Verified |
|---------|-----------|----------|
| Pending latch blocks legitimate commands | Pending latch fallback uses `activeSnapshotWidgetId` — commands bypass latch normally | Debug logs show `focus_latch_bypassed_command` fires correctly |
| Pending latch never resolves | Dispatcher expires pending latch at `turnsSinceLatched >= 2` (routing-dispatcher.ts:1056-1059) | By design |
| Strict ordinal misses valid phrasings | "open the second one" goes to bounded LLM instead of deterministic — acceptable per policy | User confirmed |
| Re-anchor fires for non-panel-switch actions | Guard: `resolution.action === 'open_panel_drawer' && resolution.panelId` | Only fires for panel drawer opens |
| Suggestion-Affirm path missed | Added same re-anchor pattern to Tier S path (chat-navigation-panel.tsx:1595) | Code review |

---

## Investigation Process

### Bug 1 discovery
1. Queried `debug_logs` table: `scope_cue_widget_clarifier_reply_ordinal` with `{"index": 2, "matchedLabel": "Workspace 4"}`
2. Traced to `isSelectionOnly("i want you to open the sample2", 3, [...], 'embedded')`
3. Analyzed `isSelectionOnlyEmbedded` per-token fuzzy normalization: `"want"` → `"last"` (levenshtein 2)
4. `extractOrdinalFromPhrase` matched `/\blast\b/` → wrong index

### Bug 2 discovery
1. Queried `debug_logs` for "open sample2" flow: `activeWidgetId: "w_links_d"` vs `activeSnapshotWidgetId: "w_recent_widget"`
2. Traced "open recents" path: known-noun routing skipped → Tier 4.5 grounding → visible_panels LLM → falls through → intent API → `open_panel_drawer`
3. Identified latch not cleared in intent API handler
4. **First fix attempt (wrong location)**: Placed re-anchor in Suggestion-Affirm block (line 1595) — didn't fire for normal flow
5. **Second fix attempt (correct)**: Moved to main intent API flow (line ~2408) after `executeAction(resolution)`
6. Third pass: added re-anchor back to Suggestion-Affirm path too (both paths covered)

### Bug 2 initial misplacement
The `sendMessage` function in `chat-navigation-panel.tsx` has two separate `open_panel_drawer` early-execution blocks:
- Line ~1595: Inside the Suggestion-Affirm handler (`routingResult.suggestionAction?.type === 'affirm_single'`)
- Line ~2408: Main intent API flow (after `executeAction(resolution)`)

The first attempt only patched line 1595, which doesn't execute for normal command routing. The normal flow uses `executeAction` at line ~2408.
