# Stage 6x.8 Phase 5 — Dashboard Panel Hide/Show via Widget Manager

## Summary

Implement an active ↔ hidden lifecycle for all dashboard panels via the Widget Manager. Hidden panels are excluded from chat routing (resolver, known-noun, Memory-Exact replay). Trashed/deleted panels remain managed by existing trash surfaces (Links Overview).

- **Singletons** (recent, continue, widget_manager): Widget Manager is the **only** restore path since Add Panel blocks re-add
- **Duplicables** (navigator, links panel): can re-add via Add Panel, but restore is cleaner — preserves same instance with data/position
- **All panels**: benefit from hide/restore without losing state

**Key finding:** All backend mechanics already exist:
- Hide: `PATCH /api/dashboard/panels/[panelId]` with `{ isVisible: false }`
- Restore: `PATCH /api/dashboard/panels/[panelId]` with `{ isVisible: true }`
- Dashboard refresh: `window.dispatchEvent(new CustomEvent('refresh-dashboard-panels'))` (proven in CategoryNavigatorPanel)

No new API endpoints needed.

Anti-pattern applicability: **not applicable**. This is panel lifecycle UX work, not provider/reactivity work.

## Problem

Users have no clean way to hide and later restore dashboard panels. The current options are:
- Delete the panel (loses data/position, goes to trash)
- No way to temporarily remove a panel without destroying it

For singletons (widget_manager, continue, recent), this is especially problematic because:
- The Add Panel catalog blocks re-adding when a singleton already exists
- There is no restore path at all if the user hides a singleton

## Scope

### In scope
- Active ↔ hidden lifecycle for non-deleted panels (via `is_visible` toggle)
- Widget Manager as the control surface for all panel visibility
- Hidden panels excluded from chat routing (resolver, known-noun, Memory-Exact replay)
- Hidden singleton panels remain blocked in Add Panel catalog

### Out of scope
- Trashed/deleted panel restore (managed by existing trash surfaces)
- Chat commands to mutate Widget Manager state ("hide panel X" via chat)
- Sort order or grouping of panels within the Widget Manager list

## Design

### Phase 1: Add "Dashboard Panels" Section to Widget Manager

**File:** `components/dashboard/panels/WidgetManagerPanel.tsx`

Add a new section at the top of the widget lists area showing all panels in the current workspace:

```
DASHBOARD PANELS
┌──────────────────────────────────────────┐
│ ▶ Continue              [Active]  Hide   │
│ 🕐 Recent               [Active]  Hide   │
│ 📂 Entry Navigator      [Active]  Hide   │
│ 📂 Entry Navigator C    [Active]  Hide   │
│ 🔗 Links Panel A        [Active]  Hide   │
│ 🔗 Links Panel B        [Active]  Hide   │
│ ⚙️ Widget Manager       [Active]         │  ← no hide (self)
│ ── Hidden ──                             │
│ 📋 Quick Capture        [Hidden]  Show   │
└──────────────────────────────────────────┘
```

**Data source:** Fetch from `GET /api/dashboard/panels?workspaceId=...&includeHidden=true`. Shows ALL panels including hidden ones.

**Status logic:**
- `is_visible = true` → "Active" with Hide button
- `is_visible = false` → "Hidden" with Show (restore) button
- Widget Manager itself → Active, no Hide button (self-reference protection)

**Panel identity display:**
- Icon from `panelTypeRegistry[panelType].icon`
- Title: use `panel.title || panelTypeRegistry[panelType].name` directly — do NOT append `instanceLabel` separately. Titles are already created with the label included (e.g., "Entry Navigator C", "Links Panel A") at `route.ts:203`. Appending again would produce "Entry Navigator C C".

### Phase 2: Fetch All Panels (Including Hidden)

**File:** `components/dashboard/panels/WidgetManagerPanel.tsx`

```typescript
const [dashboardPanels, setDashboardPanels] = useState<WorkspacePanel[]>([])

const fetchDashboardPanels = useCallback(async () => {
  const res = await fetch(`/api/dashboard/panels?workspaceId=${panel.workspaceId}&includeHidden=true`)
  if (!res.ok) return
  const { panels } = await res.json()
  setDashboardPanels(panels)
}, [panel.workspaceId])

useEffect(() => { fetchDashboardPanels() }, [fetchDashboardPanels])
```

`panel.workspaceId` is available from the `BasePanelProps.panel` prop.

### Phase 3: Hide/Show Actions

**File:** `components/dashboard/panels/WidgetManagerPanel.tsx`

```typescript
const handleHidePanel = async (panelId: string) => {
  await fetch(`/api/dashboard/panels/${panelId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isVisible: false }),
  })
  fetchDashboardPanels() // refresh local list
  window.dispatchEvent(new CustomEvent('refresh-dashboard-panels')) // refresh dashboard
}

