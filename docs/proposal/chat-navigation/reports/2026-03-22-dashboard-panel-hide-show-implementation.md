# Dashboard Panel Hide/Show via Widget Manager — Implementation Report

**Date:** 2026-03-22

## Summary

Implemented a hide/show lifecycle for all dashboard panels via the Widget Manager. Hidden panels are excluded from chat routing (resolver, known-noun, Memory-Exact replay). Singletons remain blocked in Add Panel even when hidden.

## Scope

- **Active ↔ hidden lifecycle** for non-deleted panels (via `is_visible` toggle)
- **Trashed/deleted panels** remain managed by existing trash surfaces (Links Overview)

## Changes

### Widget Manager UI

| File | Change |
|------|--------|
| `components/dashboard/panels/WidgetManagerPanel.tsx` | "Dashboard Panels" section showing all panels (active + hidden) with Hide/Show buttons; self-protection for Widget Manager; dispatches `refresh-dashboard-panels` on actions |

### Hidden-Singleton Catalog Consistency

| File | Change |
|------|--------|
| `components/dashboard/DashboardView.tsx` | Fetches hidden-inclusive singleton types for PanelCatalog; re-fetches on `refresh-dashboard-panels` event; merged into `existingPanelTypes` |

### Resolver Visibility Filter

| File | Change |
|------|--------|
| `lib/chat/intent-resolver.ts` | Added `AND is_visible = true` to all 9 panel-instance queries in `resolveDrawerPanelTarget` and `resolveShowQuickLinks` |

Queries updated:
- `recent` panel lookup
- Quick-links family (all badges)
- Quick-links exact badge lookup
- Generic duplicate-family exact instance
- Generic duplicate-family sibling count
- Dynamic fallback: panel_type match
- Dynamic fallback: title match
- Dynamic fallback: fuzzy match
- `resolveShowQuickLinks` panel lookup

### Memory Validator Hidden-Panel Guard

| File | Change |
|------|--------|
| `lib/chat/routing-log/memory-validator.ts` | `open_panel` rows targeting non-visible panels rejected with `target_panel_hidden`; visibility check runs before duplicate-family ambiguity check |

## Design Decisions

### Hide = `is_visible = false` (not soft-delete)

Hide uses `PATCH { isVisible: false }`, not `DELETE` (soft-delete via `deleted_at`). This keeps one row per panel, avoids orphaned rows, and the singleton guard (`deleted_at IS NULL`) still blocks re-add for hidden singletons.

### Widget Manager self-protection

Widget Manager panel has no Hide button — can't hide the panel you're viewing from.

### All panels, not just singletons

The Dashboard Panels section shows ALL panels in the workspace, not just singletons. Any panel can be hidden/restored. Singletons just have extra significance since Widget Manager is their only restore path.

## Test Coverage

### `__tests__/unit/chat/phase5-duplicate-instance-routing.test.ts`

- `target_panel_hidden`: stored `open_panel` row for hidden panel → rejected (1 test)
- `duplicate_family_ambiguous`: stored `open_panel` row for duplicable family with >1 sibling → rejected (1 test)
- Backward compat: no visibleWidgets → valid (1 test)
- Non-panel nav actions → valid regardless (1 test)

### Coverage gap (documented)

- Resolver `is_visible = true` filter: runtime-proven via screenshots, not directly unit-tested (requires DB mocking)

## Runtime Proof

| Test | Result |
|------|--------|
| Hide Links Panel A + C via Widget Manager | Hidden section shows them with Show button |
| "open links panel" after hiding A + C | Only shows B + D (visible ones) — A and C excluded |
| "open widget manager" (singleton) | Opens directly (Auto-Executed) |
| Widget Manager self-protection | No Hide button on Widget Manager entry |
| Add Panel: singletons disabled | Continue, Recent, Widget Manager show "Already on dashboard" |

## Lifecycle Boundary

| State | Managed by | Visible in chat | Visible in dashboard |
|-------|-----------|----------------|---------------------|
| Active (`is_visible = true, deleted_at IS NULL`) | Dashboard + Widget Manager | Yes | Yes |
| Hidden (`is_visible = false, deleted_at IS NULL`) | Widget Manager (Show) | No | No |
| Deleted (`deleted_at IS NOT NULL`) | Trash surfaces (Links Overview) | No | No |
