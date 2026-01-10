# Code Changes Summary

**Feature:** Panel Intent Ambiguity Guard
**Date:** 2025-01-09

---

## Quick Reference

### New Types Added

```typescript
// lib/chat/intent-resolver.ts
type DrawerResolutionResult =
  | { status: 'found'; panelId: string; panelTitle: string; semanticPanelId: string }
  | { status: 'confirm'; panelId: string; panelTitle: string; panelType: string; semanticPanelId: string }
  | { status: 'multiple'; panels: Array<{ id: string; title: string; panel_type: string; badge?: string }> }
  | { status: 'not_found' }

// lib/chat/chat-navigation-context.tsx
interface PanelDrawerData {
  panelId: string
  panelTitle: string
  panelType: string
}
```

### Fuzzy Match Safety Rule

**Fuzzy matches NEVER auto-open.** The resolution flow is:
- `status: 'found'` → Exact match, open immediately
- `status: 'confirm'` → Fuzzy single match, show "Did you mean X?" pill
- `status: 'multiple'` → Multiple matches, show disambiguation pills
- `status: 'not_found'` → No match, fall through to panel registry

### Selection Option Type Update

```typescript
// lib/chat/chat-navigation-context.tsx
interface SelectionOption {
  type: 'workspace' | 'note' | 'entry' | 'confirm_delete' |
        'quick_links_panel' | 'confirm_panel_write' | 'panel_drawer'  // Added panel_drawer
  // ...
}
```

### Resolution Context Update

```typescript
// lib/chat/resolution-types.ts
interface ResolutionContext {
  // ... existing fields
  visibleWidgets?: Array<{ id: string; title: string; type: string }>  // Added
}
```

---

## File-by-File Changes

### 1. `lib/chat/resolution-types.ts`

**Change:** Added `visibleWidgets` field to `ResolutionContext`

```diff
 export interface ResolutionContext {
   dashboardWorkspaceId?: string
   currentEntryId?: string
   currentWorkspaceId?: string
+  visibleWidgets?: Array<{ id: string; title: string; type: string }>
 }
```

---

### 2. `lib/chat/intent-resolver.ts`

**Changes:**
- Added `DrawerResolutionResult` discriminated union type
- Added `formatPanelTitle()` helper function
- Added Step 0: visibleWidgets exact match
- Added bare "quick-links" handler for disambiguation
- Updated Step 1-3 to return `DrawerResolutionResult`

**Key Code Blocks:**

```typescript
// Step 0: Check visibleWidgets
if (context.visibleWidgets && context.visibleWidgets.length > 0) {
  const normalizedPanelId = panelId.toLowerCase().replace(/-/g, ' ')
  const exactMatch = context.visibleWidgets.find(
    (w) => w.title.toLowerCase() === normalizedPanelId ||
           w.title.toLowerCase().replace(/[^a-z0-9]/g, '') ===
           panelId.toLowerCase().replace(/[^a-z0-9]/g, '')
  )
  if (exactMatch) {
    return { status: 'found', panelId: exactMatch.id, panelTitle: exactMatch.title, semanticPanelId: panelId }
  }
}

// Helper function
const formatPanelTitle = (row: { title: string; badge?: string; panel_type: string }) => {
  if (row.badge && (row.panel_type === 'links_note' || row.panel_type === 'links_note_tiptap')) {
    return `Quick Links ${row.badge.toUpperCase()}`
  }
  return row.title || panelId
}

// Bare quick-links handler
if (panelId === 'quick-links') {
  const allQuickLinksResult = await serverPool.query(
    `SELECT id, title, badge, panel_type FROM workspace_panels
     WHERE workspace_id = $1 AND panel_type IN ('links_note', 'links_note_tiptap')
     AND deleted_at IS NULL ORDER BY badge ASC`,
    [dashboardWorkspaceId]
  )
  if (allQuickLinksResult.rows.length > 1) {
    return { status: 'multiple', panels: allQuickLinksResult.rows.map(row => ({
      id: row.id, title: formatPanelTitle(row), panel_type: row.panel_type, badge: row.badge
    }))}
  }
}
```

---

### 3. `lib/chat/chat-navigation-context.tsx`

**Changes:**
- Added `PanelDrawerData` interface
- Added `panel_drawer` to `SelectionOption.type` union
- Added `panel_drawer` to `selectOption()` function switch

```typescript
export interface PanelDrawerData {
  panelId: string
  panelTitle: string
  panelType: string
}

// In selectOption switch:
case 'panel_drawer':
  // Handled in use-chat-navigation.ts
  return { success: true, message: 'Panel selected', action: 'selected' }
```

---

### 4. `lib/chat/use-chat-navigation.ts`

**Changes:**
- Added `panel_drawer` case handler in `handleSelectOption()`

```typescript
case 'panel_drawer':
  const drawerData = option.data as { panelId: string; panelTitle: string; panelType: string }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('open-panel-drawer', {
      detail: { panelId: drawerData.panelId },
    }))
  }
  return {
    success: true,
    message: `Opening ${drawerData.panelTitle}...`,
    action: 'navigated',
  }
```

---

