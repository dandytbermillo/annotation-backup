# Duplicate-Family Memory-Exact Replay Fix — Implementation Report

**Date:** 2026-03-22
**Design doc:** `/Users/dandy/.claude/plans/duplicate-family-memory-exact-fix.md`

## Summary

Fixed the information-loss bug where Phase 5 replay rows for duplicate-family panel opens dropped selector identity. Explicit instance queries like "open links panel b" and "open navigator d" can now become Memory-Exact on repeat, while generic queries like "open links panel" still clarify.

## Root Cause

The writeback stored only `panelId` + `panelTitle` in `slots_json` — no `duplicateFamily`, `instanceLabel`, or `selectorSpecific`. The validator saw the panel belonged to a duplicable family with >1 sibling and always rejected with `duplicate_family_ambiguous`, even for instance-specific queries.

## Changes

### Write payload

| File | Change |
|------|--------|
| `lib/chat/routing-log/memory-write-payload.ts` | Extended `open_panel` slots_json with `duplicateFamily`, `instanceLabel`, `selectorSpecific` (only for duplicate-family panels) |

### Resolver integration seams

| File | Change |
|------|--------|
| `lib/chat/intent-resolver.ts` | Added `duplicateFamily` + `instanceLabel` to `IntentResolutionResult`, `DrawerResolutionResult`, and all `open_panel_drawer` return sites (Quick Links exact badge, Quick Links single-panel, generic duplicate-family exact, generic single-sibling, drawer fallback) |

### Server writeback

| File | Change |
|------|--------|
| `app/api/chat/navigate/route.ts` | Server writeback forwards `duplicateFamily`, `instanceLabel`, `selectorSpecific` from resolution. `selectorSpecific` derived from intent signals (`quickLinksPanelBadge`, `instanceLabel`, `extractQuickLinksInstanceLabel`), not from panel row |

### Client writeback (grounding path)

| File | Change |
|------|--------|
| `components/chat/chat-navigation-panel.tsx` | Client writeback derives `duplicateFamily`/`instanceLabel` from `visibleWidgets` lookup; `selectorSpecific` from raw input text extraction |

### Shared Quick Links extractor

| File | Change |
|------|--------|
| `lib/chat/ui-helpers.ts` | Added `extractQuickLinksInstanceLabel` covering all alias forms: "links panel a", "quick links a", "quick link a" |

### Validator

| File | Change |
|------|--------|
| `lib/chat/routing-log/memory-validator.ts` | 4-rule selector-aware validation: (1) hidden → reject, (2) legacy row → old behavior, (3) generic family row → reject on siblings, (4) selector-specific → allow if matches, reject `target_panel_selector_mismatch` if not |

## Design Decisions

### `selectorSpecific` is derived from the query, not the panel

A panel can have `instanceLabel: 'C'` even for a generic "open navigator" query (because only one was visible). `selectorSpecific` indicates the **user explicitly named** the instance — derived from `intent.args.instanceLabel`, `intent.args.quickLinksPanelBadge`, or deterministic text extraction. Not from the resolved panel row.

### Selector metadata only for duplicate-family panels

Singleton rows (widget_manager, recent, continue) have no `duplicateFamily`/`instanceLabel`/`selectorSpecific` in slots_json. Only duplicate-family panels get these fields. This keeps payloads clean and makes the legacy-row fallback (Rule 2) work correctly.

### Legacy rows fall back to current behavior

Existing rows without `duplicateFamily` in slots_json use the old visibleWidgets-based family check. They don't suddenly become replayable — the guard is preserved. New rows written after this fix include selector metadata and get the new 4-rule validation.

### Stale rows don't self-upgrade

The UPSERT in `routing-memory/route.ts` increments `success_count` but doesn't refresh `slots_json`. Pre-fix rows remain stale until naturally replaced. This is a documented follow-up, not a blocker.

## Test Coverage

### `__tests__/unit/chat/phase5-duplicate-instance-routing.test.ts` (35 tests)

**Quick Links extractor (4 tests)**
- "links panel a" → "A"
- "quick links a" → "A"
- "quick link a" → "A" (singular)
- "links panel" → null

**Writeback shape (3 tests)**
- Explicit instance → `selectorSpecific: true`, `duplicateFamily`, `instanceLabel`
- Singleton → no selector fields
- Generic query to labeled instance → `selectorSpecific: false` despite `instanceLabel` present

**Validator (9 tests including 4 new selector-aware)**
- Selector-specific + matching → valid (Memory-Exact allowed)
- Generic row + siblings → `duplicate_family_ambiguous`
- Selector-specific + mismatched → `target_panel_selector_mismatch`
- Labeled but non-specific + siblings → `duplicate_family_ambiguous` (critical guard)
- Hidden target → `target_panel_hidden`
- Legacy row + siblings → `duplicate_family_ambiguous`

## Runtime Proof

| Query | Result |
|-------|--------|
| "open links panel b" | Memory-Exact on Turn 2 |
| "open links panel a" | Memory-Exact on Turn 2 |
| "open links panel c" | Memory-Exact on Turn 3 |
| "open entry navigator d" | Memory-Exact on Turn 3 |
| "open links panel" (generic) | Still clarifies (not replayed) |
| "open widget manager" (singleton) | Memory-Exact (unchanged) |

**Turn 2 vs Turn 3 variance:** Phase 5 writes are one-turn delayed. The pending write is promoted fire-and-forget (`void recordMemoryEntry(...)` at `routing-dispatcher.ts:1392`) before B1 lookup runs. Because the write is not awaited, Turn 2's B1 lookup may run before the promoted row is committed. Turn 3 reliably finds it. This is a nondeterministic async promotion race, not a correctness issue.

## Resolver Coverage Note

The important return sites now forward `duplicateFamily` + `instanceLabel`:
- Quick Links exact badge path (`resolveShowQuickLinks`)
- Quick Links single-panel path
- Generic duplicate-family exact instance + single-sibling paths
- `resolveDrawerPanelTarget` → `IntentResolutionResult` mapping
- Drawer fallback path

The panel-handler `open_panel_drawer` pass-through (from `executePanelIntent` result) does NOT forward these fields. That path is less common for duplicate-family panels but is a documented gap.

## Follow-ups

1. **Legacy row self-upgrade** — UPSERT should refresh `slots_json` on conflict so pre-fix rows don't require manual deletion. Currently increments `success_count` but doesn't update `intent_id`, `slots_json`, `target_ids`, or `risk_tier`
2. **Known-noun writeback parity** — Tier 4 known-noun deterministic panel opens don't emit Phase 5 writebacks (separate gap)
3. **Async promotion race** — Phase 5 pending write promotion is fire-and-forget. Memory-Exact may appear on Turn 2 or Turn 3 depending on DB commit timing. Not a correctness issue but a UX nondeterminism
