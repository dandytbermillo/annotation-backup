# Generic-Phrase Server-Side Guard + Stem-Matched Clarification

**Date:** 2026-03-30
**Slug:** chat-navigation
**Status:** Implemented, type-check clean, pending runtime verification of stem-matched option set

---

## Summary

Fixed four cascading issues with "open entries" (and other generic ambiguous panel phrases) producing incorrect behavior through the server-side intent-resolver:

1. **Blue "Auto-Executed" badge** — The navigate API returned `open_panel_drawer` (auto-open), bypassing all client-side generic-phrase guards.
2. **Single-option clarifier** — After fixing issue 1, the clarifier showed only 1 option ("Entries") because the content-token filter matched exact substrings only.
3. **All-panels clarifier (11 options)** — Overcorrection: showing ALL visible widgets made the clarifier useless.
4. **Fallback cliff + duplication + inconsistent server lanes** — The `> 1` stem-match threshold fell back to all visible widgets; stem logic was duplicated in 3 places; workspace/bare-name fallbacks used narrower `matchVisiblePanel(s)` instead of the shared stem builder.

---

## Root Cause Analysis

### Issue 1: Blue "Auto-Executed" Badge

**Symptom:** "open entries" intermittently produced a blue "Auto-Executed" badge, opening the Entries panel directly instead of showing a multi-option clarifier.

**Diagnostic trail:**
- Added `console.log` at `resolveIntent`, `resolvePanelIntent`, `resolveBareName`, and the navigate route.
- Console output confirmed: LLM classifies "open entries" as `panel_intent` with `panelId: 'navigator'`, `intentName: 'open_drawer'`.
- The call chain: `resolveIntent` → `resolvePanelIntent` → `resolveDrawerPanelTarget('navigator')` → duplicate-family resolution finds the Entries panel → returns `status: 'found'`.
- At `resolvePanelIntent` line 3000, `drawerResult.status === 'found'` triggered a direct `return { action: 'open_panel_drawer' }` — **without any `isGenericAmbiguousPanelPhrase` check**.

**Why previous guards didn't catch it:**
- Guard inside `resolveDrawerPanelTarget` (line 2822): placed in the "Dynamic fallback" section, which runs AFTER the duplicate-family resolution (lines 2743-2792). The family resolver returned early with `status: 'found'` before reaching the guard.
- Guard at `executePanelIntent` pass-through (line 3182): only handles results from `executePanelIntent()`, not from `resolveDrawerPanelTarget()`. The primary path at line 3000 returns before `executePanelIntent` is called.

**Flow diagram (before fix):**
```
resolvePanelIntent(panelId: 'navigator', intentName: 'open_drawer')
  ├─ shouldOpenDrawer = true
  ├─ resolveDrawerPanelTarget()
  │   ├─ NOT 'recent', NOT 'quick-links-*'
  │   ├─ duplicate-family resolution → finds Entries panel → status: 'found' ← EARLY RETURN
  │   └─ [Guard at line 2822 NEVER REACHED]
  ├─ drawerResult.status === 'found'
  └─ return { action: 'open_panel_drawer' }  ← NO GUARD HERE (was the bug)
```

### Issue 2: Single-Option Clarifier

**Symptom:** After fixing issue 1, "open entries" showed "Which panel did you mean?" with only 1 option: "Entries".

**Root cause:** `extractContentTokens('open entries')` → `['entries']` (after removing "open" filler). Title matching: `"Entries".toLowerCase().includes("entries")` = true, but `"Entry Navigator".toLowerCase().includes("entries")` = false. Only exact substring match, no singular/plural stem awareness.

### Issue 3: All-Panels Clarifier (11 Options)

**Symptom:** Overcorrection — removing the content-token filter showed ALL 11 visible widgets (Continue, Entries, Recent, Quick Capture, Entry Navigator, Widget Manager, Links Panel A, Links Panel B, entries Links Panel cc, Entry Navigator C, Entry Navigator D).

