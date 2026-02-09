# Tier 2c + Tier 4 Panel Disambiguation Fix

**Date:** 2026-02-08
**Feature slug:** chat-navigation
**Plan:** `/Users/dandy/.claude/plans/wiggly-juggling-haven.md`

## Summary

Fixed a bug where "open links panel" on a dashboard with "Links Panels", "Links Panel D", and "Links Panel E" responded with "The Quick Links panel isn't available on the current dashboard" instead of triggering disambiguation.

**Root cause:** Two-tier conflict:
1. **Tier 2c** (`handlePanelDisambiguation`) failed because `normalizeToTokenSet("open links panel")` produced `{open, links, panel}` — the "open" token broke partial matching (panel titles don't contain "open").
2. **Tier 4** (`handleKnownNounRouting`) caught the input: stripped "open" → `"links panel"` → `KNOWN_NOUN_MAP["links panel"]` → Quick Links → not visible → "not available" with `handled: true` → blocked all downstream tiers including the LLM API call.

## Changes

### Step 1: Verb prefix stripping in Tier 2c (Primary — Rule 1: Deterministic first)

**File:** `lib/chat/panel-command-matcher.ts`

- Added `stripVerbPrefix()` exported function (lines 162-188) that strips leading action verb prefixes ("open", "show", "please open", "can you open", etc.) from user input before panel token matching.
- Applied `stripVerbPrefix(input)` to input in `matchVisiblePanelCommand` (line 211) so "open links panel" → "links panel" → tokens `{links, panel}` → Tier 2c produces partial matches against all 3 panels.
- Shared utility: both Tier 2c and Tier 4 can import from this single source.

### Step 1b: Single-match direct open in Tier 2c

**File:** `lib/chat/chat-routing.ts`

- Added `openPanelDrawer?: (panelId: string, panelTitle?: string) => void` to `PanelDisambiguationHandlerContext` interface.
- Fixed `setPendingOptionsMessageId` type from `(messageId: string) => void` to `(messageId: string | null) => void` — eliminates `as unknown as string` cast hack.
- Added single-match direct open block after the multi-panel disambiguation block: when `matchResult.matches.length === 1 && (type === 'partial' || type === 'exact')` and `openPanelDrawer` is available, opens the panel directly with confirmation message and state cleanup.
- When `openPanelDrawer` is not available, falls through safely (`handled: false`).

**File:** `lib/chat/routing-dispatcher.ts`

- Passed `openPanelDrawer: ctx.openPanelDrawer` to `handlePanelDisambiguation` call (line 1193).
- Removed `as (messageId: string) => void` cast on `setPendingOptionsMessageId` (line 1189).

### Step 2: Tightened Tier 4 fallthrough guard (Secondary — Rule 4: No hard-stop with downstream evidence)

**File:** `lib/chat/known-noun-routing.ts`

- Added import of `matchVisiblePanelCommand` from `@/lib/chat/panel-command-matcher`.
- Added tightened fallthrough guard in the `!realPanel` branch: only falls through (`handled: false`) when visible panels show ambiguous partial-match evidence (`partial && matches.length > 1`). Single matches and exact matches don't trigger fallthrough — they keep the existing "not available" behavior.
- Safety net for edge cases where Tier 2c misses but Tier 4's stale `KNOWN_NOUN_MAP` alias would otherwise hard-stop.

## Tests

### Unit tests — `__tests__/unit/chat/panel-command-matcher.test.ts` (12 new tests)

**stripVerbPrefix** (5 tests):
- strips "open " prefix
- strips "please open " prefix
- strips "can you open " prefix
- strips "show " prefix
- no-op when no verb prefix

**matchVisiblePanelCommand — verb prefix stripping** (4 tests):
- verb-prefixed input produces partial disambiguation (3 panels)
- verb-prefixed input with badge resolves exact (single panel)
- no visible match evidence when panel family absent
- single panel — partial match, length 1

**handlePanelDisambiguation — single-match direct open** (3 tests):
- Test E: single panel match opens directly via openPanelDrawer
- single match without openPanelDrawer falls through safely
- multi-panel match preserves existing disambiguation behavior

### Unit tests — `__tests__/unit/chat/known-noun-routing.test.ts` (4 new tests, new file)

- Test A: "open links panel" + 3 Links Panel variants → falls through (handled: false)
- Test B: "open quick links" + no Quick Links variants → "not available" (handled: true)
- Test C: "links panel d" + Links Panel D visible → opens directly (handled: true)
- Test D: "open links panel" + only Links Panel D → no ambiguous evidence, "not available"

### Integration tests — `__tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts` (2 new tests, new file)

- Test F: "open links panel" + single Links Panel D → Tier 2c opens directly (handledByTier: 2, tierLabel: 'panel_disambiguation'), Tier 4 never invoked
- "open links panel" + 3 Links Panel variants → Tier 2c disambiguates (handledByTier: 2), Tier 4 never invoked

## Verification

### Type check
```
$ npx tsc --noEmit
__tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005: ')' expected.
```
Only pre-existing error (unrelated to our work).

### Unit + Integration tests
```
$ npx jest __tests__/unit/chat/ __tests__/integration/chat/ --no-coverage --runInBand

Test Suites: 8 passed, 8 total
Tests:       247 passed, 247 total
Time:        0.377 s
```
All 247 tests pass across 8 suites. No regressions.

## Rule Compliance

| Rule | Compliance |
|------|-----------|
| 1. Deterministic first | Step 1 (verb stripping) makes Tier 2c catch multi-panel disambiguation deterministically |
| 2. Constrained LLM if unresolved | Step 2 fallthrough allows downstream constrained LLM for edge cases where Tier 2c misses |
| 3. Safe grounded clarifier on LLM fail | Unchanged — existing Tier 4.5/5 behavior preserved for fallthrough cases |
| 4. No hard-stop with downstream evidence | Step 2 prevents Tier 4 from returning `handled: true` when ambiguous panel evidence exists |
| 5. Explicit command escape paths | Tier 2a `isExplicitCommand` still detects and clears pending options; verb stripping is scoped to panel token matching only |

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/panel-command-matcher.ts` | Added + exported `stripVerbPrefix()` (~15 lines); applied to input in `matchVisiblePanelCommand` (1 line) |
| `lib/chat/chat-routing.ts` | Added `openPanelDrawer` to context; fixed nullable typing; added single-match direct open (~25 lines) |
| `lib/chat/routing-dispatcher.ts` | Passed `openPanelDrawer`; removed cast hack (2 lines) |
| `lib/chat/known-noun-routing.ts` | Added `matchVisiblePanelCommand` import; tightened fallthrough guard (~15 lines) |
| `__tests__/unit/chat/panel-command-matcher.test.ts` | 12 new tests |
| `__tests__/unit/chat/known-noun-routing.test.ts` | New file, 4 tests |
| `__tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts` | New file, 2 tests |

## Manual Test Cases

1. Dashboard with "Links Panels", "Links Panel D", "Links Panel E" → "open links panel" → disambiguation with 3 options (Tier 2c)
2. "open quick links" (no Quick Links on dashboard) → "not available" (Tier 4 preserved)
3. "links panel d" → opens Links Panel D directly (existing behavior preserved)
4. Dashboard with only "Links Panel D" → "open links panel" → opens Links Panel D directly (Tier 2c Step 1b)
5. "please show links panel" → same as #1 (verb prefix stripping handles polite variants)
