# Widget Architecture Implementation Plan

**Feature Slug:** `widget-architecture`
**Date:** 2026-01-01
**Status:** Planning

## Overview

Transform the dashboard from full-panel rendering to a macOS-style widget architecture where:
- **Widgets** (NEW): Compact, read-only summaries displayed on the dashboard
- **Full Panels** (REUSE): Existing panel components opened in a right-side drawer on double-click

## Design Principles (macOS Widget Style)

1. **No window chrome** - Widgets are pure content, no headers/title bars
2. **Content IS the widget** - No explicit "Open" buttons or footers
3. **Labels integrated into content** - Small uppercase labels within content flow
4. **Double-click to expand** - Implicit interaction, no visible affordance
5. **Rounded corners, subtle shadows** - Soft, card-like appearance

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ DashboardView.tsx                                           │
│   └── DashboardPanelRenderer.tsx                            │
│         └── BaseDashboardPanel (header + content wrapper)   │
│               └── RecentPanel / LinksNotePanelTiptap        │
│                   (full interactive component)              │
└─────────────────────────────────────────────────────────────┘
```

**Current Panel Flow:**
1. `DashboardView` maps over `panels` array
2. Each panel renders via `DashboardPanelRenderer`
3. `DashboardPanelRenderer` wraps in `BaseDashboardPanel` (adds header, drag handle)
4. Full panel component renders inside (RecentPanel, LinksNotePanelTiptap, etc.)

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ DashboardView.tsx                                           │
│   ├── DashboardWidgetRenderer.tsx (NEW)                     │
│   │     └── BaseWidget (NEW - no header, pure content)      │
│   │           └── RecentWidget / QuickLinksWidget (NEW)     │
│   │               (compact, read-only summary)              │
│   │                                                         │
│   └── FullPanelDrawer.tsx (NEW)                             │
│         └── BaseDashboardPanel (existing)                   │
│               └── RecentPanel / LinksNotePanelTiptap        │
│                   (full interactive component - REUSED)     │
└─────────────────────────────────────────────────────────────┘
```

**New Panel Flow:**
1. `DashboardView` maps over `panels` array
2. Each panel renders via `DashboardWidgetRenderer` (NEW)
3. Widget renders as compact, headerless card
4. Double-click opens `FullPanelDrawer` with existing full panel component

---

## Component Breakdown

### 1. New Components to Create

| Component | Location | Purpose |
|-----------|----------|---------|
| `BaseWidget.tsx` | `components/dashboard/widgets/` | Wrapper for all widgets (no header, rounded card) |
| `RecentWidget.tsx` | `components/dashboard/widgets/` | Compact recent items (stat + 3 items) |
| `QuickLinksWidget.tsx` | `components/dashboard/widgets/` | Compact links list (label + items) |
| `DashboardWidgetRenderer.tsx` | `components/dashboard/` | Routes panel type to widget component |
| `FullPanelDrawer.tsx` | `components/dashboard/` | Right-side drawer for full panel display |
| `useDrawerPanel.ts` | `lib/hooks/` | State management for drawer open/close |

### 2. Components to Modify

| Component | Changes |
|-----------|---------|
| `DashboardView.tsx` | Add drawer state, use widget renderer, handle double-click |
| `DashboardPanelRenderer.tsx` | Keep for drawer content (or deprecate if widget renderer handles all) |
| `BaseDashboardPanel.tsx` | Add `isDrawer` prop to adjust styling in drawer context |

### 3. Components to Reuse (No Changes)

| Component | Usage |
|-----------|-------|
| `RecentPanel.tsx` | Renders inside FullPanelDrawer |
| `LinksNotePanelTiptap.tsx` | Renders inside FullPanelDrawer |
| Other panels | Renders inside FullPanelDrawer |

---

## Detailed Component Specifications

### BaseWidget.tsx

```typescript
interface BaseWidgetProps {
  panel: WorkspacePanel
  children: React.ReactNode
  size?: 'small' | 'medium' | 'large'
  onDoubleClick?: () => void
  isActive?: boolean
  className?: string
}

// Key styling (no header, no footer)
const baseStyles = {
  background: '#1e222a',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '20px',
  padding: '16px',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
}

const hoverStyles = {
  borderColor: 'rgba(99, 102, 241, 0.5)',
  transform: 'scale(1.02)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
}
```

### RecentWidget.tsx

