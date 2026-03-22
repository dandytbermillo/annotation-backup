# Stage 6x.8 Phase 5 — Duplicate-Family Memory-Exact Replay Fix

## Summary

Fix the information-loss bug where Phase 5 replay rows for duplicate-family panel opens drop selector identity. Make `open_panel` replay rows **selector-aware** so explicit instance queries ("open links panel b", "open navigator d") can become Memory-Exact while generic queries ("open links panel", "open navigator") still clarify.

## Problem

Phase 5 replay works for singleton panel opens (`widget_manager`, `recent`, `continue`) but fails for explicit duplicate-family panel opens such as:

- `open links panel a`
- `open links panel b`
- `open navigator c`

Observed behavior:
- first turn succeeds
- later exact repeats still show `Auto-Executed`
- they do not become `Memory-Exact`

This is **not** the generic hidden-panel issue (already fixed) and **not** primarily a known-noun duplicate-deferral issue. The main failure is that replay rows lose the selector identity that made the original query safe.

## Root Cause

### 1. Resolver/open path knows the exact duplicate instance

The resolver already has the selector identity at execution time:

- Quick Links exact badge path returns `semanticPanelId: quick-links-a` etc.
- Generic duplicate-family path accepts `instanceLabel` for Navigator-family targeting.

So the system **does know** when the user explicitly asked for a specific duplicate instance.

### 2. Phase 5 writeback drops selector identity

`buildPhase5NavigationWritePayload(...)` stores only `panelId` and `panelTitle` for `open_panel` rows. The stored replay row does **not** preserve:
- `duplicateFamily`
- `instanceLabel`
- whether the original query was instance-specific (`selectorSpecific`)

### 3. Validator is forced to use a coarse family-level ambiguity rule

`validateMemoryCandidate(...)` rejects any duplicate-family `open_panel` row when multiple visible siblings exist. That is correct for generic queries but wrong for instance-specific ones — the validator cannot tell the difference.

## Decision

Fix the replay contract by making duplicate-family `open_panel` rows **selector-aware**, not just target-aware.

- Do **not** remove the ambiguity guard
- Do **not** special-case Links Panels only
- Do **not** rely on `panelId` alone

## Scope

**In scope:**
- Phase 5 writeback shape for `open_panel`
- Phase 5 replay validation for duplicate-family rows
- Focused tests for Links Panels and Navigator exact-instance replay

**Out of scope:**
- Hidden-panel lifecycle (already fixed)
- Chat-controlled hide/show mutations
- Tier 4 known-noun writeback parity (documented follow-up)

**Scope boundary:** This plan guarantees selector-aware replay for **verb-form panel opens** ("open links panel a", "show navigator c") which go through the grounding tier or navigate API. Bare exact known-noun commands ("links panel a", "quick links a") go through Tier 4 known-noun routing, which does not emit Phase 5 writebacks — that is a separate parity gap.

## Implementation Plan

### Phase 1: Extend `open_panel` Memory Row Contract

**File:** `lib/chat/routing-log/memory-write-payload.ts`

Extend `slots_json` for `open_panel` rows with duplicate-selector metadata when available:

```typescript
// Only write selector metadata for panels in a duplicate family
if (resolution.panel?.duplicateFamily) {
  slotsJson.duplicateFamily = resolution.panel.duplicateFamily
  slotsJson.instanceLabel = resolution.panel.instanceLabel ?? undefined
  slotsJson.selectorSpecific = resolution.panel.selectorSpecific ?? false
}
```

**Rule:** `duplicateFamily`, `instanceLabel`, `selectorSpecific` are written ONLY for duplicate-family panels. Singleton rows have none of these fields.

**Critical:** `selectorSpecific` is NOT derived from `!!instanceLabel`. It's a separate signal indicating the **user explicitly named an instance**. A panel can have `instanceLabel: 'C'` even for a generic "open navigator" query (because only one instance was visible). `selectorSpecific` must come from the request intent, not the resolved panel row.

### Phase 2: Preserve Selector Metadata at Writeback Time

#### 2a. Server writeback (navigate route)

**File:** `app/api/chat/navigate/route.ts`

Forward `duplicateFamily`, `instanceLabel`, and `selectorSpecific` from successful `open_panel_drawer` resolutions.

**`selectorSpecific` derivation (server path):**
- For Quick Links: `!!intent.args?.quickLinksPanelBadge || !!extractQuickLinksInstanceLabel(userMessage)`
- For generic duplicate-family: `!!intent.args?.instanceLabel`
- For singletons: omitted

Uses **structured intent signals first**, falling back to deterministic text extraction as a safety net.

#### Shared Quick Links extractor

**File:** `lib/chat/ui-helpers.ts`

```typescript
export function extractQuickLinksInstanceLabel(input: string): string | null {
  return extractLinkNotesBadge(input)
    || extractInstanceLabel(input, 'quick links')
    || extractInstanceLabel(input, 'quick link')
}
```

Covers all Quick Links alias forms: "links panel a", "quick links a", "quick link a". Used by BOTH server and client paths.

#### 2b. Client writeback (grounding path)

**File:** `components/chat/chat-navigation-panel.tsx`

Look up selector metadata from `visibleWidgets`:

