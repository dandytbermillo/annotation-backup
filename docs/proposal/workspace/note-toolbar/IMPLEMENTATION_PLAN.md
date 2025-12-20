# Note Toolbar Redesign - Popover-Based Note Switcher

**Date:** 2025-12-19
**Status:** Draft
**Feature Slug:** `note-toolbar-popover`
**Interactive Prototype:** `docs/proposal/components/workspace/note/plan/enhance/ui/dashboard-v4-unified-canvas.html`

---

## Overview

Replace the current horizontal note workspace toolbar (tabs-based) with a compact icon-based popover design that saves horizontal space and shows more information per note.

### V1 Scope (Ready for Implementation)

This plan is scoped to **existing data only**, so it can ship without new state plumbing.

**Included in V1:**
- Note title (via existing title map in `components/annotation-app-shell.tsx`)
- Last edited timestamp (`OpenWorkspaceNote.updatedAt`)
- Active note highlight
- Note count badge
- Select + close note actions
- Create new note

**Deferred to Phase 2:**
- Unsaved / syncing indicators (no current data source)
- Color indicator (no current data source)
- Per-note reload action (no current behavior defined)

### Current Design (To Be Replaced)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ WORKSPACE 4 │ New Note - D... new ⟳ × │ New Note - D... new ⟳ × │ ▼¹ │ + New Note │ ⚙️ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Problems:**
- Takes significant horizontal space
- Note titles are truncated
- Limited visibility (overflow hidden behind dropdown)
- No status indicators (unsaved, syncing)
- No timestamps

### New Design (Popover-Based)

```
┌──────┐
│ 📄 5 │  ← Single icon button with badge
└──────┘
    │
    ▼ (click)
┌──────────────────────────────────┐
│ 📄 Open Notes                  × │
├──────────────────────────────────┤
│ █ New Note - Dec 19, 1:16 PM 1   │
│   Edited 8m ago                  │
├──────────────────────────────────┤
│ █ New Note - Dec 19, 1:16 PM   × │
│   Edited 4m ago                  │
├──────────────────────────────────┤
│ █ Project Planning Notes - Q1...  │
│   Edited 13m ago                 │
├──────────────────────────────────┤
│ Click to switch · × to close   [+ New Note] │
└──────────────────────────────────┘
```

**Benefits:**
- Minimal horizontal footprint (single icon)
- Full note titles visible (vertical list)
- Timestamps ("Edited Xm ago")
- Quick actions on hover (close)

**Phase 2 add-ons:** status indicators, color coding, and per-note reload.

---

## Component Architecture

### Prerequisites / Data Sources

Before implementation, confirm the **actual** data sources and actions in this codebase. The plan currently uses placeholder hooks/functions and must be aligned to real ones.

**Existing sources in this repo (preferred):**
- `useCanvasWorkspace()` in `components/canvas/canvas-workspace-context.tsx` provides `openNotes`, `openNotesWorkspaceId`, `openNote`, `closeNote`, `refreshWorkspace`.
- `OpenWorkspaceNote` in `lib/workspace/types.ts` provides `noteId`, `updatedAt`, `version`, `mainPosition`.
- `useWorkspaceNoteSelection()` in `lib/hooks/annotation/use-workspace-note-selection.ts` provides `handleNoteSelect`, `handleCloseNote`, `handleCenterNote`.
- `useWorkspaceToolbarProps()` in `lib/hooks/annotation/use-workspace-toolbar-props.ts` is the current toolbar prop aggregator.
- `formatNoteLabel` + title data are currently managed in `components/annotation-app-shell.tsx` via `useKnowledgeBaseSidebar`.

**Gaps deferred to Phase 2:**
- **Unsaved / syncing status**: not currently available on `OpenWorkspaceNote`.
- **Color indicator**: no note color on `OpenWorkspaceNote`.
- **Reload note**: only `refreshWorkspace()` exists (workspace-level); per-note reload is deferred.

### Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `components/canvas/workspace-toolbar.tsx` | Major Rewrite | Replace tabs with popover button |
| `components/canvas/note-switcher-popover.tsx` | New File | Popover panel component |
| `components/canvas/note-switcher-item.tsx` | New File | Individual note item in list |
| `components/annotation-app-shell.tsx` | Minor Update | Wire any new props or data derivation |
| `lib/hooks/use-open-notes.ts` | Optional | Only if a reusable derived hook is needed |
| `styles/note-toolbar.css` or Tailwind | Modify | New styles for popover |

### Component Hierarchy