**Root cause:** Using all visible widgets without any relevance filtering.

### Issue 4: Fallback Cliff + Duplication + Inconsistent Lanes

**Symptoms (identified by reviewer):**
- `matchedWidgets.length > 1 ? matchedWidgets : allVisibleWidgets` — when stem matching yielded only 1 match, fell back to all visible widgets (reintroduced issue 3).
- Stem logic (`endsWith('ies')`, `endsWith('s')`) was duplicated verbatim in 3 places in `intent-resolver.ts` — drift risk.
- Workspace-not-found fallback (line 420) and `resolveBareName` fallback (line 2370) used `matchVisiblePanel`/`matchVisiblePanels` instead of stem-bounded matching — inconsistent candidate sets across server intent families.

---

## Changes

### `lib/chat/generic-phrase-guard.ts` — Shared stem helpers (NEW)

Extracted two shared functions used by all server-side guard sites:

```typescript
/**
 * Expand content tokens to singular/plural stems.
 * "entries" → ["entries", "entry"]  (ies → y)
 * "panels"  → ["panels", "panel"]  (trailing s)
 */
export function expandStems(contentTokens: string[]): string[]

/**
 * Build a stem-bounded candidate set from visible widgets.
 * Returns widgets whose title contains any expanded stem.
 * Never falls back to all visible widgets — returns as-is (even if 0 or 1).
 */
export function buildStemBoundedCandidates(
  rawInput: string,
  widgets: VisibleWidget[]
): VisibleWidget[]
```

### `lib/chat/intent-resolver.ts` — 5 guard sites, unified stem matching

All 5 sites now call `buildStemBoundedCandidates()`. No inline stem logic remains.

**Site 1: Primary `shouldOpenDrawer` guard (line ~2998)** — Critical fix

Wraps the `drawerResult.status === 'found'` return. Covers ALL resolution paths inside `resolveDrawerPanelTarget` (known patterns, duplicate-family, visibleWidgets, DB lookup). Generic phrase always terminates here: either `select` with stem candidates or `inform` with zero candidates. No fallthrough into `executePanelIntent`.

```typescript
if (drawerResult.status === 'found') {
  if (isGenericAmbiguousPanelPhrase(context.rawUserMessage)) {
    const stemCandidates = buildStemBoundedCandidates(rawMsg, visibleWidgets)
    if (stemCandidates.length > 0) {
      return { action: 'select', options: stemCandidates, ... }
    }
    // Zero candidates — still block auto-execute
    return { action: 'inform', message: "I'm not sure which panel you mean..." }
  }
  // Non-generic → auto-open is safe
  return { action: 'open_panel_drawer', ... }
}
```

**Site 2: Inner `resolveDrawerPanelTarget` guard (line ~2822)**

Inside the dynamic fallback section of `resolveDrawerPanelTarget`. Uses `buildStemBoundedCandidates` — returns `status: 'multiple'` with stem matches or `status: 'not_found'`.

**Site 3: `executePanelIntent` pass-through guard (line ~3168)**

Catches `open_panel_drawer` responses from panel handlers. Uses `buildStemBoundedCandidates` — returns `select` with stem candidates or `inform`.

**Site 4: Workspace-not-found fallback (line ~420)** — Updated

Previously used `matchVisiblePanel()` (single exact match → single-option clarifier). Now uses `buildStemBoundedCandidates()` for consistent stem-bounded candidate set.

**Site 5: `resolveBareName` visible-panel fallback (line ~2370)** — Updated

Previously used `matchVisiblePanels()` (exact normalized match). Now uses `buildStemBoundedCandidates()` for consistent stem-bounded candidate set.