```typescript
interface RecentWidgetProps {
  panel: WorkspacePanel
  onDoubleClick: () => void
}

// Content structure (no header)
<BaseWidget onDoubleClick={onDoubleClick}>
  <div className="widget-label">RECENT</div>
  <div className="widget-value">
    {recentItems.length}
    <span className="widget-unit">items</span>
  </div>
  <ul className="widget-list">
    {recentItems.slice(0, 3).map(item => (
      <li className="widget-list-item">
        <span className="widget-icon">{item.name[0]}</span>
        <span className="widget-text">{item.name}</span>
      </li>
    ))}
  </ul>
</BaseWidget>
```

### QuickLinksWidget.tsx

```typescript
interface QuickLinksWidgetProps {
  panel: WorkspacePanel
  badge?: string // A, B, C, D
  onDoubleClick: () => void
}

// Content structure (no header)
<BaseWidget onDoubleClick={onDoubleClick}>
  <div className="widget-label">
    QUICK LINKS {badge}
  </div>
  <ul className="widget-list">
    {links.slice(0, 4).map(link => (
      <li className="widget-list-item">
        <span className="widget-icon">{link.icon}</span>
        <span className="widget-text">{link.name}</span>
      </li>
    ))}
  </ul>
</BaseWidget>
```

### FullPanelDrawer.tsx (Right-Side Drawer, NOT Full-Screen Modal)

**IMPORTANT:** This is a right-side drawer, NOT a full-screen modal.
- Widgets remain visible on the left
- Chat remains accessible
- Similar to existing ViewPanel pattern

**Backdrop choice (decide one):**
- **Interactive widgets:** use a dim layer with `pointer-events: none`
- **Non-interactive widgets:** keep `pointer-events: auto` and close on click

```typescript
interface FullPanelDrawerProps {
  isOpen: boolean
  onClose: () => void
  panel: WorkspacePanel | null
}

// Structure - RIGHT-SIDE DRAWER (not full-screen overlay)
<>
  {/* Optional: subtle backdrop on LEFT side only, non-blocking */}
  {isOpen && (
    <div
      className="drawer-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: DRAWER_WIDTH,  // Don't cover drawer area
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.2)',
        zIndex: 99990,
        pointerEvents: 'auto',  // Change to 'none' if widgets should stay interactive
      }}
    />
  )}

  {/* RIGHT-SIDE DRAWER */}
  <div
    className="full-panel-drawer"
    style={{
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      width: DRAWER_WIDTH,  // 400px or 30-40% of viewport
      transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.3s ease',
      zIndex: 99995,  // Below chat (99999) but above backdrop
    }}
  >
    <div className="drawer-header">
      <button className="drawer-close" onClick={onClose}>×</button>
      <span className="drawer-title">{panel?.title}</span>
    </div>
    <div className="drawer-body">
      {/* Render full panel component */}
      <DashboardPanelRenderer
        panel={panel}
        isDrawer={true}
        onClose={onClose}
      />
    </div>
  </div>
</>

// Drawer Styling
const DRAWER_WIDTH = 420  // px, or use '35vw' for responsive

const drawerStyles = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: `${DRAWER_WIDTH}px`,
  background: '#1e222a',
  borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
  boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.4)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 99995,
}

const drawerHeader = {
  padding: '16px 20px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
}

const drawerBody = {
  flex: 1,
  overflow: 'auto',
  padding: '20px',
}
```

**Z-Index Layering (ensuring chat stays accessible):**
```
Drawer backdrop:     99990  (clickable to close)
Full panel drawer:   99995  (below chat)
Chat panel:          99999  (always on top)
```

**Layout Behavior:**
```
┌────────────────────────────────┬──────────────┐
│                                │              │
│   Dashboard (widgets visible)  │  Full Panel  │
│                                │   Drawer     │
│   ┌─────┐  ┌─────┐  ┌─────┐   │   (420px)    │
│   │Widget│  │Widget│  │Widget│   │              │
│   └─────┘  └─────┘  └─────┘   │              │
│                                │              │
│   (subtle dim backdrop)        │              │
│                                │              │
└────────────────────────────────┴──────────────┘
                                        ↑
                                   Chat floats
                                   above all
```

### DashboardWidgetRenderer.tsx

