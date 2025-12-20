# Note Switcher Migration: Toolbar to iOS Control Center Dock

**Date:** 2025-12-20
**Status:** Completed
**Feature Slug:** `workspace/note-toolbar`

## Summary

Migrated the note switching functionality from the top workspace toolbar strip to the iOS-style Control Center dock at the bottom of the canvas. The dock now has a Notes button (📄) with a badge showing the count of open notes. Clicking the button opens a popover for switching between open notes.

## Visual Reference

The dock appears at the bottom center of the canvas:
```
┌─────────────────────────────────────────┐
│                                         │
│              Canvas Area                │
│                                         │
│                                         │
│           ┌───────────────┐             │
│           │  📄③   ⚡    │  ← Dock      │
│           └───────────────┘             │
└─────────────────────────────────────────┘
```

- **📄 (Notes Button)**: Shows open notes count badge, toggles the note switcher popover
- **⚡ (Control Center)**: Opens canvas controls panel (zoom, tools, etc.)

## Files Affected

### Core Implementation Files

| File | Changes |
|------|---------|
| `components/canvas/canvas-control-center.tsx` | Added popover rendering, new props for notes list and callbacks |
| `components/annotation-canvas-modern.tsx` | Added data transformation, passed new props to CanvasControlCenter |
| `components/workspace/annotation-workspace-canvas.tsx` | Added pass-through props for note switcher callbacks |
| `components/annotation-app-shell.tsx` | Disabled toolbar, wired up callbacks to dock |

### Supporting Files (Previously Created)

| File | Purpose |
|------|---------|
| `components/canvas/note-switcher-popover.tsx` | The popover UI component |
| `components/canvas/note-switcher-item.tsx` | Individual note item in the list |
| `components/canvas/note-switcher-button.tsx` | Button component (used for reference) |

## Data Flow

```
annotation-app-shell.tsx
    │
    │  Props passed:
    │  - openNotesForSwitcher (raw note data)
    │  - isNoteSwitcherOpen (boolean state)
    │  - onToggleNoteSwitcher (toggle callback)
    │  - onSelectNote (select callback)
    │  - onCloseNote (close callback)
    │  - onCenterNote (center callback)
    │  - isNotesLoading (loading state)
    │
    ▼
MultiWorkspaceCanvasContainer / AnnotationWorkspaceCanvas
    │
    │  Passes props through
    │
    ▼
ModernAnnotationCanvas (annotation-canvas-modern.tsx)
    │
    │  Transforms data:
    │  openNotesForSwitcher → transformedOpenNotes (OpenNoteItem[])
    │
    ▼
CanvasControlCenter (canvas-control-center.tsx)
    │
    │  Renders:
    │  - Notes button with badge (openNotes.length)
    │  - NoteSwitcherPopover when isNoteSwitcherOpen=true
    │
    ▼
NoteSwitcherPopover → NoteSwitcherItem (for each note)
```

## Key Code Changes

### 1. Disabled Top Toolbar (`annotation-app-shell.tsx`)

```tsx
// Line 1650-1654
const workspaceToolbarStripProps = useMemo(
  () => ({
    // DISABLED: Toolbar replaced by iOS Control Center dock (canvas-control-center.tsx)
    // The dock's Notes button now handles note switching via the popover
    isVisible: false,
    // ... other props
  }),
  [...]
)
```

### 2. Added Props to CanvasControlCenter (`canvas-control-center.tsx`)

```tsx
// New props interface (lines 45-59)
// Note switcher integration (for dock Notes button)
/** Open notes for the switcher popover */
openNotes?: OpenNoteItem[];
/** Whether the note switcher popover is currently open */
isNoteSwitcherOpen?: boolean;
/** Callback to toggle the note switcher popover */
onToggleNoteSwitcher?: () => void;
/** Callback when a note is selected in the switcher */
onSelectNote?: (noteId: string) => void;
/** Callback when a note is closed from the switcher */
onCloseNote?: (noteId: string) => void;
/** Callback to center on a note */
onCenterNote?: (noteId: string) => void;
/** Whether notes are currently loading */
isNotesLoading?: boolean;
```

### 3. Popover Rendering (`canvas-control-center.tsx`)

