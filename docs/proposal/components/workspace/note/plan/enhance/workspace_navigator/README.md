# Category Navigator & Multiple Category Panels

**Feature Slug:** `workspace_navigator`
**Status:** PLANNING

---

## Quick Summary

This feature introduces a **two-layer navigation system** for organizing entries and workspaces by user-defined categories:

1. **Multiple Category Panels** - Structured panels on the dashboard canvas for organizing entries by category
2. **Category Navigator** - A panel that shows ALL entries organized by their categories, even those in hidden panels

**Important:** This is SEPARATE from existing components:
- **EntryNavigatorPanel** (existing) - File/folder tree from `items` table
- **LinksNotePanel** (existing) - Free-form "Quick Links" with embedded workspace links
- **Category Panels** (new) - Structured category lists with curated entries

---

## The Problem

Current main dashboard has Quick Links as a free-form `LinksNotePanel`. While this works for creating ad-hoc workspace links, it lacks:
- Structured organization by category
- Multiple panels for different purposes
- A master navigator showing all categorized entries
- Ability to hide/show category panels while keeping access

---

## The Solution

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ┌──────────────────────┐                                                │
│ │ 📂 Categories        │  Dashboard Canvas                              │
│ │──────────────────────│  ┌─────────────────┐  ┌─────────────────┐     │
│ │ 💼 Work Projects     │  │ 💼 Work         │  │ 🏠 Personal     │     │
│ │   • Project Alpha    │  │ • Project Alpha │  │ • Health Notes  │     │
│ │   • Project Beta     │  │ • Project Beta  │  │ • Travel        │     │
│ │ 🏠 Personal          │  └─────────────────┘  └─────────────────┘     │
│ │   • Health Notes     │                                                │
│ │ 📚 Learning [hidden] │  (Category panels can be shown/hidden)        │
│ │   • Programming      │                                                │
│ └──────────────────────┘                                                │
└─────────────────────────────────────────────────────────────────────────┘
```

**Benefits:**
- ✅ Organize entries by category
- ✅ Show/hide category panels to save space
- ✅ Category Navigator shows everything (even hidden)
- ✅ Direct navigation to any workspace
- ✅ Scalable to 50+ entries
- ✅ Coexists with existing file navigator and Quick Links

---

## Key Components

| Component | Purpose |
|-----------|---------|
| **CategoryPanel** | Draggable panel on canvas with curated list of entries |
| **CategoryNavigatorPanel** | Panel showing all categories → entries → workspaces |
| **API Endpoints** | CRUD for categories, entry assignment |

---

## Existing Components (Not Modified)

| Component | Purpose |
|-----------|---------|
| **EntryNavigatorPanel** | File/folder tree (items table hierarchy) |
| **LinksNotePanel** | Free-form Quick Links (contenteditable with workspace links) |

---

## Implementation Phases

1. **Phase 1**: Data Model & API
2. **Phase 2**: Multiple Category Panels on Dashboard
3. **Phase 3**: Category Navigator Panel
4. **Phase 4**: Integration & Polish
5. **Phase 5**: Feature Flag & Future Migration

**Estimated Total:** 21-30 hours (3-4 days)

---

## Files in This Directory

| File | Description |
|------|-------------|
| `IMPLEMENTATION_PLAN.md` | Full implementation plan with all phases |
| `README.md` | This overview document |

---

## Dependencies

- Requires `merge_dashboard_workspace` feature (completed)
- Uses existing dashboard workspace payload for storage
- Reuses patterns from `EntryNavigatorPanel` (virtual scrolling, tree view)

---

*Created: 2025-12-06*
*Last updated: 2025-12-06 (Verified against existing codebase)*