```typescript
const matchedWidget = uiContext?.dashboard?.visibleWidgets?.find(w => w.id === gp.panelId)
const family = matchedWidget?.duplicateFamily
let userNamedInstance = false
if (family === 'quick-links') {
  userNamedInstance = !!extractQuickLinksInstanceLabel(trimmedInput)
} else if (family) {
  userNamedInstance = !!extractInstanceLabel(trimmedInput, family)
}
```

**Dependency:** Migration 074 backfilled `instance_label` for all Quick Links from `badge`.

#### Resolver integration seams

**File:** `lib/chat/intent-resolver.ts`

- Add `duplicateFamily` + `instanceLabel` to `IntentResolutionResult` and `DrawerResolutionResult`
- Forward from all `open_panel_drawer` return sites: Quick Links exact badge, Quick Links single-panel, generic duplicate-family exact, generic single-sibling, drawer fallback, `resolveShowQuickLinks`

### Phase 3: Update Replay Validator

**File:** `lib/chat/routing-log/memory-validator.ts`

New 4-rule selector-aware validation:

1. If stored panel is hidden (not in visibleWidgets) → reject `target_panel_hidden`
2. If row has NO `duplicateFamily` in slots_json (legacy row) → fall back to current visibleWidgets-based family check
3. If row has `duplicateFamily` + `selectorSpecific !== true` (generic query) → reject `duplicate_family_ambiguous` if >1 visible sibling
4. If row has `duplicateFamily` + `selectorSpecific === true` (explicit instance) → allow if visible panel matches stored selector, reject `target_panel_selector_mismatch` if not

### Phase 4: Replay Reconstruction (No Change)

`memory-action-builder.ts` stays unchanged. `navigationReplayAction` is still `{ type: 'open_panel', panelId, panelTitle }`. Selector metadata is for validation only.

### Phase 5: Focused Tests

**File:** `__tests__/unit/chat/phase5-duplicate-instance-routing.test.ts`

#### Writeback shape
1. Explicit instance ("open links panel a") → `selectorSpecific: true`, `instanceLabel: 'A'`, `duplicateFamily: 'quick-links'`
2. Singleton ("open widget manager") → no `duplicateFamily`, no `instanceLabel`, no `selectorSpecific`
3. **Critical:** Generic query resolves to labeled instance → `instanceLabel: 'C'` but `selectorSpecific: false`

#### Validator behavior
4. Selector-specific + matching → **valid** (Memory-Exact allowed)
5. Generic row + siblings → `duplicate_family_ambiguous`
6. Selector-specific + hidden → `target_panel_hidden`
7. Selector-specific + mismatch → `target_panel_selector_mismatch`
8. Legacy row + siblings → `duplicate_family_ambiguous`
9. **Critical:** Labeled but non-specific + siblings → `duplicate_family_ambiguous`

#### Quick Links alias coverage
10. `extractQuickLinksInstanceLabel("open links panel a")` → `"A"`
11. `extractQuickLinksInstanceLabel("open quick links a")` → `"A"`
12. `extractQuickLinksInstanceLabel("open quick link a")` → `"A"`
13. `extractQuickLinksInstanceLabel("open links panel")` → `null`

## Files to Change

| File | Change |
|------|--------|
| `lib/chat/ui-helpers.ts` | Add `extractQuickLinksInstanceLabel` shared helper |
| `lib/chat/routing-log/memory-write-payload.ts` | Add selector fields to `open_panel` slots_json |
| `lib/chat/intent-resolver.ts` | Add `duplicateFamily` + `instanceLabel` to resolution types and all return sites |
| `app/api/chat/navigate/route.ts` | Forward selector metadata in server writeback |
| `components/chat/chat-navigation-panel.tsx` | Derive selector from `visibleWidgets` in client writeback |
| `lib/chat/routing-log/memory-validator.ts` | Selector-aware 4-rule validation |
| `__tests__/unit/chat/phase5-duplicate-instance-routing.test.ts` | Writeback + validator + extractor tests |

## Verification

1. `npm run type-check`
2. `npx jest --testPathPattern "phase5-duplicate-instance"` — focused tests
3. `npx jest --testPathPattern "phase5-|content-intent-dispatcher"` — regression
4. Manual: "open links panel b" → Auto-Executed → repeat → Memory-Exact
5. Manual: "open links panel" (generic) → still clarifies
6. Manual: hide Links Panel A → "open links panel a" → does NOT replay

## Acceptance Criteria

1. Explicit duplicate-instance queries become Memory-Exact on repeat
2. Generic duplicate-family queries still clarify
3. Hidden panels are still rejected
4. Singleton panels are unaffected
5. Legacy rows without selector metadata fall back to current behavior
6. `selectorSpecific` is derived from the user's query, not the panel row

## Follow-ups

1. **Legacy row self-upgrade** — UPSERT should refresh `slots_json` on conflict so pre-fix rows don't require manual deletion
2. **Known-noun writeback parity** — Tier 4 known-noun deterministic panel opens don't emit Phase 5 writebacks

## Anti-Pattern Applicability

`isolation-reactivity-anti-patterns.md`: **not applicable**. This is a replay-contract and validation fix, not an effect dependency / React isolation issue.