```
WorkspaceToolbar
├── NoteSwitcherButton          # Icon button with badge
│   ├── NoteIcon (📄)
│   └── NoteBadge (count)
└── NoteSwitcherPopover         # Popover panel (conditionally rendered)
    ├── PopoverHeader
    │   ├── Title ("Open Notes")
    │   └── CloseButton
    ├── NoteList
    │   └── NoteSwitcherItem[]
    │       ├── NoteInfo (title, timestamp)
    │       └── HoverActions (close)
    └── PopoverFooter
        ├── HintText
        └── NewNoteButton
```

---

## Data Model

### Open Note Item

```typescript
interface OpenNoteItem {
  id: string;                    // Note ID
  title: string;                 // Full note title (from note title map)
  lastEditedAt: number;          // Timestamp (ms) (from OpenWorkspaceNote.updatedAt)
  isActive: boolean;             // Currently selected note
  workspaceId: string;           // Parent workspace ID
  // Optional Phase 2:
  color?: string;                // If a reliable source exists
  isUnsaved?: boolean;           // Requires dirty tracking integration
  isSyncing?: boolean;           // Requires persistence state integration
}
```

**V1 uses only:** `id`, `title`, `lastEditedAt`, `isActive`, `workspaceId`.

### Hook Interface

```typescript
interface UseOpenNotesReturn {
  notes: OpenNoteItem[];
  activeNoteId: string | null;
  noteCount: number;

  // Actions
  selectNote: (noteId: string) => void;
  closeNote: (noteId: string) => void;
  createNote: () => void;
}
```

---

## Implementation Steps

### Phase 1: Create Core Components (Day 1)

#### Step 1.1: Create NoteSwitcherButton Component

```typescript
// components/canvas/note-switcher-button.tsx

interface NoteSwitcherButtonProps {
  noteCount: number;
  isOpen: boolean;
  onClick: () => void;
}

export function NoteSwitcherButton({ noteCount, isOpen, onClick }: NoteSwitcherButtonProps) {
  return (
    <button
      className={cn(
        "relative w-9 h-9 rounded-lg border border-border",
        "flex items-center justify-center",
        "hover:bg-accent/10 transition-colors",
        isOpen && "bg-accent/20 border-accent"
      )}
      onClick={onClick}
      title="Open Notes"
    >
      <FileText className="w-4 h-4" />
      {noteCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px]
                         bg-accent text-white text-[10px] font-bold rounded-full
                         flex items-center justify-center px-1">
          {noteCount}
        </span>
      )}
    </button>
  );
}
```

#### Step 1.2: Create NoteSwitcherItem Component

```typescript
// components/canvas/note-switcher-item.tsx

interface NoteSwitcherItemProps {
  note: OpenNoteItem;
  onSelect: () => void;
  onClose: () => void;
}

export function NoteSwitcherItem({ note, onSelect, onClose }: NoteSwitcherItemProps) {
  const timeAgo = formatTimeAgo(note.lastEditedAt);

  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-2.5 cursor-pointer",
        "border-b border-border transition-colors",
        "hover:bg-accent/5",
        note.isActive && "bg-accent/10"
      )}
      onClick={onSelect}
    >
      {/* Note Info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{note.title}</div>
        <div className="text-xs text-muted-foreground">Edited {timeAgo}</div>
      </div>

      {/* Hover Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="w-6 h-6 rounded border border-border hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Close"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
```

#### Step 1.3: Create NoteSwitcherPopover Component

```typescript
// components/canvas/note-switcher-popover.tsx

interface NoteSwitcherPopoverProps {
  notes: OpenNoteItem[];
  onSelectNote: (noteId: string) => void;
  onCloseNote: (noteId: string) => void;
  onCreateNote: () => void;
  onClose: () => void;
}

export function NoteSwitcherPopover({
  notes,
  onSelectNote,
  onCloseNote,
  onCreateNote,
  onClose
}: NoteSwitcherPopoverProps) {
  return (
    <div className="w-[340px] bg-card border border-border rounded-xl shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 font-semibold">
          <FileText className="w-4 h-4" />
          Open Notes
        </div>
        <button
          className="w-6 h-6 rounded hover:bg-accent/10"
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Note List */}
      <div className="max-h-[400px] overflow-y-auto">
        {notes.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <div>No notes open</div>
            <div className="text-xs mt-1">Click "+ New Note" to create one</div>
          </div>
        ) : (
          notes.map(note => (
            <NoteSwitcherItem
              key={note.id}
              note={note}
              onSelect={() => onSelectNote(note.id)}
              onClose={() => onCloseNote(note.id)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border">
        <span className="text-xs text-muted-foreground">
          Click to switch · × to close
        </span>
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-md
                     bg-accent/10 border border-accent text-accent
                     hover:bg-accent hover:text-white transition-colors"
          onClick={onCreateNote}
        >
          + New Note
        </button>
      </div>
    </div>
  );
}
```