const handleShowPanel = async (panelId: string) => {
  await fetch(`/api/dashboard/panels/${panelId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isVisible: true }),
  })
  fetchDashboardPanels()
  window.dispatchEvent(new CustomEvent('refresh-dashboard-panels'))
}
```

Uses existing PATCH endpoint + existing `refresh-dashboard-panels` event pattern (proven in CategoryNavigatorPanel).

### Phase 4: DashboardView Singleton-Aware PanelCatalog

**File:** `components/dashboard/DashboardView.tsx`

Current `existingPanelTypes` for PanelCatalog is derived from visible panels only. After hiding a singleton, it drops out and Add Panel re-enables it.

Fix: fetch hidden-inclusive singleton types separately:

```typescript
const [hiddenSingletonTypes, setHiddenSingletonTypes] = useState<string[]>([])

useEffect(() => {
  const fetchHiddenSingletons = async () => {
    const res = await fetch(`/api/dashboard/panels?workspaceId=${workspaceId}&includeHidden=true`)
    if (!res.ok) return
    const { panels: allPanels } = await res.json()
    const hidden = allPanels
      .filter((p: any) => !p.isVisible && !p.deletedAt && isSingletonPanelType(p.panelType))
      .map((p: any) => p.panelType)
    setHiddenSingletonTypes(hidden)
  }
  fetchHiddenSingletons()
}, [workspaceId])
```

Merge into `existingPanelTypes`:
```typescript
existingPanelTypes={[
  ...panels.filter(p => !p.deletedAt).map(p => p.panelType),
  ...hiddenSingletonTypes,
]}
```

Also re-fetch on `refresh-dashboard-panels` event so the catalog stays in sync after hide/show.

### Phase 5: Resolver Visibility Filter

**File:** `lib/chat/intent-resolver.ts`

All panel-instance queries in `resolveDrawerPanelTarget()` currently filter `deleted_at IS NULL` but not `is_visible`. Hidden panels leak into chat clarifiers and targeting.

Add `AND is_visible = true` to every `workspace_panels` query in the resolver:

- `recent` panel lookup
- Quick-links family (all badges)
- Quick-links exact badge lookup
- Generic duplicate-family exact instance
- Generic duplicate-family sibling count
- Dynamic fallback: panel_type match
- Dynamic fallback: title match
- Dynamic fallback: fuzzy match
- `resolveShowQuickLinks` panel lookup

### Phase 6: Memory Validator Hidden-Panel Guard

**File:** `lib/chat/routing-log/memory-validator.ts`

The existing `open_panel` validation checks for `duplicate_family_ambiguous` but not whether the stored panel is still visible. A learned `open_panel` row for a now-hidden panel would bypass the tightened resolver queries via B1 replay.

Add a visibility check alongside the existing duplicate-family guard:

```typescript
if (actionType === 'open_panel' && visibleWidgets && visibleWidgets.length > 0) {
  const storedPanelId = candidate.slots_json.panelId as string | undefined
  if (storedPanelId) {
    // Check if stored panel is still visible
    const isVisible = visibleWidgets.some(w => w.id === storedPanelId)
    if (!isVisible) {
      return { valid: false, reason: 'target_panel_hidden' }
    }
    // Existing duplicate-family ambiguity check...
  }
}
```

Add `'target_panel_hidden'` to the `ValidationResult.reason` union type.

This keeps hidden-panel policy consistent across all three routing paths: resolver, known-noun, and Memory-Exact replay.

## Files to Change

| File | Change |
|------|--------|
| `components/dashboard/panels/WidgetManagerPanel.tsx` | Add "Dashboard Panels" section with all panels + hide/show actions |
| `components/dashboard/DashboardView.tsx` | Fetch hidden singleton types for PanelCatalog consistency |
| `lib/chat/intent-resolver.ts` | Add `AND is_visible = true` to all panel-instance queries |
| `lib/chat/routing-log/memory-validator.ts` | Add `target_panel_hidden` rejection for `open_panel` rows targeting non-visible panels |

No new API endpoints.

## Tests

### Automated
1. `target_panel_hidden` validator test: stored `open_panel` row for hidden panel → rejected
2. Existing `duplicate_family_ambiguous` tests remain passing

### Manual verification
1. Hide Continue via Widget Manager → disappears from dashboard, shows "Hidden" in Widget Manager
2. Show Continue via Widget Manager → reappears on dashboard
3. Hide Continue → Add Panel still shows it disabled ("Already on dashboard")
4. Hide Navigator C → "open navigator" excludes C from clarifier
5. Show Navigator C → "open navigator" includes C again
6. Hide Links Panel A → "open links panel" excludes A from clarifier
7. Widget Manager entry has no Hide button (self-protection)

## Acceptance Criteria

1. Any dashboard panel can be hidden/shown via Widget Manager
2. Hidden panels are excluded from chat routing (resolver clarifiers, Memory-Exact replay)
3. Hidden singleton panels remain blocked in Add Panel catalog
4. Widget Manager cannot hide itself
5. Hide/show uses existing `is_visible` toggle (not soft-delete)
6. Dashboard refreshes immediately after hide/show via existing event pattern

## Lifecycle Boundary

| State | Managed by | Visible in chat | Visible in dashboard |
|-------|-----------|----------------|---------------------|
| Active (`is_visible = true, deleted_at IS NULL`) | Dashboard + Widget Manager | Yes | Yes |
| Hidden (`is_visible = false, deleted_at IS NULL`) | Widget Manager (Show) | No | No |
| Deleted (`deleted_at IS NOT NULL`) | Trash surfaces (Links Overview) | No | No |
