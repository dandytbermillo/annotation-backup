# Implementation Plan: Category Navigator & Multiple Quick Links Panels

**Feature Slug:** `workspace_navigator`
**Created:** 2025-12-06
**Status:** PLANNING
**Depends On:** `merge_dashboard_workspace` (completed)

---

## 0. Existing Code Reference (IMPORTANT)

Before implementing, understand what already exists:

| Existing Component | Path | Purpose |
|-------------------|------|---------|
| `EntryNavigatorPanel` | `components/dashboard/panels/EntryNavigatorPanel.tsx` | **File/folder tree navigator** - shows items from `items` table with expandable folders and workspaces. Virtual scrolling, caching, create folder/note. |
| `LinksNotePanel` | `components/dashboard/panels/LinksNotePanel.tsx` | **Current Quick Links** - free-form contenteditable panel where users highlight text to create workspace links. |
| Panel Registry | `lib/dashboard/panel-registry.ts` | Defines panel types: `navigator`, `links_note`, `note`, `recent`, `continue`, `quick_capture` |

**Key Distinction:**
- **File Navigator** (existing `EntryNavigatorPanel`): Browse by file/folder hierarchy (items table)
- **Category Navigator** (this proposal): Browse by user-defined Quick Links categories/panels
- **Current Quick Links** (existing `LinksNotePanel`): Free-form text with embedded workspace links

This plan introduces a NEW navigation layer organized by user-defined categories, NOT a replacement for the existing file navigator.

---

## 1. Overview

### Problem Statement

Currently, the main dashboard has Quick Links as a free-form `links_note` panel. While this works for creating ad-hoc workspace links, it lacks:
- Structured organization by category
- Multiple panels for different purposes
- A master navigator showing all categorized entries
- Ability to hide/show category panels while keeping access

### Solution: Two-Layer Navigation System

1. **Multiple Category Panels** (new panel type): Structured panels on the dashboard canvas, each containing a curated list of entries organized by category
2. **Category Navigator**: A sidebar/panel that shows ALL entries organized by their category panels, regardless of visibility

**Note:** This complements (does not replace) the existing:
- `EntryNavigatorPanel` (file/folder tree)
- `LinksNotePanel` (free-form Quick Links)

### Benefits

| Benefit | Description |
|---------|-------------|
| **Organization** | Group entries by project, purpose, or any criteria |
| **Scalability** | Handle 50+ entries without clutter |
| **Flexibility** | Show/hide panels to save space |
| **Completeness** | Navigator shows everything, even hidden panels |
| **Direct Access** | Navigate directly to any workspace from Navigator |
| **Familiar Pattern** | Similar to file browser (Navigator) + desktop shortcuts (Panels) |

---

## 2. Architecture

### Data Model

```typescript
// Dashboard workspace payload structure
interface DashboardPayload {
  // Existing fields...

  // NEW: Quick Links panels configuration
  quickLinksPanels: QuickLinksPanel[]

  // NEW: Uncategorized entries (not in any panel)
  uncategorizedEntryIds: string[]
}

interface QuickLinksPanel {
  id: string                    // Unique panel ID (e.g., "ql-work-projects")
  title: string                 // Display name (e.g., "Work Projects")
  icon?: string                 // Emoji or icon key (e.g., "💼")
  color?: string                // Optional accent color
  entryIds: string[]            // Ordered list of entry IDs in this panel
  visible: boolean              // Whether panel is shown on dashboard canvas
  collapsed: boolean            // Whether panel is collapsed in Navigator
  position?: { x: number; y: number }  // Canvas position (when visible)
  size?: { width: number; height: number }  // Panel dimensions
  createdAt: string             // ISO timestamp
  updatedAt: string             // ISO timestamp
}

// Entry reference (for Navigator display)
interface EntryReference {
  entryId: string
  entryName: string
  workspaces: WorkspaceReference[]
  panelId: string | null        // Which Quick Links panel it belongs to
}

interface WorkspaceReference {
  workspaceId: string
  workspaceName: string
  isDefault: boolean
  noteCount: number
}
```

### Component Hierarchy

