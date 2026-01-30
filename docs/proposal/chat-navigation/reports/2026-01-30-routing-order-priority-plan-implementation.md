# Implementation Report: routing-order-priority-plan.md

**Date:** 2026-01-30
**Plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/routing-order-priority-plan.md`
**Scope:** Unified routing priority chain — resolves priority conflicts between clarification, stop-scope, interrupt-resume, and known-noun routing plans

---

## Summary

Implemented the full routing-order-priority-plan.md, which defines a single canonical routing order (Tier 0–5) to eliminate "random" behavior caused by priority conflicts between multiple mini-plans. The implementation had three major phases:

1. **Dispatcher consolidation** — Moved all inline routing blocks from `sendMessage()` in `chat-navigation-panel.tsx` into `routing-dispatcher.ts` as explicit tiers.
2. **Tier 4 (Known-Noun Command Routing)** — Created `known-noun-routing.ts` with a static allowlist, fuzzy matching, and question-signal splitting.
3. **Safety guards** — Implemented the two plan-specific guards that enforce Tier 3's `activeOptionSetId` requirement and Tier 1's interrupt-paused ordinal rule.

---

## Changes

### Files Modified

| File | Lines Changed | Summary |
|------|--------------|---------|
| `lib/chat/routing-dispatcher.ts` | +1111 (new) | Single source of truth for all routing priority decisions. Contains Tiers 0–5 with explicit sub-tiers (2a–2g, 3a–3c). |
| `lib/chat/known-noun-routing.ts` | +592 (new) | Tier 4 handler: KNOWN_NOUN_MAP allowlist, `matchKnownNoun()` with suffix stripping, `findNounNearMatch()` with Levenshtein, question-signal splitting, `resolveToVisiblePanel()` for real panel ID lookup. |
| `lib/chat/query-patterns.ts` | +57 | Added `matchesShowAllHeuristic()` and `hasGraceSkipActionVerb()` (moved from panel inline). |
| `components/chat/chat-navigation-panel.tsx` | -759 / +32 | Removed 4 inline routing blocks and 5 helper functions (moved to dispatcher/query-patterns). Added `activeOptionSetId` state. |
| `lib/chat/chat-routing.ts` | +139 | Added Guard #2 (interrupt-paused ordinal guard) in POST-ACTION ORDINAL WINDOW block. |

### Total Diff (from plan creation to completion)

```
9 files changed, 2073 insertions(+), 759 deletions(-)
```

---

## Tier-by-Tier Implementation Status

### Tier 0 — Hard Interrupts / Safety ✅

| Plan Item | Status | Location |
|-----------|--------|----------|
| Explicit stop/cancel (clarification active) | ✅ | `chat-routing.ts` — clarification intercept, stop handler |
| Ambiguous stop/cancel (clarification active) | ✅ | `chat-routing.ts` — confirm exit path |
| Stop with no active clarification | ✅ | `chat-routing.ts` — STOP SCOPE RESOLUTION block |

### Tier 1 — Return / Resume / Repair ✅

| Plan Item | Status | Location |
|-----------|--------|----------|
| Return-cue (paused list) → deterministic | ✅ | `chat-routing.ts:1637` — `detectReturnSignal()` |
| Return-cue → LLM fallback | ✅ | `chat-routing.ts:1721` — constrained to return/not_return |
| Ordinal on paused list (`stop`) → blocked | ✅ | `chat-routing.ts:1929` — stop-paused ordinal guard |
| Ordinal on paused list (`interrupt`) → Guard #2 | ✅ | `chat-routing.ts:1952` — **NEW**: interrupt-paused ordinal guard checks "other list context active" |
| Repair phrases | ✅ | `chat-routing.ts:1879` — paused repair phrase handler |

**Guard #2 detail** (plan lines 55–62):
```typescript
// chat-routing.ts ~line 1952
if (clarificationSnapshot.pausedReason === 'interrupt') {
  const hasOtherActivePills = pendingOptions.length > 0
  const hasOpenDrawerList = !!(uiContext?.dashboard?.openDrawer)

  if (hasOtherActivePills || hasOpenDrawerList) {
    // Block — other list context active, ordinal might be for that
  } else {
    // Allow — paused list is the only plausible list
  }
}
```

"Other list context active" checks (per plan lines 59–62):
- ✅ Other visible option pills in chat → `pendingOptions.length > 0`
- ✅ Widget/panel showing a selectable list → `uiContext?.dashboard?.openDrawer`
- ⚠️ Another paused snapshot that has not expired → N/A (single snapshot slot in current architecture)

### Tier 2 — New Topic / Interrupt Commands ✅

| Plan Item | Status | Location |
|-----------|--------|----------|
| 2a: Explicit Command Bypass | ✅ | `routing-dispatcher.ts:424` |
| 2b: Cross-Corpus Retrieval | ✅ | `routing-dispatcher.ts:449` |
| 2c: Panel Disambiguation | ✅ | `routing-dispatcher.ts:472` |
| 2d: Doc Retrieval | ✅ | `routing-dispatcher.ts:498` |
| 2e: Follow-Up Handler | ✅ | `routing-dispatcher.ts:525` |
| 2f: Doc View Panel | ✅ | `routing-dispatcher.ts:563` |
| 2g: Preview Shortcut ("show all") | ✅ | `routing-dispatcher.ts:578` |

### Tier 3 — Clarification (active list only) ✅

| Plan Item | Status | Location |
|-----------|--------|----------|
| 3a: Selection-Only Guard (ordinals/labels) | ✅ | `routing-dispatcher.ts:695` |
| 3a (cont.): Fallback Selection (message-derived) | ✅ | `routing-dispatcher.ts:814` |
| 3b: Affirmation Without Context | ✅ | `routing-dispatcher.ts:869` |
| 3c: Re-show Options | ✅ | `routing-dispatcher.ts:901` |
| **Guard #1: `activeOptionSetId` check** | ✅ | `routing-dispatcher.ts:695` — **NEW** |

**Guard #1 detail** (plan line 81):
```typescript
// routing-dispatcher.ts:695
// Was: if (ctx.pendingOptions.length > 0)
// Now: if (ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null)
```

`activeOptionSetId` lifecycle:
- **Set** when any handler calls `setPendingOptionsMessageId(messageId)` — wired to `setActiveOptionSetId` in `chat-navigation-panel.tsx:443`
- **Cleared** when `setPendingOptionsMessageId(null)` is called (Tier 2a explicit command bypass, etc.)
- **Effect:** Old visible pills in history no longer trigger Tier 3 selection

### Tier 4 — Known-Noun Commands ✅

| Plan Item | Status | Location |
|-----------|--------|----------|
| Known-noun allowlist → execute deterministically | ✅ | `known-noun-routing.ts:39–80` — 22 entries mapping nouns to `{ panelId, title }` |
| Suffix/prefix normalization ("recent widget" → "recent") | ✅ | `known-noun-routing.ts:128–134` — strips trailing "widget"/"panel", leading "widget" |
| Near match → "Did you mean?" | ✅ | `known-noun-routing.ts:489–560` — Levenshtein distance ≤ 2 |
| Unknown noun fallback → prompt | ✅ | `known-noun-routing.ts:562–588` — "I'm not sure what X refers to" for short noun-like inputs |
| Known noun + trailing "?" → "Open or Docs?" | ✅ | `known-noun-routing.ts:338–416` — splits `isFullQuestionAboutNoun` vs `isTrailingQuestionOnly` |
| Full question ("what is X?") → skip to Tier 5 | ✅ | `known-noun-routing.ts:420–429` |
| Visible panel resolution (real DB ID lookup) | ✅ | `known-noun-routing.ts:271–305` — `resolveToVisiblePanel()` matches by title or panelType |
| Snapshot stays paused (no implicit resume) | ✅ | Dispatcher returns after Tier 4 — snapshot is untouched |

### Tier 5 — Docs / Informational Routing ✅

| Plan Item | Status | Location |
|-----------|--------|----------|
| Question signals → docs | ✅ | Falls through to LLM/doc routing when Tiers 0–4 don't handle |

---

## Acceptance Tests (Plan Lines 125–130)

| # | Test | Expected | Status | Evidence |
|---|------|----------|--------|----------|
| 1 | Stop + active list → confirm prompt (not noun routing) | Confirm prompt | ✅ | Tier 0 runs before Tier 4. Stop is checked first in `handleClarificationIntercept`. |
| 2 | "open recent" while list active → executes + pauses list | Execute + pause | ✅ | Tier 2a clears pending options; command proceeds through Tier 4 noun match (`"recent"`). |
| 3 | "links panel" (no verb, no list) → executes, not docs | Execute panel | ✅ | Tier 4 exact match → `resolveToVisiblePanel()` → `openPanelDrawer(realPanel.id)`. |
| 4 | "what is links panel?" → docs | Route to docs | ✅ | `isFullQuestionAboutNoun()` returns true → Tier 4 skips → falls to Tier 5. |
| 5 | "second option" after stop → blocked | Block + guidance | ✅ | `pausedReason === 'stop'` → ordinal blocked at `chat-routing.ts:1929`. |
| 6 | "back to options" after stop → restore list | Restore list | ✅ | Return signal handler at `chat-routing.ts:1637` restores paused list. |

---

## Validation

### Type-Check

```bash
$ npx tsc --noEmit
# Only pre-existing error: __tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005
# Zero errors in changed files:
#   - lib/chat/routing-dispatcher.ts ✅
#   - lib/chat/known-noun-routing.ts ✅
#   - lib/chat/query-patterns.ts ✅
#   - lib/chat/chat-routing.ts ✅
#   - components/chat/chat-navigation-panel.tsx ✅
```

---

## Known Limitations

1. **"Other list context active" — third condition**: The plan defines three conditions (visible pills, widget list, another paused snapshot). The third (another paused snapshot) is N/A since the current architecture has a single snapshot slot. If multiple snapshot support is added later, this guard needs updating.

2. **`activeOptionSetId` depends on callers**: Handlers must call `setPendingOptionsMessageId(messageId)` when presenting options. If a handler sets `pendingOptions` but forgets `setPendingOptionsMessageId`, Tier 3 won't activate. This is enforced by convention — all current handlers do call both.

3. **Known-noun panel resolution**: `resolveToVisiblePanel()` requires the panel to be visible on the current dashboard. If a known noun refers to a panel that exists but isn't visible (e.g., hidden by user), the handler shows "panel isn't available" instead of opening it. This is by design — you can't open a drawer for a non-visible panel.

---

## Architecture Diagram

```
sendMessage() in chat-navigation-panel.tsx
  │
  └──▶ dispatchRouting() in routing-dispatcher.ts
        │
        ├── handleClarificationIntercept()  ← Tier 0, 1, (partial 3)
        │     ├── Stop/cancel guards
        │     ├── Return-cue handler
        │     ├── Guard #2: interrupt-paused ordinal (NEW)
        │     ├── Repair phrase handler
        │     └── Post-action ordinal window
        │
        ├── Tier 2a: Explicit Command Bypass
        ├── Tier 2b: Cross-Corpus Retrieval
        ├── Tier 2c: Panel Disambiguation
        ├── Tier 2d: Doc Retrieval
        ├── Tier 2e: Follow-Up Handler
        ├── Tier 2f: Doc View Panel
        ├── Tier 2g: Preview Shortcut
        │
        ├── Tier 3a: Selection-Only Guard     ← Guard #1: activeOptionSetId (NEW)
        ├── Tier 3a (cont.): Fallback Selection
        ├── Tier 3b: Affirmation Without Context
        ├── Tier 3c: Re-show Options
        │
        ├── Tier 4: handleKnownNounRouting()  ← known-noun-routing.ts
        │     ├── Step 1: Known noun + "?" → Open or Docs?
        │     ├── Step 2: Full question → skip to Tier 5
        │     ├── Step 3: Exact match → open panel drawer
        │     ├── Step 4: Near match → "Did you mean?"
        │     └── Step 5: Unknown noun → fallback prompt
        │
        └── Tier 5: Falls through to LLM/doc routing
```

---

## Conclusion

The routing-order-priority-plan.md is fully implemented:
- The canonical routing order (Tier 0 → 1 → 2 → 3 → 4 → 5) is enforced in `routing-dispatcher.ts`.
- Both plan-specific safety guards are implemented (Guard #1: `activeOptionSetId`, Guard #2: interrupt-paused ordinal with "other list context" check).
- All 6 acceptance tests have valid execution paths through the code.
- Type-check passes with zero errors in changed files.