```typescript
interface DashboardWidgetRendererProps {
  panel: WorkspacePanel
  onDoubleClick: (panel: WorkspacePanel) => void
  isActive?: boolean
}

function DashboardWidgetRenderer({ panel, onDoubleClick, isActive }: Props) {
  const handleDoubleClick = () => onDoubleClick(panel)

  switch (panel.panelType) {
    case 'recent':
      return <RecentWidget panel={panel} onDoubleClick={handleDoubleClick} />

    case 'links_note':
    case 'links_note_tiptap':
      return <QuickLinksWidget panel={panel} onDoubleClick={handleDoubleClick} />

    case 'continue':
      return <ContinueWidget panel={panel} onDoubleClick={handleDoubleClick} />

    case 'quick_capture':
      return <QuickCaptureWidget panel={panel} onDoubleClick={handleDoubleClick} />

    // ... other panel types

    default:
      // Fallback: render full panel for types without widgets yet
      return (
        <BaseDashboardPanel
          panel={panel}
          onDoubleClick={handleDoubleClick}
        >
          <DashboardPanelRenderer panel={panel} />
        </BaseDashboardPanel>
      )
  }
}
```

---

## DashboardView.tsx Changes

### New State

```typescript
// Add to DashboardView
const [drawerPanel, setDrawerPanel] = useState<WorkspacePanel | null>(null)
const isDrawerOpen = drawerPanel !== null

const handleWidgetDoubleClick = useCallback((panel: WorkspacePanel) => {
  setDrawerPanel(panel)
}, [])

const handleDrawerClose = useCallback(() => {
  setDrawerPanel(null)
}, [])
```

### Updated Render

```tsx
// Replace current panel rendering
{panels.map(panel => (
  <div
    key={panel.id}
    className="panel-container"
    style={{
      position: 'absolute',
      left: panel.positionX,
      top: panel.positionY,
      width: panel.width,
      height: panel.height,
    }}
  >
    <DashboardWidgetRenderer
      panel={panel}
      onDoubleClick={handleWidgetDoubleClick}
      isActive={activePanelId === panel.id}
    />
  </div>
))}

{/* Add drawer at end - renders as right-side panel, not full-screen */}
<FullPanelDrawer
  isOpen={isDrawerOpen}
  onClose={handleDrawerClose}
  panel={drawerPanel}
/>
```

---

## Widget Sizing

Widgets use the same grid system but have different content density:

| Widget Type | Default Size | Grid Units | Content |
|-------------|--------------|------------|---------|
| RecentWidget | small | 1×1 | Stat + 3 items |
| QuickLinksWidget | small | 1×1 | Label + 4 items |
| ContinueWidget | small | 1×1 | Single workspace name |
| NotesWidget | medium | 2×1 | Text preview |
| CalendarWidget | medium | 2×1 | Date + events |

---

## Data Flow

### Widget Data Fetching

Widgets need lightweight data fetching (not full panel data):

```typescript
// RecentWidget - fetch summary only
const { data: recentSummary } = useSWR(
  '/api/dashboard/recent?limit=3&summary=true',
  fetcher
)

// QuickLinksWidget - fetch links preview
const { data: linksSummary } = useSWR(
  `/api/dashboard/panels/${panel.id}/links-summary?limit=4`,
  fetcher
)
```

### New API Endpoints (Optional)

If needed for performance, add summary endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/dashboard/recent?summary=true` | Returns only names, no metadata |
| `GET /api/dashboard/panels/:id/links-summary` | Returns link titles only |

---

## Chat Navigation Integration

Chat commands should be able to open the full panel drawer:

```typescript
// In chat intent resolver (server-side)
// Return an action to the client instead of dispatching DOM events
case 'show_quick_links':
  return {
    action: 'open_panel_drawer',
    panelId: quickLinksPanelId,
    message: 'Opening Quick Links...'
  }
