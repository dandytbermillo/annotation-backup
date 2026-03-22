# Stage 6x.8 Phase 5 — Duplicate Panel Instance Identity: Phases 4-7 Implementation Report

**Date:** 2026-03-21
**Design doc:** `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-duplicate-panel-instance-identity-addendum.md`
**Foundation report:** `docs/proposal/chat-navigation/reports/2026-03-21-stage6x8-phase5-duplicate-instance-identity-phases1-3-implementation.md`

## Summary

Implemented the routing adoption layer for the generic duplicate panel instance identity framework. Navigator is the validated adopter alongside the existing Links Panel badge system.

Phases covered:
- **Phase 4**: Typed contracts + prompt rules + visible-widget rendering
- **Phase 5**: Deterministic extraction + resolver duplicate-family branch
- **Phase 6**: Known-noun routing duplicate-aware deferral
- **Phase 7**: Navigator snapshot registration + visible-widgets metadata propagation
- **Gap 1 fix**: B1 replay validator rejects `open_panel` rows for duplicable families with multiple visible siblings

## Adopted Families

| Family ID | Panel types | Status |
|-----------|-------------|--------|
| `quick-links` | `links_note`, `links_note_tiptap` | Adopted (existing badge system, unchanged) |
| `navigator` | `navigator` | Adopted (new, runtime-proven) |

Singletons (not duplicable): `widget_manager`, `continue`, `recent`, `quick_capture`.

## Changes

### Phase 4a: Typed contracts

| File | Change |
|------|--------|
| `lib/chat/intent-schema.ts` | Added `instanceLabel` to panel_intent args schema |
| `lib/panels/panel-manifest.ts` | Added `instanceLabel` to `PanelIntentArgs` |
| `lib/dashboard/panel-registry.ts` | Added `instanceLabel` + `duplicateFamily` to `WorkspacePanel` + `createDefaultPanel` |
| `app/api/dashboard/panels/route.ts` (GET) | SELECT + return `instance_label`, `duplicate_family` |
| `app/api/dashboard/panels/[panelId]/route.ts` | SELECT + return new columns (GET + PATCH) |

### Phase 4b-4d: Prompt rules

| File | Change |
|------|--------|
| `lib/chat/intent-prompt.ts` | Generic duplicate-instance rule; `instanceLabel` example in visible-widget instruction; render `instance: X` suffix in visible-widget listing |

### Phase 5: Extraction + resolver

| File | Change |
|------|--------|
| `lib/chat/ui-helpers.ts` | `extractInstanceLabel(input, familyTitle)` with slug normalization; `applyInstanceLabelOverride(intent, userMessage)` helper |
| `lib/chat/intent-resolver.ts` | Duplicate-family branch in `resolveDrawerPanelTarget` using `duplicate_family` column; import `getDuplicateFamily` |
| `app/api/chat/navigate/route.ts` | Deterministic `instanceLabel` extraction override via `applyInstanceLabelOverride` |

### Phase 6: Known-noun routing

| File | Change |
|------|--------|
| `lib/chat/known-noun-routing.ts` | `getKnownNounFamily()` helper; visible sibling deferral for duplicable families with >1 sibling |

### Phase 7: Snapshots + types

| File | Change |
|------|--------|
| `lib/chat/panel-command-matcher.ts` | Extended `VisibleWidget` type with `instanceLabel` + `duplicateFamily` |
| `lib/chat/intent-prompt.ts` | Updated `UIContext.dashboard.visibleWidgets` type |
| `lib/chat/resolution-types.ts` | Updated `ResolutionContext.visibleWidgets` type |
| `lib/chat/known-noun-routing.ts` | Updated `KnownNounRoutingContext.visibleWidgets` type |
| `lib/chat/state-info-resolvers.ts` | Updated visible widget types |
| `components/dashboard/DashboardView.tsx` | Removed `.slice(0, 10)` limit; propagate `instanceLabel` + `duplicateFamily` from panel data |
| `components/dashboard/panels/EntryNavigatorPanel.tsx` | Added snapshot registration lifecycle; pass `badge={panel.instanceLabel}` to `BaseDashboardPanel` |

### Gap 1 fix: B1 replay validator

| File | Change |
|------|--------|
| `lib/chat/routing-log/memory-validator.ts` | `open_panel` rows rejected when stored panel belongs to duplicable family with >1 visible sibling (`duplicate_family_ambiguous`); `revalidateMemoryHit` forwards `visibleWidgets` |
| `lib/chat/routing-dispatcher.ts` | Both B1 and B2 validation call sites pass `visibleWidgets` |
| `components/chat/chat-navigation-panel.tsx` | Commit-point revalidation passes `visibleWidgets` |

### Cleanup

| File | Change |
|------|--------|
| `lib/dashboard/duplicate-family-map.ts` | Narrowed to `quick-links` + `navigator` only |
| `migrations/075_adopt_widget_manager_continue.up.sql` | Changed to cleanup: clears stale `instance_label`/`duplicate_family` from singleton families |

## Test Coverage

### `__tests__/unit/chat/phase5-duplicate-instance-routing.test.ts` (23 tests)

- **Extractor** (10): slug normalization, case-insensitive, multi-letter rejection, edge cases
- **Override helper** (5): LLM omits label → injects; existing label preserved; non-panel unchanged; slug panelId works
- **Resolver** (4): explicit label → exact instance; 1 sibling → direct; 2+ siblings → clarification; invalid label → not found
- **B1 validator** (4): duplicable family >1 sibling → `duplicate_family_ambiguous`; 1 sibling → valid; no visibleWidgets → valid (backward compat); non-panel nav → valid

### `__tests__/unit/dashboard/duplicate-family-map.test.ts` (12 tests)

- Family lookup for all panel types
- `getPanelTypesForFamily` for all families
- Map consistency round-trip

### `__tests__/unit/dashboard/instance-label-allocator.test.ts` (10 tests)

- Allocation, gap-fill, cross-type family, overflow, singleton, transactional client

## Runtime Proof

### Navigator with duplicates
- "open navigator" → "Multiple navigator panels found" + 4 clarification pills (LLM-Clarifier)
- Repeated "open navigator" → consistent clarification (not stale Memory-Exact)

### Continue / Widget Manager (singletons)
- Duplicate metadata cleaned up
- Extra instances removed from main dashboard
- Single instances open directly

### Links Panel (unchanged)
- Badge system continues working as before

## Known Limitations

1. **Gap 2 (deferred)**: Instance-aware visible disambiguation — "open navigator b" should open Navigator B directly, but the visible-panel matching/clarifier path is still title-driven. Pills show raw panel titles without instance labels. This is a usability improvement, not a correctness issue.

2. **Singleton enforcement (deferred)**: Widget Manager, Continue, and Recent can still be duplicated via the dashboard UI. The routing layer treats them as singletons, but the creation path doesn't block duplicates. This is a product-level UI guard, separate from the routing framework.

## Follow-ups

- Gap 2: Instance-aware visible-panel matching + pill labels with instance letters
- Singleton enforcement in panel creation UI/API for widget_manager, continue, recent
- Combined implementation report if Gap 2 is implemented in a follow-up session