```
MainDashboard
├── DashboardHeader
│   └── [Home button, breadcrumb, etc.]
│
├── CategoryNavigator (NEW - sidebar or floating panel)
│   ├── NavigatorHeader
│   │   ├── Title ("Categories")
│   │   ├── SearchInput
│   │   └── CollapseAllButton
│   │
│   └── NavigatorTree
│       ├── CategoryPanelNode (for each category panel)
│       │   ├── PanelHeader (icon, title, visibility badge)
│       │   └── EntryNodes (for each entry in category)
│       │       └── WorkspaceNodes (for each workspace)
│       │
│       └── UncategorizedNode
│           └── EntryNodes (entries not in any category)
│
└── DashboardCanvas
    ├── CategoryPanel (multiple, draggable - NEW panel type)
    │   ├── PanelHeader (icon, title, menu)
    │   └── EntryList
    │       └── EntryItem (click to navigate)
    │
    ├── EntryNavigatorPanel (existing - file/folder tree)
    ├── LinksNotePanel (existing - free-form Quick Links)
    ├── RecentPanel (existing)
    ├── ContinuePanel (existing)
    └── [Other dashboard components]
```

---

## 3. Implementation Phases

### Phase 1: Data Model & API

**Scope:** Add Category Panel data structure and API endpoints

**Files to Create/Modify:**
- `types/dashboard.ts` - Add CategoryPanel types
- `lib/dashboard/panel-registry.ts` - Register new `category` panel type
- `app/api/dashboard/categories/route.ts` - CRUD for category panels
- `lib/dashboard/category-store.ts` - Client-side state management

**API Endpoints:**

```typescript
// GET /api/dashboard/categories
// Returns all category panels for the user's main dashboard
Response: {
  panels: CategoryPanel[]
  uncategorizedEntryIds: string[]
}

// POST /api/dashboard/categories
// Create a new category panel
Body: { title: string, icon?: string }
Response: { panel: CategoryPanel }

// PATCH /api/dashboard/categories/[panelId]
// Update panel (title, icon, visibility, position, entries)
Body: Partial<CategoryPanel>
Response: { panel: CategoryPanel }

// DELETE /api/dashboard/categories/[panelId]
// Delete panel (entries become uncategorized)
Response: { success: true }

// POST /api/dashboard/categories/[panelId]/entries
// Add entry to panel
Body: { entryId: string, position?: number }
Response: { panel: CategoryPanel }

// DELETE /api/dashboard/categories/[panelId]/entries/[entryId]
// Remove entry from panel (becomes uncategorized)
Response: { panel: CategoryPanel }

// POST /api/dashboard/categories/move-entry
// Move entry between panels
Body: { entryId: string, fromPanelId: string | null, toPanelId: string | null, position?: number }
Response: { success: true }
```

**Database Changes:**

Option A: Store in dashboard workspace payload (recommended for MVP)
```sql
-- No schema changes needed
-- Quick Links panels stored in note_workspaces.payload for the main dashboard workspace
```

Option B: Dedicated table (for future scalability)
```sql
CREATE TABLE category_panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  dashboard_workspace_id UUID REFERENCES note_workspaces(id),
  title TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  entry_ids UUID[] NOT NULL DEFAULT '{}',
  visible BOOLEAN NOT NULL DEFAULT true,
  collapsed BOOLEAN NOT NULL DEFAULT false,
  position JSONB,
  size JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_category_panels_user ON category_panels(user_id);
CREATE INDEX idx_category_panels_dashboard ON category_panels(dashboard_workspace_id);
```

**Acceptance Criteria:**
- [ ] CategoryPanel type defined in `types/dashboard.ts`
- [ ] New `category` panel type registered in `lib/dashboard/panel-registry.ts`
- [ ] API endpoints implemented and tested
- [ ] Panels persist in dashboard workspace payload
- [ ] Coexists with existing `links_note` (LinksNotePanel) - no migration needed initially

---

### Phase 2: Multiple Category Panels on Dashboard

**Scope:** Enable multiple Category panels on the dashboard canvas

**Files to Modify:**
- `components/dashboard/DashboardView.tsx` - Render category panels
- `components/dashboard/panels/CategoryPanel.tsx` - NEW: Category panel component (follows `BaseDashboardPanel` pattern)

**Key Changes:**

