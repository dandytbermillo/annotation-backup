# Implementation Report: Panel D/E Soft-Active Selection Routing Fix

**Date**: 2026-02-02
**Feature slug**: `chat-navigation`
**Commit**: `2416f9c0` ("the panel e/d issue fixed")
**Status**: COMPLETED — verified via manual test (screenshot evidence)

---

## Summary

Fixed the bug where typing "panel e" (or "panel d") failed to resolve after an intervening explicit command cleared the active option set. The root cause was two-fold:

1. **Tier 3a fallback only matched ordinals** — `isSelectionOnly()` catches "first", "2", "d" but NOT shorthand like "panel e" or "links panel d".
2. **Tier 4.5 deterministic matcher failed on verb-prefixed inputs** — `resolveUniqueDeterministic()` tokenized the full input including verbs ("open", "pls"), producing tokens not present in candidate labels, causing token-subset matching to fail and fall through to LLM.

## Problem Scenario (Before Fix)

1. User types "open recent panel" → Tier 2a fires, shows disambiguation list (Panel D, Panel E, Panel F)
2. User types "panel d" → Tier 3a matches via `isSelectionOnly` (badge "d") → opens Panel D correctly
3. `handleSelectOption` fires → clears `lastClarification` but does NOT clear `activeOptionSetId`
4. User types "open panel e" → `isExplicitCommand()` returns true (contains "open") → Tier 2a clears `activeOptionSetId` and `pendingOptions`
5. Tier 3a fallback block requires `activeOptionSetId !== null` → skipped (it's now null)
6. Falls to Tier 4.5 → `resolveUniqueDeterministic` receives "open panel e", tokenizes to `["open", "panel", "e"]`, but "open" is not in any candidate label tokens → no unique subset match → falls to LLM

The LLM happened to resolve correctly (making the test pass visually), but routing was **not deterministic**.

## Changes

### Fix 1: `lib/chat/routing-dispatcher.ts` (+45 lines)

**Location**: After line 1288 (within Tier 3a message-derived fallback block)

Added `findExactOptionMatch()` call as a secondary matcher when `isSelectionOnly()` fails. This function was already defined in the codebase but was not wired into the Tier 3a fallback path.

```typescript
// Tier 3a (cont.): Label/shorthand matching for message-derived options
const labelMatch = findExactOptionMatch(ctx.trimmedInput, lastOptionsMessage.options)
if (labelMatch) {
  ctx.setPendingOptions(lastOptionsMessage.options)
  const optionToSelect: SelectionOption = { ... }
  ctx.handleSelectOption(optionToSelect)
  return { handled: true, handledByTier: 3, tierLabel: 'label_match_from_message', ... }
}
```

**What it covers**: When `activeOptionSetId` is still set and `isSelectionOnly` doesn't match, `findExactOptionMatch` catches shorthand like "panel e" via label contains/startsWith/exact matching against the message-derived options list.

**Debug log action**: `label_match_from_message` (tier 3a)

### Fix 2: `lib/chat/grounding-set.ts` (+5 lines, -1 line)

**Location**: Line 330–337 in `resolveUniqueDeterministic()`

Added verb-prefix stripping before token-subset matching so that "open panel e" becomes "panel e" before tokenization.

```typescript
// Before (broken):
const inputTokens = tokenize(normalized)

// After (fixed):
const verbStripped = normalized
  .replace(/^(pls\s+|please\s+)?(open|show|view|go\s+to|launch|list|find)\s+/i, '')
  .trim()
const inputTokens = tokenize(verbStripped || normalized)
```

**Verb patterns stripped**: `open`, `show`, `view`, `go to`, `launch`, `list`, `find` — optionally preceded by `pls` or `please`.

**Fallback**: If stripping produces an empty string, falls back to the original `normalized` input.

## How the Two Fixes Interact

The fixes cover two different routing paths for the same scenario:

| Scenario | `activeOptionSetId` | Path | Fix |
|---|---|---|---|
| "panel e" typed while options still active | non-null | Tier 3a → `findExactOptionMatch` | Fix 1 |
| "open panel e" typed (Tier 2a clears activeOptionSetId) | null | Tier 4.5 → `resolveUniqueDeterministic` with soft-active options | Fix 2 |
| "pls open panel d" typed | null | Tier 4.5 → `resolveUniqueDeterministic` with soft-active options | Fix 2 |

## Pre-existing Code That Survived Revert

The following code was already in place (wired in a prior session) and was NOT part of this fix:

- `saveLastOptionsShown()` calls at option-creation sites in `chat-routing.ts` (lines 401, 465, 2309, 4293)
- `hasSoftActiveSelectionLike` guard in `known-noun-routing.ts` (lines 596–598) — prevents Tier 4 from consuming soft-active selection-like inputs so Tier 4.5 can handle them
- `SOFT_ACTIVE_TURN_LIMIT = 2` and `incrementLastOptionsShownTurn` in `chat-navigation-context.tsx`

## Files Modified

| File | Lines Changed | Purpose |
|---|---|---|
| `lib/chat/routing-dispatcher.ts` | +45 | Tier 3a label/shorthand matching fallback |
| `lib/chat/grounding-set.ts` | +5, -1 | Verb-prefix stripping in deterministic resolver |

## Files Created (Plan Documents)

| File | Purpose |
|---|---|
| `docs/proposal/chat-navigation/plan/panels/chat/meta/widget-registry-implementation-plan.md` | Widget registry architecture plan (Phase 2, not yet implemented) |
| `docs/proposal/chat-navigation/plan/panels/chat/meta/widget-ui-snapshot-plan.md` | UI snapshot schema and routing rules spec |

## Verification

### Manual Test (Screenshot Evidence)

All 5 steps of the test scenario succeeded:

1. "open recent panel" → disambiguation list shown (D, E, F)
2. "panel d" → Panel D opened
3. "open recent panel" → disambiguation list shown again
4. "pls open panel d" → Panel D opened
5. "open panel e" → Panel E opened

### Debug Log Analysis

Post-fix debug logs showed:
- Steps 4–5 hit `explicit_command_bypass` (Tier 2a), then `grounding_set_built` (Tier 4.5)
- Before Fix 2: `resolveUniqueDeterministic` failed, fell to LLM (non-deterministic)
- After Fix 2: verb stripping enables deterministic token-subset matching

### Type Check

Not run in this session. Should be verified:
```bash
npm run type-check
```

## Risks / Limitations

1. **Verb-strip regex is not exhaustive** — Only covers common verbs. Uncommon phrasings like "navigate to panel e" or "switch to panel e" won't be stripped. These will still fall through to LLM resolution (which works, just not deterministic).

2. **Fix 1 order dependency** — `findExactOptionMatch` runs after `isSelectionOnly` in the Tier 3a block. If both could match, `isSelectionOnly` wins. This is intentional (ordinal selection is more precise).

3. **No automated test coverage** — Both fixes are in routing paths that lack unit tests. Regression risk exists if the fallback block structure changes.

## Next Steps

1. **Run type-check** to confirm no type errors introduced
2. **Widget Registry Implementation** (Phase 2) — Create `lib/widgets/ui-snapshot-registry.ts` and `lib/chat/ui-snapshot-builder.ts` per the implementation plan
3. **Add unit tests** for `resolveUniqueDeterministic` verb stripping and `findExactOptionMatch` in Tier 3a
4. **TTL increment consistency** — Minor: standardize soft-active turn decrement policy across all call sites
