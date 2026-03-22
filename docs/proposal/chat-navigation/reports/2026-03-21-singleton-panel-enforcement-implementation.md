# Singleton Panel Enforcement — Implementation Report

**Date:** 2026-03-21

## Summary

Enforced singleton behavior for `widget_manager`, `continue`, and `recent` panel types. Only one instance of each is allowed per workspace. Enforcement is at both the API creation guard (409 rejection) and the Add Panel UI (disabled + "Already on dashboard" label).

## Changes

| File | Change |
|------|--------|
| `lib/dashboard/duplicate-family-map.ts` | Added `SINGLETON_PANEL_TYPES` allowlist + `isSingletonPanelType` helper; updated file header comments to clarify singleton vs duplicate-aware vs unclassified |
| `app/api/dashboard/panels/route.ts` | Added `panelTypeRegistry` import; singleton existence check before INSERT → 409 with descriptive message |
| `components/dashboard/PanelCatalog.tsx` | Added `existingPanelTypes` prop + `isSingletonPanelType` import; disables singleton types already present with "Already on dashboard" label; hides + icon |
| `components/dashboard/DashboardView.tsx` | Passes `existingPanelTypes` from panels state to PanelCatalog |

## Design Decisions

### Explicit allowlist (not inverse of family map)

`isSingletonPanelType` uses a hardcoded `Set(['widget_manager', 'continue', 'recent'])`. Not derived from the family map inverse, which would wrongly singletonize unclassified types like `note`, `quick_capture`, `demo`, `sandbox_widget`.

### Hidden panels count as existing

The API guard queries `deleted_at IS NULL` only — no `is_visible` check. A hidden singleton still blocks re-add. Policy: hide is not remove.

### UI/API alignment (Option B)

The UI uses visible panels from `DashboardView` state (no `includeHidden=true` fetch). A hidden singleton may appear enabled in the catalog — but the API returns 409, and the catalog surfaces the error message. Acceptable trade-off for the first pass.

## Test Coverage

### `__tests__/unit/dashboard/singleton-enforcement.test.ts` (8 tests)

- `widget_manager` → singleton
- `continue` → singleton
- `recent` → singleton
- `navigator` → NOT singleton (duplicable)
- `links_note` → NOT singleton (duplicable)
- `note` → NOT singleton (unclassified)
- `quick_capture` → NOT singleton (unclassified)
- Unknown type → NOT singleton

### Coverage gap (documented)

- API 409 guard: not directly unit-tested (requires DB mocking). Runtime-proven via manual API checks.
- PanelCatalog disabled state: not component-tested. Runtime-proven via screenshot.

## Runtime Proof

| Test | Result |
|------|--------|
| POST duplicate `continue` (visible) | 409 — "Continue already exists on this dashboard." |
| POST duplicate `continue` (hidden) | 409 — same (hidden counts as existing) |
| Add Panel UI: Continue, Recent, Widget Manager disabled | Confirmed (screenshot) |
| Add Panel UI: Navigator, Links Panel, Quick Capture still addable | Confirmed (screenshot) |

## Panel Classification Summary

| Panel type | Classification | Enforcement |
|------------|---------------|-------------|
| `links_note` / `links_note_tiptap` | Duplicable (quick-links family) | Instance labels A-Z |
| `navigator` | Duplicable (navigator family) | Instance labels A-Z |
| `widget_manager` | Singleton | Max 1 per workspace |
| `continue` | Singleton | Max 1 per workspace |
| `recent` | Singleton | Max 1 per workspace |
| `quick_capture` | Unclassified | No enforcement |
| `note` | Unclassified | No enforcement |
| Others | Unclassified | No enforcement |