1. **CategoryPanel Component:**
```typescript
// components/dashboard/panels/CategoryPanel.tsx
// Follows same pattern as EntryNavigatorPanel, RecentPanel, etc.

interface CategoryPanelProps extends BasePanelProps {
  // Inherits panel, onClose, onConfigChange, onNavigate, isActive
}

interface CategoryPanelConfig extends PanelConfig {
  title: string
  icon?: string
  entryIds: string[]  // Ordered list of entry IDs in this category
}
```

2. **Panel Header Menu:**
```
┌─────────────────────────────────┐
│ 💼 Work Projects    [⋮] [×]    │
│─────────────────────────────────│
│  ⋮ Menu options:               │
│  ├── Rename category           │
│  ├── Change icon               │
│  ├── Hide from canvas          │
│  ├── ──────────────            │
│  └── Delete category           │
└─────────────────────────────────┘
```

3. **Add Entry Flow:**
- Click "+ Add Entry" at bottom of panel
- Shows dropdown/modal with entries not in this category
- Or drag entry from Category Navigator into panel

4. **Create New Category:**
- Add "Category" to panel type picker (same as adding Recent, Navigator, etc.)
- Modal to set title and icon

**Acceptance Criteria:**
- [ ] Category panels render on dashboard canvas
- [ ] Follows existing panel pattern (draggable, resizable via `BaseDashboardPanel`)
- [ ] Panel CRUD operations work (create, rename, delete)
- [ ] Entries can be added/removed from categories
- [ ] Panel visibility toggle works (hide/show on canvas)
- [ ] Panels persist across sessions
- [ ] Coexists with existing LinksNotePanel (free-form Quick Links)

---

### Phase 3: Category Navigator Component

**Scope:** Create the Category Navigator sidebar/panel

**NOTE:** This is SEPARATE from the existing `EntryNavigatorPanel` which shows file/folder hierarchy.
The Category Navigator shows the hierarchy of Category Panels → Entries → Workspaces.

**Files to Create:**
- `components/dashboard/panels/CategoryNavigatorPanel.tsx` - Main navigator panel (follows `BaseDashboardPanel` pattern)
- `lib/hooks/use-category-navigator.ts` - Data fetching and state

**Reusable patterns from existing code:**
- `EntryNavigatorPanel.tsx` - Virtual scrolling, tree flattening, expand/collapse logic
- `BaseDashboardPanel.tsx` - Panel wrapper with header, close button, actions

**Component Design:**

```typescript
// components/dashboard/panels/CategoryNavigatorPanel.tsx

interface CategoryNavigatorProps extends BasePanelProps {
  // Inherits panel, onClose, onConfigChange, onNavigate, isActive
}

// Navigator tree node types
type CategoryNavNode =
  | { type: 'category'; categoryPanel: CategoryPanel; children: CategoryNavNode[] }
  | { type: 'uncategorized'; children: CategoryNavNode[] }
  | { type: 'entry'; entry: EntryReference; children: CategoryNavNode[] }
  | { type: 'workspace'; workspace: WorkspaceReference }
```

**Navigator Features:**

| Feature | Description |
|---------|-------------|
| **Tree View** | Collapsible hierarchy: Category > Entry > Workspace |
| **Search** | Filter entries by name |
| **Visibility Badge** | Shows which category panels are hidden on canvas |
| **Direct Navigation** | Click entry → entry dashboard, click workspace → workspace directly |
| **Drag & Drop** | Drag entries between categories |
| **Context Menu** | Right-click for options (navigate, move, show/hide category) |
| **Collapse All** | Button to collapse entire tree |
| **Keyboard Navigation** | Arrow keys, Enter to select |

**Visual Design:**

```
┌────────────────────────────────────┐
│ 📂 Categories           [🔍] [−]  │
│────────────────────────────────────│
│ 🔍 Search entries...               │
│────────────────────────────────────│
│ ▼ 💼 Work Projects                 │
│   │ ▶ 📁 Project Alpha     [3]    │
│   │ ▼ 📁 Project Beta             │
│   │   │ └─ 📋 Default Workspace   │
│   │   │ └─ 📋 Research            │
│   │ ▶ 📁 Client X          [1]    │
│                                    │
│ ▼ 🏠 Personal                      │
│   │ ▶ 📁 Health Notes      [1]    │
│   │ ▶ 📁 Travel Plans      [2]    │
│                                    │
│ ▶ 📚 Learning          [hidden]   │
│   │ (2 entries)                    │
│                                    │
│ ▶ 📭 Uncategorized                 │
│   │ (1 entry)                      │
└────────────────────────────────────┘

Legend:
[3] = workspace count
[hidden] = category panel not visible on canvas
▼/▶ = expanded/collapsed
```