### Phase 2: Create Hook and State Management (Day 1-2)

#### Step 2.1: Create useOpenNotes Hook (Optional)

```typescript
// lib/hooks/use-open-notes.ts
// Optional: only add if multiple components need this derived shape.
// Otherwise compute in AnnotationAppShell and pass to WorkspaceToolbar.

type UseOpenNotesOptions = {
  workspaceId: string;
  openNotes: OpenWorkspaceNote[];
  activeNoteId: string | null;
  formatNoteLabel: (noteId: string) => string;
  selectNote: (noteId: string) => void;
  closeNote: (noteId: string) => void;
};

export function useOpenNotes({
  workspaceId,
  openNotes,
  activeNoteId,
  formatNoteLabel,
  selectNote,
  closeNote
}: UseOpenNotesOptions): UseOpenNotesReturn {
  // Use handlers provided by the caller (e.g., useWorkspaceNoteSelection).

  // Transform to OpenNoteItem format
  const notes: OpenNoteItem[] = useMemo(() => {
    return openNotes.map(note => ({
      id: note.noteId,
      title: formatNoteLabel(note.noteId),
      lastEditedAt: note.updatedAt ? Date.parse(note.updatedAt) : Date.now(),
      isActive: note.noteId === activeNoteId,
      workspaceId
    }));
  }, [openNotes, activeNoteId, workspaceId]);

  // Sort: active first, then by last edited
  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => {
      if (a.isActive) return -1;
      if (b.isActive) return 1;
      return b.lastEditedAt - a.lastEditedAt;
    });
  }, [notes]);

  return {
    notes: sortedNotes,
    activeNoteId,
    noteCount: notes.length,
    selectNote,
    closeNote,
    createNote: () => { /* create new note */ }
  };
}
```

#### Reload/Close Policy (Required)

Define expected behavior before implementation:
- **Close note with unsaved changes:** Prompt? Auto-save? Block close? (must be explicit)
- **Reload note:** Deferred to Phase 2 (no per-note reload in V1).
- **Offline behavior:** If reload requires network, define error UX.

### Phase 3: Integrate into Toolbar (Day 2)

#### Step 3.1: Update WorkspaceToolbar (Existing)

```typescript
// components/canvas/workspace-toolbar.tsx

export function WorkspaceToolbar({
  notes,
  activeNoteId,
  onActivateNote,
  onCloseNote,
  onNewNote,
}: WorkspaceToolbarProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const noteCount = notes.length;

  // Close on outside click (no existing hook; use inline listener or create helper)
  useOnClickOutside(popoverRef, () => setIsPopoverOpen(false));

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPopoverOpen) {
        setIsPopoverOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isPopoverOpen]);

  const handleSelectNote = (noteId: string) => {
    onActivateNote(noteId);
    setIsPopoverOpen(false);
  };

  return (
    <div className="h-9 px-2 flex items-center border-b border-border bg-background/95">
      <div className="relative" ref={popoverRef}>
        <NoteSwitcherButton
          noteCount={noteCount}
          isOpen={isPopoverOpen}
          onClick={() => setIsPopoverOpen(!isPopoverOpen)}
        />

        {isPopoverOpen && (
          <div className="absolute top-full left-0 mt-2 z-50">
            <NoteSwitcherPopover
              notes={notes}
              onSelectNote={handleSelectNote}
              onCloseNote={onCloseNote}
              onCreateNote={() => {
                onNewNote?.();
                setIsPopoverOpen(false);
              }}
              onClose={() => setIsPopoverOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

**Note:** `useOnClickOutside` is not currently defined in this repo. Use the inline listener pattern already in `components/canvas/workspace-toolbar.tsx`, or introduce a shared helper.

### Phase 4: Remove Old Tab Components (Day 2-3)

#### Step 4.1: Identify Components to Remove

```
components/canvas/
└── workspace-toolbar.tsx     # REWRITE internals (remove tab/overflow UI)
```

#### Step 4.2: Update Imports

Search and update all imports that reference the old tab components:

```bash
# Find all references to toolbar usage
rg -n "WorkspaceToolbar|workspace-toolbar" components/
```

### Phase 5: Testing (Day 3)

#### Step 5.1: Manual Test Checklist

| Test | Steps | Expected |
|------|-------|----------|
| Open popover | Click icon button | Popover appears below button |
| Close popover (click outside) | Click outside popover | Popover closes |
| Close popover (Escape) | Press Escape key | Popover closes |
| Close popover (X button) | Click X in header | Popover closes |
| Switch note | Click note in list | Note switches, popover closes |
| Close note | Click X on note item | Note closes, removed from list |
| Create note | Click "+ New Note" | New note created, popover closes |
| Badge count | Open/close notes | Badge updates correctly |
| Timestamp | Wait 1+ minutes | "Edited Xm ago" updates |
| Active highlight | Switch notes | Active note highlighted in list |
| Empty state | Close all notes | Empty state message shown |

#### Step 5.2: Edge Cases

- [ ] Very long note titles (should truncate with ellipsis)
- [ ] Many notes (10+) - list should scroll
- [ ] Rapid clicking (debounce)
- [ ] Offline mode behavior

### Phase 6: Polish and Accessibility (Day 3)

#### Step 6.1: Keyboard Navigation

```typescript
// Add keyboard support to popover
const handleKeyDown = (e: KeyboardEvent) => {
  switch (e.key) {
    case 'ArrowDown':
      // Move to next note
      break;
    case 'ArrowUp':
      // Move to previous note
      break;
    case 'Enter':
      // Select highlighted note
      break;
    case 'Delete':
    case 'Backspace':
      // Close highlighted note (with confirmation?)
      break;
  }
};
```

#### Step 6.2: ARIA Attributes

```typescript
<button
  aria-label={`Open notes (${noteCount} open)`}
  aria-expanded={isPopoverOpen}
  aria-haspopup="menu"
