# Panel Intent Ambiguity Guard - Implementation Report

**Date:** 2025-01-09
**Status:** COMPLETE
**Feature Slug:** `missing-widget-panel-intents`

---

## Executive Summary

Successfully implemented the **Panel Intent Ambiguity Guard** feature, which enables the chat navigation system to properly handle ambiguous panel references (e.g., "open links" when multiple Quick Links panels exist). The system now shows disambiguation pills instead of failing or guessing incorrectly.

### Key Achievements

1. **Dynamic panel resolution** - Replaced hard-coded panel mappings with database lookups
2. **Multi-step disambiguation** - Prioritized matching (visibleWidgets → panel_type → title → fuzzy)
3. **Badge-differentiated pills** - Shows "Quick Links D" vs "Quick Links E" instead of identical labels
4. **LLM prompt hardening** - Prevents the LLM from guessing badge letters
5. **Seamless selection flow** - Users can select from pills or use numbers (1, 2, etc.)

---

## Problem Statement

### Original Issue

When users said "open links" or "open Navigator", the system failed with "Panel not found" errors because:

1. The resolver only checked exact `panel_type` matches
2. Widget names (Navigator, Quick Capture, etc.) weren't mapped to panel types
3. Multiple Quick Links panels (D, E, etc.) caused ambiguity that wasn't handled

### User Impact

- "open Navigator" → "Panel not found" (should open Navigator widget)
- "open links" → Either failed or opened wrong panel (should show disambiguation)
- "open Quick Capture" → "Panel not found" (should open Quick Capture widget)

---

## Solution Architecture

### Disambiguation Flow

```
User: "open links"
       ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 0: Check visibleWidgets (exact title match)            │
│         → If found: Open immediately                        │
│         → If not: Continue to Step 1                        │
└─────────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Check exact panel_type match in DB                  │
│         → If single match: Open immediately                 │
│         → If multiple: Return disambiguation                │
│         → If none: Continue to Step 2                       │
└─────────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 2: Check exact title match (ILIKE)                     │
│         → Same logic as Step 1                              │
└─────────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 3: Fuzzy match (ILIKE '%name%')                        │
│         → If 1 match: Show confirm pill ("Did you mean X?") │
│         → If >1: Return disambiguation pills                │
│         → If 0: Return "not_found"                          │
└─────────────────────────────────────────────────────────────┘
```

**Key Safety Rule:** Fuzzy matches NEVER auto-open. Even a single fuzzy match requires user confirmation.

### Type System

```typescript
// Discriminated union for resolution results
type DrawerResolutionResult =
  | { status: 'found'; panelId: string; panelTitle: string; semanticPanelId: string }
  | { status: 'confirm'; panelId: string; panelTitle: string; panelType: string; semanticPanelId: string }
  | { status: 'multiple'; panels: Array<{ id: string; title: string; panel_type: string; badge?: string }> }
  | { status: 'not_found' }
```

---

## Implementation Details

### 1. Resolution Context Enhancement

**File:** `lib/chat/resolution-types.ts`

Added `visibleWidgets` to the resolution context so Step 0 can check currently visible widgets without a database query:

```typescript
export interface ResolutionContext {
  // ... existing fields
  visibleWidgets?: Array<{ id: string; title: string; type: string }>
}
```

### 2. API Route Updates

**File:** `app/api/chat/navigate/route.ts`

Pass `visibleWidgets` from the UI context to the resolver:

```typescript
const resolutionContext = {
  // ... existing fields
  visibleWidgets: context?.uiContext?.dashboard?.visibleWidgets,
}
```

### 3. Intent Resolver Core Logic

**File:** `lib/chat/intent-resolver.ts`

#### Step 0: Exact visibleWidgets Match

```typescript
if (context.visibleWidgets && context.visibleWidgets.length > 0) {
  const normalizedPanelId = panelId.toLowerCase().replace(/-/g, ' ')
  const exactMatch = context.visibleWidgets.find(
    (w) => w.title.toLowerCase() === normalizedPanelId ||
           w.title.toLowerCase().replace(/[^a-z0-9]/g, '') ===
           panelId.toLowerCase().replace(/[^a-z0-9]/g, '')
  )
  if (exactMatch) {
    return {
      status: 'found' as const,
      panelId: exactMatch.id,
      panelTitle: exactMatch.title,
      semanticPanelId: panelId,
    }
  }
}
```

#### Bare "quick-links" Handler