**Acceptance Criteria:**
- [ ] Category Navigator renders as dashboard panel (follows BaseDashboardPanel pattern)
- [ ] Tree shows all categories, entries, and workspaces
- [ ] Search filters entries by name
- [ ] Hidden category panels show indicator badge
- [ ] Click entry → navigate to entry dashboard
- [ ] Click workspace → navigate directly to workspace
- [ ] Drag entry to move between categories
- [ ] Right-click context menu works
- [ ] Keyboard navigation works (reuse pattern from EntryNavigatorPanel)
- [ ] Collapse/expand nodes works
- [ ] Collapse all button works

---

### Phase 4: Integration & Polish

**Scope:** Integrate Category Navigator with Dashboard, add polish and edge cases

**Tasks:**

1. **Dashboard Integration:**
   - Category Navigator is just another panel type (like EntryNavigatorPanel)
   - User can add it via panel picker
   - Persists position/size like other panels

2. **Drag & Drop Between Navigator and Category Panels:**
   - Drag entry from Category Navigator to Category Panel on canvas
   - Visual feedback during drag
   - Drop zones highlight

3. **Entry Addition Flow:**
   - When adding entry to a category, show entry picker (entries not in this category)
   - Or drag from file navigator (EntryNavigatorPanel) or Category Navigator

4. **Empty States:**
   - No categories yet: "Create your first category panel"
   - Category with no entries: "Drag entries here or click + to add"
   - No uncategorized entries: Hide the section

5. **Loading States:**
   - Skeleton loader for Category Navigator tree (reuse pattern from EntryNavigatorPanel)
   - Loading spinner for category operations

6. **Keyboard Shortcuts:**
   - Arrow keys to navigate tree
   - Enter to select/navigate
   - Delete to remove entry from category (with confirmation)

7. **Accessibility:**
   - ARIA labels for tree nodes
   - Focus management
   - Screen reader announcements for actions

**Acceptance Criteria:**
- [ ] Category Navigator panel can be added via panel picker
- [ ] Category Navigator persists position/size like other panels
- [ ] Drag & drop works between Category Navigator and Category Panels
- [ ] Entry picker shows entries not in current category
- [ ] Empty states display correctly
- [ ] Loading states display correctly
- [ ] Keyboard shortcuts work
- [ ] Accessibility requirements met

---

### Phase 5: Feature Flag & Future Migration

**Scope:** Feature flag for gradual rollout; migration only if needed

**Strategy:**

1. **No Migration Needed Initially:**
   - Category Panels are a NEW panel type, not a replacement
   - Existing `LinksNotePanel` (free-form Quick Links) continues to work
   - Users can add Category Panels alongside existing panels

2. **Feature Flag:**
   - `NEXT_PUBLIC_CATEGORY_PANELS=true` to enable new panel types
   - Allows gradual rollout

3. **Optional Future Migration:**
   - If we decide to deprecate `LinksNotePanel`, create migration script
   - Parse existing links_note content and categorize entries
   - This is NOT part of initial implementation

**Acceptance Criteria:**
- [ ] Feature flag controls Category Panel and Category Navigator availability
- [ ] Existing LinksNotePanel continues to work unchanged
- [ ] No user-facing breaking changes

---

## 4. File Change Summary

| File | Phase | Changes |
|------|-------|---------|
| `types/dashboard.ts` | 1 | Add CategoryPanel, EntryReference types |
| `lib/dashboard/panel-registry.ts` | 1 | Add `category` and `category_navigator` panel types |
| `app/api/dashboard/categories/route.ts` | 1 | NEW: Category panels CRUD |
| `app/api/dashboard/categories/[panelId]/route.ts` | 1 | NEW: Single category CRUD |
| `app/api/dashboard/categories/[panelId]/entries/route.ts` | 1 | NEW: Entry management |
| `lib/dashboard/category-store.ts` | 1 | NEW: Client state for categories |
| `components/dashboard/DashboardView.tsx` | 2 | Render category panels |
| `components/dashboard/panels/CategoryPanel.tsx` | 2 | NEW: Category panel component |
| `components/dashboard/panels/CategoryNavigatorPanel.tsx` | 3 | NEW: Category navigator panel |
| `lib/hooks/use-category-navigator.ts` | 3 | NEW: Navigator data hook |