>
```

```typescript
<div
  role="menu"
  aria-label="Open Notes"
>
```

**Accessibility Decision:** If you want a true modal dialog, add focus trapping and keep `aria-modal="true"`. Otherwise use menu semantics as above.

### Phase 6.3: Popover Rendering Strategy

Decide whether to render via a portal to avoid clipping by parent containers:
- **Preferred:** render in a portal (recommended if toolbar has `overflow: hidden`).
- **Alternative:** keep inline but ensure parent container allows overflow.

---

## Migration Strategy

### Option A: Feature Flag (Recommended)

```typescript
// Use feature flag for gradual rollout
const useNewNoteToolbar = useFeatureFlag('note-toolbar-popover');

return useNewNoteToolbar ? (
  <NoteSwitcherToolbar workspaceId={workspaceId} />
) : (
  <LegacyNoteTabToolbar workspaceId={workspaceId} />
);
```

### Option B: Direct Replacement

1. Create new components in parallel
2. Update imports in one commit
3. Delete old components

---

## File Structure (Final)

```
components/canvas/
├── workspace-toolbar.tsx           # Main toolbar (rewritten)
├── note-switcher-button.tsx        # NEW: Icon button with badge
├── note-switcher-popover.tsx       # NEW: Popover panel
├── note-switcher-item.tsx          # NEW: Note item in list
└── note-switcher-empty.tsx         # NEW: Empty state

lib/hooks/
├── use-open-notes.ts               # Optional: derived hook if reused
└── use-workspace-toolbar-props.ts  # Existing aggregator

styles/
└── note-toolbar.css                # NEW: Custom styles (if not using Tailwind)
```

---

## Acceptance Criteria

- [ ] Single icon button replaces horizontal tab bar
- [ ] Badge shows count of open notes
- [ ] Click opens vertical popover list
- [ ] Full note titles visible (truncated only if very long)
- [ ] "Edited X ago" timestamp for each note
- [ ] Hover reveals close action
- [ ] Click outside or Escape closes popover
- [ ] Switch note closes popover
- [ ] "+ New Note" button in footer
- [ ] Empty state when no notes open
- [ ] Active note highlighted in list
- [ ] Keyboard navigation (up/down/enter/escape)
- [ ] Accessible (ARIA attributes)
- [ ] No horizontal space regression
- [ ] Works on all supported screen sizes

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| User confusion (new UX) | Medium | Add tooltip on first use |
| Lost functionality | High | Audit all tab features before removal |
| Performance (many notes) | Low | Virtualize list if >50 notes |
| Click-outside conflicts | Medium | Use React portal for popover |

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Core Components | 4-6 hours | None |
| Phase 2: Hook & State | 2-3 hours | Phase 1 |
| Phase 3: Integration | 2-3 hours | Phase 2 |
| Phase 4: Remove Old | 1-2 hours | Phase 3 |
| Phase 5: Testing | 2-3 hours | Phase 4 |
| Phase 6: Polish | 2-3 hours | Phase 5 |
| **Total** | **13-20 hours** | |

---

## References

- Interactive Prototype: `docs/proposal/components/workspace/note/plan/enhance/ui/dashboard-v4-unified-canvas.html`
- Design Inspiration: Notification Center pattern (same codebase)
- Similar Pattern: Workspace Switcher (if implemented)