```typescript
if (panelId === 'quick-links' || panelId.startsWith('quick-links-')) {
  const badge = panelId === 'quick-links' ? null : panelId.replace('quick-links-', '')

  // If no badge specified, get all Quick Links panels for disambiguation
  if (!badge) {
    const allQuickLinksResult = await serverPool.query(
      `SELECT id, title, badge, panel_type
       FROM workspace_panels
       WHERE workspace_id = $1
         AND panel_type IN ('links_note', 'links_note_tiptap')
         AND deleted_at IS NULL
       ORDER BY badge ASC, created_at ASC`,
      [dashboardWorkspaceId]
    )

    if (allQuickLinksResult.rows.length > 1) {
      return {
        status: 'multiple' as const,
        panels: allQuickLinksResult.rows.map(row => ({
          id: row.id,
          title: formatPanelTitle(row),
          panel_type: row.panel_type,
          badge: row.badge,
        })),
      }
    }
    // ... single match or not found handling
  }
}
```

#### Badge-Differentiated Title Formatting

```typescript
const formatPanelTitle = (row: { title: string; badge?: string; panel_type: string }) => {
  if (row.badge && (row.panel_type === 'links_note' || row.panel_type === 'links_note_tiptap')) {
    return `Quick Links ${row.badge.toUpperCase()}`
  }
  return row.title || panelId
}
```

### 4. Panel Drawer Selection Handler

**File:** `lib/chat/chat-navigation-context.tsx`

Added `panel_drawer` type and `PanelDrawerData` interface:

```typescript
export interface PanelDrawerData {
  panelId: string
  panelTitle: string
  panelType: string
}

export interface SelectionOption {
  type: 'workspace' | 'note' | 'entry' | 'confirm_delete' |
        'quick_links_panel' | 'confirm_panel_write' | 'panel_drawer'
  // ...
}
```

**File:** `lib/chat/use-chat-navigation.ts`

Added case handler for `panel_drawer` selection:

```typescript
case 'panel_drawer':
  const drawerData = option.data as PanelDrawerData
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

### 5. LLM Prompt Hardening

**File:** `lib/chat/intent-prompt.ts`

Added a critical disambiguation rule to prevent badge guessing:

```typescript
## CRITICAL: "open links" / "open quick links" Disambiguation

**STOP - READ THIS CAREFULLY:** When user says "open links", "open quick links",
"links", or any similar phrase WITHOUT an explicit letter (A, B, C, D, E, etc.),
you MUST:

For panel_intent with Quick Links:
  - Use panelId: "quick-links" (NO badge suffix like -d, -e, -s)
  - The server will show disambiguation pills if multiple panels exist

**EXPLICIT EXAMPLES - FOLLOW EXACTLY:**
- "open links" → { "intent": "panel_intent", "args": { "panelId": "quick-links", ... } }
- "open quick links" → { "intent": "panel_intent", "args": { "panelId": "quick-links", ... } }
- "open links d" → { "intent": "panel_intent", "args": { "panelId": "quick-links-d", ... } }