**Existing files to reference (not modify):**
| File | Purpose |
|------|---------|
| `components/dashboard/panels/EntryNavigatorPanel.tsx` | Reuse patterns: virtual scrolling, tree flattening |
| `components/dashboard/panels/BaseDashboardPanel.tsx` | Extend for new panels |
| `components/dashboard/panels/PanelSkeletons.tsx` | Add skeleton for CategoryNavigator |

---

## 5. Testing Plan

### Unit Tests

- [ ] CategoryPanel CRUD operations
- [ ] Entry add/remove/move operations
- [ ] Category Navigator tree building from data
- [ ] Search filtering
- [ ] Drag & drop logic

### Integration Tests

- [ ] Create category panel → appears on canvas and Category Navigator
- [ ] Hide category panel → removed from canvas, still in Category Navigator
- [ ] Delete category panel → entries become uncategorized
- [ ] Move entry → updates both source and destination categories
- [ ] Navigate from Category Navigator → correct entry/workspace loads
- [ ] Existing LinksNotePanel continues to work (no regression)

### Manual Testing Checklist

- [ ] Create new Category panel
- [ ] Rename category
- [ ] Change category icon
- [ ] Delete category (entries become uncategorized)
- [ ] Add entry to category
- [ ] Remove entry from category
- [ ] Drag entry between categories
- [ ] Hide category panel from canvas
- [ ] Show hidden category panel on canvas
- [ ] Navigate to entry from Category panel
- [ ] Navigate to workspace from Category Navigator
- [ ] Search entries in Category Navigator
- [ ] Collapse/expand Category Navigator nodes
- [ ] Keyboard navigation in Category Navigator
- [ ] Verify existing LinksNotePanel (Quick Links) still works

---

## 6. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Complex drag & drop | Medium | Use proven library (dnd-kit), test thoroughly |
| Performance with many entries | Medium | Reuse virtual scrolling pattern from EntryNavigatorPanel |
| User confusion (three navigators) | Medium | Clear labeling: "Files" (existing), "Categories" (new), "Quick Links" (free-form existing) |
| Feature flag complexity | Low | Keep flag logic simple, remove after stable |
| Naming confusion during development | Low | Use "Category" prefix consistently, avoid "Entry Navigator" (already taken) |

---

## 7. Future Enhancements

After initial implementation:

1. **Category Templates**: Pre-defined category configurations (Work, Personal, etc.)
2. **Category Sharing**: Share category configurations between users
3. **Smart Categories**: Auto-populate based on rules (recent, tagged, etc.)
4. **Nested Categories**: Sub-categories for deeper organization
5. **Tags**: Entries can have tags, categories filter by tag
6. **LinksNotePanel Migration**: Tool to convert free-form Quick Links to structured categories

---

## 8. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-12-06 | Store categories in dashboard workspace payload (not separate table) | Simpler for MVP, can migrate to table later if needed |
| 2025-12-06 | Category Navigator as dashboard panel (not sidebar) | Follows existing pattern (EntryNavigatorPanel is a panel too) |
| 2025-12-06 | Entries can only be in one category (not multiple) | Simpler mental model, can add tags later for multi-categorization |
| 2025-12-06 | No migration from LinksNotePanel initially | Category Panels are additive, not a replacement; existing Quick Links continues to work |
| 2025-12-06 | Use "Category" naming (not "Quick Links") | Avoids confusion with existing LinksNotePanel which is called "Quick Links" in UI |

---

## 9. Estimated Effort

| Phase | Estimated Effort | Dependencies |
|-------|------------------|--------------|
| Phase 1: Data Model & API | 4-6 hours | None |
| Phase 2: Category Panels | 6-8 hours | Phase 1 |
| Phase 3: Category Navigator | 6-8 hours | Phase 1 (reduced: reuse patterns from EntryNavigatorPanel) |
| Phase 4: Integration & Polish | 4-6 hours | Phase 2, 3 |
| Phase 5: Feature Flag | 1-2 hours | Phase 1 |

**Total: 21-30 hours** (3-4 days of focused work)

---

*Document created: 2025-12-06*
*Last updated: 2025-12-06 (Verified against existing codebase)*