### 5. `app/api/chat/navigate/route.ts`

**Changes:**
- Pass `visibleWidgets` from uiContext to resolver

```diff
 const resolutionContext = {
   dashboardWorkspaceId,
   currentEntryId: context?.sessionState?.currentEntryId,
   currentWorkspaceId: context?.sessionState?.currentWorkspaceId,
+  visibleWidgets: context?.uiContext?.dashboard?.visibleWidgets,
 }
```

---

### 6. `lib/chat/intent-prompt.ts`

**Changes:**
- Added CRITICAL Quick Links disambiguation section with explicit examples

```typescript
## CRITICAL: "open links" / "open quick links" Disambiguation

**STOP - READ THIS CAREFULLY:** When user says "open links", "open quick links",
"links", or any similar phrase WITHOUT an explicit letter (A, B, C, D, E, etc.),
you MUST:

For panel_intent with Quick Links:
  - Use panelId: "quick-links" (NO badge suffix like -d, -e, -s)
  - The server will show disambiguation pills if multiple panels exist

**EXPLICIT EXAMPLES - FOLLOW EXACTLY:**
- "open links" → { "intent": "panel_intent", "args": { "panelId": "quick-links", "intentName": "open_drawer", "params": { "mode": "drawer" } } }
- "open quick links" → { "intent": "panel_intent", "args": { "panelId": "quick-links", "intentName": "open_drawer", "params": { "mode": "drawer" } } }
- "links" → { "intent": "panel_intent", "args": { "panelId": "quick-links", "intentName": "open_drawer", "params": { "mode": "drawer" } } }
- "open links d" → { "intent": "panel_intent", "args": { "panelId": "quick-links-d", ... } }

**FORBIDDEN - NEVER DO THIS:**
- ❌ panelId: "quick-links-d" (when user just said "open links")
- ❌ panelId: "quick-links-s" (when user just said "links")
- ❌ Guessing a badge from visible widgets or context
```

---

### 7. `components/chat/chat-navigation-panel.tsx`

**Changes:**
- Added debug logging for `sendMessage_uiContext` to trace openDrawer state during message sending

```typescript
console.log('[ChatNavigation] sendMessage_uiContext:', {
  mode: uiContext?.mode,
  openDrawer: uiContext?.dashboard?.openDrawer?.title,
  openDrawerId: uiContext?.dashboard?.openDrawer?.panelId,
  hasUiContext: !!uiContext,
})
```

---

### 8. `components/dashboard/DashboardView.tsx`

**Changes:**
- Added debug logging for uiContext effect tracking
- Added debug logging for widgetState effect tracking
- Added debug logging for handleOpenDrawer event handling
- Added debug logging for panel not found scenarios

```typescript
// uiContext effect entered
console.log('[DashboardView] uiContext_effect_entered:', {
  isEntryActive,
  viewMode,
  drawerPanelId: drawerPanel?.id ?? null,
  drawerPanelTitle: drawerPanel?.title ?? drawerPanel?.panelType ?? null,
})

// handleOpenDrawer called
console.log('[DashboardView] handleOpenDrawer_called:', {
  requestedPanelId: e.detail.panelId,
  panelsCount: panels.length,
  currentDrawerPanelId: drawerPanel?.id ?? null,
})

// Panel not found handling
console.log('[DashboardView] handleOpenDrawer_panel_not_found:', {
  requestedPanelId: e.detail.panelId,
  availablePanelIds: panels.map(p => p.id)
})
```

---

## SQL Queries Added

### Get All Quick Links Panels (for disambiguation)

```sql
SELECT id, title, badge, panel_type
FROM workspace_panels
WHERE workspace_id = $1
  AND panel_type IN ('links_note', 'links_note_tiptap')
  AND deleted_at IS NULL
ORDER BY badge ASC, created_at ASC
```

### Dynamic Panel Lookup (Step 1-3)

```sql
-- Step 1: Exact panel_type match
SELECT id, title, badge, panel_type FROM workspace_panels
WHERE workspace_id = $1 AND panel_type = $2 AND deleted_at IS NULL

-- Step 2: Exact title match
SELECT id, title, badge, panel_type FROM workspace_panels
WHERE workspace_id = $1 AND LOWER(title) = LOWER($2) AND deleted_at IS NULL

-- Step 3: Fuzzy title match
SELECT id, title, badge, panel_type FROM workspace_panels
WHERE workspace_id = $1 AND LOWER(title) LIKE LOWER($2) AND deleted_at IS NULL
```

---

## Event Flow

```
User: "open links"
  ↓
LLM: { intent: "panel_intent", args: { panelId: "quick-links", ... } }
  ↓
Resolver: Detects bare "quick-links", queries all Quick Links panels
  ↓
Resolver: Returns { status: "multiple", panels: [...] }
  ↓
API: Returns { action: "select", options: [{ type: "panel_drawer", ... }] }
  ↓
UI: Shows disambiguation pills
  ↓
User: Clicks "Quick Links D" or types "1"
  ↓
Handler: Dispatches 'open-panel-drawer' event with panelId
  ↓
DashboardView: Opens panel in drawer
```