**Stem-matching logic (shared via `buildStemBoundedCandidates`):**
```
Input: "open entries"
Content tokens: ["entries"]
Stems: ["entries", "entry"]  (ies → y rule)
Matched panels: Entries, Entry Navigator, Entry Navigator C, Entry Navigator D, entries Links Panel cc
Result: 5 options (multi-option clarifier)
```

### `app/api/chat/navigate/route.ts` — Diagnostic logging

Added `console.log` at navigate API entry point:
- Before `resolveIntent`: logs intent, panelId, name, userMessage
- After `resolveIntent`: logs action, success, panelId

### `lib/chat/intent-resolver.ts` — Diagnostic logging

Added `console.log` at:
- `resolveIntent` entry: intent, panelId, name, rawUserMessage
- `resolvePanelIntent` entry: panelId, intentName, rawUserMessage
- `resolveBareName` entry: name, rawUserMessage
- `resolveDrawerPanelTarget` entry: panelId, rawUserMessage
- `shouldOpenDrawer` guard: rawUserMessage, resolved panelId, panelTitle

---

## Diagnostic Findings

### Debug logging was silently disabled

`debugLog()` in `lib/utils/debug-logger.ts:81` is gated by `DEFAULT_DEBUG_LOGGING_ENABLED`, which requires `NEXT_PUBLIC_DEBUG_LOGGING=true`. Without this env var, server-side `debugLog()` calls produce zero rows in `debug_logs` table. Fixed by using raw `console.log` for diagnostic tracing.

### Navigate API and grounding LLM are separate concurrent paths

Console output revealed both `/api/chat/navigate` (1383ms) and `/api/chat/grounding-llm` (980ms) fire for the same "open entries" turn. The navigate API returns `open_panel_drawer` while the grounding pipeline returns `select` (blocked by client-side guard). When `dispatchRouting` returns `handled: false` (e.g., after bridge clears pending options), the navigate API response reaches the client and auto-executes.

### LLM consistently maps "open entries" to `panel_intent` with `panelId: 'navigator'`

Gemini intent classification returns `{ intent: 'panel_intent', panelId: 'navigator', intentName: 'open_drawer' }` for "open entries". The `navigator` panelId is resolved through duplicate-family resolution to the Entries panel UUID (`0517d545-5c1b-4de4-96ee-9fd96f590e58`).

---

## Verification

### Type-check
```bash
$ npm run type-check
# Clean — no errors from these changes.
# Pre-existing syntax error in __tests__/unit/use-panel-close-handler.test.tsx(87,1) is unrelated.
```

### Console verification (runtime-proven for Issues 1 & 2)

**Issue 1 fix verified:**
```
[intent-resolver] shouldOpenDrawer guard: blocking generic phrase auto-open {
  rawUserMessage: 'open entries',
  panelId: '0517d545-5c1b-4de4-96ee-9fd96f590e58',
  panelTitle: 'Entries'
}
[ChatNavigateAPI] resolveIntent result: { action: 'select', success: true, panelId: undefined }
```
Navigate API consistently returns `action: 'select'` instead of `action: 'open_panel_drawer'`. No blue "Auto-Executed" badge observed across 6 consecutive "open entries" attempts.

**Issue 2 verified (single option "Entries" only):**
Observed: "Which panel did you mean?" with single "Entries" option. Root cause confirmed: exact substring matching without stem awareness.

**Issue 3 observed (all 11 panels):**
After removing content-token filter: 11 options including Continue, Widget Manager, etc. Root cause confirmed: no relevance filtering.

**Issues 3 & 4 fixes (stem matching, shared helper, zero-candidate guard): pending runtime verification after server restart.**

Expected: "open entries" → 5 stem-matched options (Entries, Entry Navigator, Entry Navigator C, Entry Navigator D, entries Links Panel cc).