```

```typescript
// In client chat handler (use-chat-navigation.ts) -> dispatch event
// Then in DashboardView:
useEffect(() => {
  const handleOpenDrawer = (e: CustomEvent) => {
    const panel = panels.find(p => p.id === e.detail.panelId)
    if (panel) setDrawerPanel(panel)
  }
  window.addEventListener('open-panel-drawer', handleOpenDrawer)
  return () => window.removeEventListener('open-panel-drawer', handleOpenDrawer)
}, [panels])
```

**Chat + Drawer Coexistence:**
- Chat floats at z-index 99999 (above drawer at 99995)
- User can type in chat while drawer is open
- Chat can trigger drawer open/close
- Drawer doesn't block chat input

---

## Implementation Phases

### Phase 1: Foundation (Core Infrastructure)

1. Create `components/dashboard/widgets/` directory
2. Create `BaseWidget.tsx` component
3. Create `FullPanelDrawer.tsx` component (right-side drawer, NOT modal)
4. Create `DashboardWidgetRenderer.tsx` component
5. Add drawer state to `DashboardView.tsx`

**Files to create:**
- `components/dashboard/widgets/BaseWidget.tsx`
- `components/dashboard/widgets/index.ts`
- `components/dashboard/FullPanelDrawer.tsx`
- `components/dashboard/DashboardWidgetRenderer.tsx`

**Files to modify:**
- `components/dashboard/DashboardView.tsx`

### Phase 2: Widget Components

1. Create `RecentWidget.tsx`
2. Create `QuickLinksWidget.tsx`
3. Wire up data fetching for widgets
4. Test double-click → drawer flow

**Files to create:**
- `components/dashboard/widgets/RecentWidget.tsx`
- `components/dashboard/widgets/QuickLinksWidget.tsx`

### Phase 3: Integration & Polish

1. Update `DashboardWidgetRenderer` to route all panel types
2. Create widgets for remaining panel types (or use fallback)
3. Add animations (drawer slide-in/out, widget hover)
4. Connect chat navigation to drawer open
5. Test all interactions (widgets + drawer + chat coexistence)

**Files to modify:**
- `components/dashboard/DashboardWidgetRenderer.tsx`
- `lib/chat/intent-resolver.ts` (for chat → drawer integration)

### Phase 4: Cleanup & Optimization

1. Optimize widget data fetching (summary endpoints if needed)
2. Remove unused code from old architecture
3. Update documentation
4. Performance testing

---

## Acceptance Criteria

- [ ] Widgets render on dashboard without headers/footers (macOS style)
- [ ] Double-click on any widget opens full panel in right-side drawer
- [ ] Drawer shows full interactive panel (RecentPanel, LinksNotePanelTiptap)
- [ ] Drawer closes on Escape key or click on backdrop
- [ ] Widgets remain visible when drawer is open
- [ ] Chat remains accessible and usable when drawer is open
- [ ] Drag-and-drop still works on widgets
- [ ] Chat commands can trigger drawer open
- [ ] No regression in existing panel functionality
- [ ] Type-check passes (`npm run type-check`)
- [ ] Existing tests pass (`npm run test`)

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking drag-and-drop | Ensure BaseWidget passes through drag events |
| Drawer z-index conflicts | Use z-index 99995 (below chat at 99999, above backdrop at 99990) |
| Drawer blocking chat | Chat z-index (99999) > Drawer z-index (99995), verified in testing |
| Data fetching duplication | Widgets fetch summary, full panels fetch full data |
| Chat integration breaks | Test all chat commands after implementation |
| Performance regression | Widgets are lighter than full panels, should improve |

---

## File Structure After Implementation

```
components/dashboard/
├── DashboardView.tsx              (modified - adds drawer state)
├── DashboardPanelRenderer.tsx     (kept for drawer content)
├── DashboardWidgetRenderer.tsx    (NEW - routes to widgets)
├── FullPanelDrawer.tsx            (NEW - right-side drawer)
├── BaseDashboardPanel.tsx         (kept for drawer)
├── widgets/
│   ├── index.ts                   (NEW)
│   ├── BaseWidget.tsx             (NEW)
│   ├── RecentWidget.tsx           (NEW)
│   ├── QuickLinksWidget.tsx       (NEW)
│   ├── ContinueWidget.tsx         (NEW - Phase 3)
│   ├── QuickCaptureWidget.tsx     (NEW - Phase 3)
│   └── CategoryWidget.tsx         (NEW - Phase 3)
└── panels/
    ├── RecentPanel.tsx            (unchanged - used in drawer)
    ├── LinksNotePanelTiptap.tsx   (unchanged - used in drawer)
    └── ...                        (unchanged)
```

---

## Demo Reference

Interactive HTML demo available at:
`docs/proposal/components/workspace/note/plan/enhance/ui/dashboard-v5-summary-full-panels.html`

Open in browser to see the widget + drawer interaction pattern.

---

## Notes

- This plan preserves all existing panel functionality
- Full panels are REUSED, not rewritten
- Widgets are NEW components, purpose-built for dashboard summary view
- Drawer system is generic and can be extended for other use cases
- Chat integration opens panels via drawer (not direct navigation)