```tsx
// Lines 330-357
{/* Note Switcher Popover */}
{isNoteSwitcherOpen && (
  <div
    style={{
      position: 'fixed',
      bottom: 100,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: Z_INDEX_PANEL + 1,
    }}
  >
    <NoteSwitcherPopover
      notes={openNotes}
      onSelectNote={(noteId) => {
        onSelectNote?.(noteId);
        onToggleNoteSwitcher?.();
      }}
      onCloseNote={(noteId) => onCloseNote?.(noteId)}
      onCenterNote={onCenterNote ? (noteId) => onCenterNote(noteId) : undefined}
      onCreateNote={() => {
        onCreateNote?.();
        onToggleNoteSwitcher?.();
      }}
      onClose={() => onToggleNoteSwitcher?.()}
      isLoading={isNotesLoading}
    />
  </div>
)}
```

### 4. Data Transformation (`annotation-canvas-modern.tsx`)

```tsx
// Lines 948-958
// Transform open notes for the note switcher popover
const transformedOpenNotes = useMemo((): OpenNoteItem[] => {
  if (!openNotesForSwitcher) return []
  return openNotesForSwitcher.map((note) => ({
    id: note.noteId,
    title: noteTitleMap?.get(note.noteId) || `Note ${note.noteId.slice(0, 6)}...`,
    lastEditedAt: note.updatedAt ? new Date(note.updatedAt).getTime() : Date.now(),
    isActive: note.noteId === noteId,
    workspaceId: workspaceId ?? '',
  }))
}, [openNotesForSwitcher, noteTitleMap, noteId, workspaceId])
```

### 5. State Management (`annotation-app-shell.tsx`)

```tsx
// Line 1229 - Shared state for note switcher popover
const [isNoteSwitcherOpen, setIsNoteSwitcherOpen] = useState(false)

// Lines 1287-1290 - Toggle callback
const toggleNoteSwitcher = useCallback(() => {
  setIsNoteSwitcherOpen(prev => !prev)
}, [])
```

### 6. Wiring Callbacks (`annotation-app-shell.tsx`)

```tsx
// Lines 1813-1820 (MultiWorkspaceCanvasContainer)
// Lines 1855-1862 (AnnotationWorkspaceCanvas)
openNotesForSwitcher={sortedOpenNotes}
isNoteSwitcherOpen={isNoteSwitcherOpen}
onToggleNoteSwitcher={toggleNoteSwitcher}
onSelectNote={(noteId) => handleNoteSelect(noteId, { source: 'toolbar-open' })}
onCloseNote={handleCloseNote}
onCenterNote={handleCenterNote}
isNotesLoading={isWorkspaceLoading || noteWorkspaceBusy}
```

## OpenNoteItem Interface

The note data must conform to this interface for the popover:

```tsx
// From components/canvas/note-switcher-item.tsx
export interface OpenNoteItem {
  id: string
  title: string
  lastEditedAt: number // timestamp in ms
  isActive: boolean
  workspaceId: string
}
```

## Popover Features

The `NoteSwitcherPopover` provides:

1. **Note List**: Shows all open notes with title and "edited X ago" timestamp
2. **Active Indicator**: Highlights the currently active note with indigo accent
3. **Hover Actions**:
   - **Crosshair button**: Center the canvas on that note's panel
   - **X button**: Close the note
4. **Create Note Button**: "+ New Note" button at the bottom
5. **Loading State**: Shows spinner when `isLoading=true`
6. **Empty State**: Shows message when no notes are open

## Testing Checklist

- [x] Clicking 📄 button toggles the popover
- [x] Badge shows correct count of open notes
- [x] Notes appear in the popover list
- [x] Clicking a note switches to it and closes popover
- [x] Center button centers the canvas on the note
- [x] Close (X) button closes the note
- [x] "+ New Note" creates a new note
- [x] Clicking outside closes the popover
- [x] Active note is highlighted
- [x] Type-check passes (`npm run type-check`)

## Rollback

To re-enable the top toolbar, change in `annotation-app-shell.tsx`:

```tsx
// From:
isVisible: false,

// To:
isVisible: !isHidden && !showConstellationPanel && !isPopupLayerActive,
```

## Future Considerations

1. **Keyboard Navigation**: Add arrow key navigation in the popover
2. **Search/Filter**: Add search box for many open notes
3. **Drag Reorder**: Allow reordering notes in the popover
4. **Persist Popover Position**: Remember if user prefers it open
