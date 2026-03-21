# Stage 6x.8 Phase 5 — Duplicate Panel Instance Identity: Phases 1-3 Implementation Report

**Date:** 2026-03-21
**Design doc:** `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-duplicate-panel-instance-identity-addendum.md`

## Summary

Implemented the foundation layer for generic duplicate panel instance identity. This replaces the Links-only badge system with a shared contract that any duplicable panel family can adopt.

Three phases completed:
1. **Phase 1: Inventory** — classified all built-in panel families as singleton or duplicable
2. **Phase 2: Contract** — created the authoritative family map and registry integration
3. **Phase 3: Creation-time assignment** — shared allocator, migration with backfill, all creation paths wired

## Changes

### New files

| File | Purpose |
|------|---------|
| `lib/dashboard/duplicate-family-map.ts` | Authoritative `panel_type` → family mapping. Single source of truth for which panel types share a duplicate namespace. |
| `lib/dashboard/instance-label-allocator.ts` | Shared family-scoped label allocator (A-Z, gap-fill, fail-closed at 26). Replaces Links-only badge logic. |
| `migrations/074_instance_label.up.sql` | Adds `instance_label` + `duplicate_family` columns, backfills Links + Navigator, family-scoped unique index |
| `migrations/074_instance_label.down.sql` | Reverse migration |

### Modified files

| File | Change |
|------|--------|
| `lib/panels/panel-registry.ts` | Added `isDuplicable(panelType)` method delegating to family map |
| `app/api/dashboard/panels/route.ts` | Replaced Links-only badge logic with shared allocator; 409 overflow response |
| `app/api/entries/create-for-workspace/route.ts` | Replaced Links-only badge counter with shared allocator; 409 overflow response |
| `app/api/entries/[entryId]/seed-dashboard/route.ts` | Replaced Links-only badge counter with shared allocator; 409 overflow response |
| `app/api/dashboard/panels/reset-layout/route.ts` | Wired shared allocator; 409 overflow response |

### Test files

| File | Tests |
|------|-------|
| `__tests__/unit/dashboard/duplicate-family-map.test.ts` | 10 tests: family lookup, panel-type grouping, consistency |
| `__tests__/unit/dashboard/instance-label-allocator.test.ts` | 10 tests: allocation, gap-fill, cross-type family, overflow, singleton, transactional client |

## Design Decisions

### Single source of truth

The family map (`duplicate-family-map.ts`) is the only authority for family identity. No `duplicateFamily` field on `PanelChatManifest` — that would create two sources of truth with drift risk. If Phases 4-7 need manifest-level family metadata, it can be added then with an alignment test.

### Family-scoped uniqueness

The allocator queries by `duplicate_family` column, not `panel_type`. This prevents `links_note/A` and `links_note_tiptap/A` from coexisting in the same workspace. The DB unique index `ux_workspace_panels_family_instance_label` on `(workspace_id, duplicate_family, instance_label)` enforces this at write time, preventing concurrent allocation conflicts.

### Fail-closed overflow

All 26 labels used → allocator throws → route returns HTTP 409 with specific message. No unlabeled rows in adopted families. This applies consistently across all four creation paths.

### Backfill strategy

- **Links Panels**: `instance_label` copied from existing `badge` column. Both columns stay in sync during the compatibility phase.
- **Navigator**: Labels assigned by `created_at ASC, id ASC` ordering. Migration fails if any workspace has >26 navigator instances (safety check).

## Family Classification

| Family ID | Panel types | Status | Instance token |
|-----------|-------------|--------|---------------|
| `quick-links` | `links_note`, `links_note_tiptap` | Adopted | `badge` + `instance_label` |
| `navigator` | `navigator` | Adopted | `instance_label` |
| `recent` | `recent` | Needs classification | None |
| `continue` | `continue` | Deferred | None |
| `widget-manager` | `widget_manager` | Deferred | None |
| `quick-capture` | `quick_capture` | Deferred | None |

## Test Results

- `duplicate-family-map.test.ts`: 10/10 passing
- `instance-label-allocator.test.ts`: 10/10 passing
- Type-check: clean
- Pre-existing failure: `panel-registry.test.ts` hardcodes `expect(allTypes.length).toBe(5)` — unrelated stale assertion

## What This Enables

Phases 1-3 create the structural foundation. They do NOT change runtime behavior for duplicate panel addressing. What they enable for Phases 4-7:

- **Prompt rules** can teach the LLM about instance tokens for any adopted family, not just Links
- **Deterministic extraction** can parse "navigator b" using registry-backed family metadata
- **Resolver** can target exact instances by `instance_label` across families
- **Known-noun routing** can defer to clarification for duplicate-aware families
- **Snapshots** can expose instance labels for grounding and selection

## Remaining Work

1. **Phases 4-7** — prompt, parser, resolver, known-noun adoption, snapshot alignment
2. **Stale test fix** — `panel-registry.test.ts` hardcoded count (unrelated, optional cleanup)
3. **Links compatibility cleanup** — eventual migration of Links from `badge`-only to `instance_label`-only (follow-up, not blocking)