**FORBIDDEN - NEVER DO THIS:**
- ❌ panelId: "quick-links-d" (when user just said "open links")
- ❌ Guessing a badge from visible widgets or context
```

---

## Files Modified

### Core Implementation Files

| File | Changes |
|------|---------|
| `lib/chat/resolution-types.ts` | Added `visibleWidgets` to `ResolutionContext` |
| `lib/chat/intent-resolver.ts` | Added Step 0-3 disambiguation logic, `DrawerResolutionResult` type, `formatPanelTitle()` helper, bare "quick-links" handler |
| `lib/chat/chat-navigation-context.tsx` | Added `panel_drawer` type, `PanelDrawerData` interface |
| `lib/chat/use-chat-navigation.ts` | Added `panel_drawer` case handler |
| `lib/chat/intent-prompt.ts` | Added CRITICAL Quick Links disambiguation rule with examples |
| `app/api/chat/navigate/route.ts` | Pass `visibleWidgets` from uiContext to resolver |

### Debug Logging Files (for development/troubleshooting)

| File | Changes |
|------|---------|
| `components/chat/chat-navigation-panel.tsx` | Added debug logging for `sendMessage_uiContext` to trace openDrawer state |
| `components/dashboard/DashboardView.tsx` | Added debug logging for `uiContext_effect`, `widgetState_effect`, `handleOpenDrawer`, and `setDrawerPanel` events |

### Total Files Affected: 8

---

## Test Results

### Final Test (2025-01-09)

| Test Case | Input | Expected | Actual | Status |
|-----------|-------|----------|--------|--------|
| Typo tolerance | "can youu ppls open links" | Disambiguation | Shows "Quick Links D", "Quick Links E" | ✅ PASS |
| Show links | "show links" | Disambiguation | Shows "Quick Links D", "Quick Links E" | ✅ PASS |
| Number selection 1 | "1" | Open Quick Links D | "Opening Quick Links D..." | ✅ PASS |
| Number selection 2 | "2" | Open Quick Links E | "Opening Quick Links E..." | ✅ PASS |
| Explicit badge | "open quick links D" | Direct open | "Opening Quick Links D..." | ✅ PASS |

### Previous Issues Fixed

| Issue | Root Cause | Fix |
|-------|------------|-----|
| "Panel not found" for widgets | Hard-coded panel map missing widgets | Dynamic DB lookup with Step 0-3 |
| "Opened workspace 'undefined'" | Used `type: 'workspace'` for panel selection | Changed to `type: 'panel_drawer'` |
| Same labels in disambiguation | SQL didn't include `badge` field | Added `badge` to query, `formatPanelTitle()` helper |
| LLM guessing badge letters | No explicit prompt rule | Added CRITICAL disambiguation section |

---

## Acceptance Criteria Verification

### From `panel-intent-ambiguity-guard-plan.md`

| Criteria | Status | Evidence |
|----------|--------|----------|
| Step 0: Exact visibleWidgets match works | ✅ | "open Navigator" opens Navigator widget directly |
| Step 1-3: DB lookup with disambiguation | ✅ | "open links" shows pills when multiple exist |
| Multiple matches show pills | ✅ | Screenshot shows "Quick Links D", "Quick Links E" pills |
| Badge differentiation in pills | ✅ | Pills show "D" and "E" suffixes, not identical labels |
| Selection from pills works | ✅ | "1" opens Quick Links D, "2" opens Quick Links E |
| Explicit badge bypasses disambiguation | ✅ | "open quick links D" opens directly |
| LLM doesn't guess badges | ✅ | Consistent disambiguation across multiple tests |

### From `missing-widget-panel-intents-plan.md`

| Criteria | Status | Evidence |
|----------|--------|----------|
| "open Navigator" works | ✅ | Matches via Step 0 visibleWidgets |
| "open Quick Capture" works | ✅ | Matches via Step 0 visibleWidgets |
| "open links" shows disambiguation | ✅ | Returns multiple pills when >1 Quick Links exist |
| Panel drawer opens correctly | ✅ | `open-panel-drawer` event dispatched with correct panelId |

---

## Architecture Decisions

### 1. Why Step 0 (visibleWidgets) First?

- **Performance**: No database query needed for visible widgets
- **Accuracy**: Uses exact widget titles from current UI state
- **UX**: Instant response for common "open X" commands

### 2. Why Discriminated Union for Results?

```typescript
type DrawerResolutionResult =
  | { status: 'found'; ... }
  | { status: 'multiple'; ... }
  | { status: 'not_found' }
```

- **Type safety**: Compiler enforces handling all cases
- **Clear semantics**: Each status has different data shapes
- **Extensibility**: Easy to add new statuses if needed

### 3. Why Explicit LLM Prompt Examples?

- **Consistency**: LLMs follow explicit examples better than abstract rules
- **FORBIDDEN section**: Explicitly states what NOT to do
- **Placement**: Critical rule placed prominently, not buried at the end

---

## Known Limitations

1. **Step 3 fuzzy matching** - May return unexpected results for very short panel names
2. **Badge ordering** - Relies on `ORDER BY badge ASC` which may not match user's visual order
3. **LLM prompt length** - Additional disambiguation rules increase prompt token count

---

## Future Considerations

1. **Widget type registry** - Could formalize widget name → panel_type mappings
2. **User preferences** - Could remember user's preferred Quick Links panel
3. **Keyboard shortcuts** - Could add "1", "2" as direct panel openers (currently requires disambiguation first)

---

## Conclusion

The Panel Intent Ambiguity Guard is fully implemented and tested. The system now gracefully handles ambiguous panel references by showing user-friendly disambiguation pills with badge-differentiated labels. The LLM prompt hardening ensures consistent behavior across multiple requests.

**All acceptance criteria verified and passing.**