---

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `lib/chat/generic-phrase-guard.ts` | 59–89 | NEW: `expandStems()` (line 59) and `buildStemBoundedCandidates()` (line 79) shared helpers |
| `lib/chat/intent-resolver.ts` | ~2998–3027 | Site 1: Primary `shouldOpenDrawer` guard — stem candidates or `inform` terminator |
| `lib/chat/intent-resolver.ts` | ~2828–2839 | Site 2: Inner `resolveDrawerPanelTarget` guard → `buildStemBoundedCandidates` |
| `lib/chat/intent-resolver.ts` | ~3180–3195 | Site 3: `executePanelIntent` pass-through guard → `buildStemBoundedCandidates` |
| `lib/chat/intent-resolver.ts` | ~420–434 | Site 4: Workspace-not-found fallback → `buildStemBoundedCandidates` (was `matchVisiblePanel`) |
| `lib/chat/intent-resolver.ts` | ~2373–2388 | Site 5: `resolveBareName` fallback → `buildStemBoundedCandidates` (was `matchVisiblePanels`) |
| `lib/chat/intent-resolver.ts` | various | Diagnostic `console.log` at resolution entry points |
| `app/api/chat/navigate/route.ts` | ~1070 | Diagnostic `console.log` before/after `resolveIntent` |

---

## What Does NOT Change

- Client-side guards in `routing-dispatcher.ts` (grounding_llm_select, single_panel_auto_execute, stale-recovery, promotion gate)
- Client-side clarification intercept bridge in `chat-routing-clarification-intercept.ts`
- Scope-cue handler guard in `chat-routing-scope-cue-handler.ts`
- Surface resolver, seed set, bounded candidate arbitration
- "open recent" → Deterministic-Surface path (not affected)
- "open continue" → specific phrase, not generic (not blocked)

---

## Edge-Case Coverage

### Zero-candidate fallthrough — per-site behavior

Each guard site has different zero-candidate (stem matching returns 0) behavior:

| Site | Zero-candidate outcome | Safe? |
|------|----------------------|-------|
| Site 1: `shouldOpenDrawer` (line ~3006) | Returns `{ action: 'inform' }` — hard stop | Yes |
| Site 2: inner `resolveDrawerPanelTarget` (line ~2830) | Returns `{ status: 'not_found' }` — no drawer opened | Yes |
| Site 3: `executePanelIntent` pass-through (line ~3183) | Returns `{ action: 'inform' }` — hard stop | Yes |
| Site 4: workspace-not-found (line ~421) | Falls through to `{ action: 'error' }` at line ~437 | Yes |
| Site 5: `resolveBareName` (line ~2374) | Falls through to `panelMatches` logic (exact title match via `matchVisiblePanels`) | Low risk |

Site 5 is the only path where zero stem candidates don't produce a hard stop. It falls to `matchVisiblePanels` (exact normalized title match), which is unlikely to match a generic phrase but is structurally inconsistent with Site 1's terminator pattern. This is a known acceptable gap — exact title matching will not auto-execute "open entries" because `normalizePanelName("entries")` does not equal any panel's normalized title.

### Single-candidate behavior (accepted)

If stem matching yields exactly 1 panel (e.g., only one "Entry"-titled panel on the dashboard), the clarifier shows that 1 option as a confirmation. This is safer than auto-opening and avoids the all-widgets explosion. If product rejects one-option clarification in the future, the fix is to pad with tightly related family matches (not all visible panels).

---

## Risks / Limitations

1. **Stem matching is naive:** The `ies→y` and trailing-`s` rules handle "entries→entry" and "panels→panel" but won't handle irregular plurals (e.g., "indices→index"). Sufficient for current panel naming conventions.
2. **Diagnostic `console.log` statements remain:** Should be removed or gated behind a flag once runtime behavior is confirmed stable.

---

## Next Steps

- [ ] Runtime verify stem-matched option set after server restart
- [ ] Verify "open recent" → Deterministic-Surface (no regression)
- [ ] Verify "open continue" → opens Continue panel directly (not blocked)
- [ ] Remove diagnostic `console.log` after behavior is stable
