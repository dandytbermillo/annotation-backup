# Fix: Panels Showing Wrong Branches List & Incorrect note_id Assignment

**Date:** October 19, 2025
**Status:** ✅ RESOLVED
**Severity:** Critical - Data integrity issue

---

## Problem Statement

In a multi-note workspace, when creating annotations (branches) from different panels belonging to different notes, all annotations were being saved with the same `note_id` in the database, regardless of which panel they were created from.

### Symptoms

1. **Wrong note_id in database**: Annotations created from different panels (with different note_ids) were all saved with the same note_id
2. **Incorrect branches display**: After reload, panels showed all branches from all notes combined instead of only their own branches
3. **Data corruption**: Branch associations in the database did not match the actual panel/note relationships

### Example Scenario

Given two panels:
- **Panel A** (Left): note_id = `003722dd-0f6b-43a4-a56c-c80750158c7c`
- **Panel B** (Right): note_id = `a6bfec0e-bff3-4e30-bc85-5cf2bdb953e3`

When creating annotations:
- **Expected**: Panel A annotations → `note_id = 003722dd...`, Panel B annotations → `note_id = a6bfec0e...`
- **Actual (Bug)**: Both panels' annotations → `note_id = 003722dd...` (same ID!)

---

## Root Causes

### 1. Global noteId Used Instead of Panel-Specific noteId

**File:** `components/canvas/annotation-toolbar.tsx`

**Problem:**
```typescript
// BEFORE (Wrong):
export function AnnotationToolbar() {
  const { dispatch, state, dataStore, noteId } = useCanvas()

  const createAnnotation = (type: 'note' | 'explore' | 'promote') => {
    const text = state.selectedText
    const panel = state.currentPanel

    // ❌ Using global noteId from canvas context
    const draftBranch = createAnnotationBranch(type, panel, noteId || '', text, smartPosition)

    plainProvider.createBranch({
      id: annotationId,
      noteId: noteId,  // ❌ Wrong! All panels use same global noteId
      parentId: panel,
      type: type,
      // ...
    })
  }
}
```

**Issue:** The `noteId` from `useCanvas()` is a global canvas context value. In a multi-note workspace where different panels belong to different notes, this global value doesn't reflect the specific panel's note.

### 2. Actions Panel Using Wrong noteId Variable

**File:** `components/canvas/canvas-panel.tsx` (lines 3459, 3504, 3549)

**Problem:**
```typescript
// BEFORE (Wrong):
export function CanvasPanel({ panelId, branch, position, width, onClose, noteId }: CanvasPanelProps) {
  const effectiveNoteId = noteId || contextNoteId || ''  // ✅ Correct noteId for this panel

  // ... later in Actions panel buttons:
  window.dispatchEvent(new CustomEvent('set-annotation-panel', {
    detail: { panelId, noteId }  // ❌ Using prop noteId instead of effectiveNoteId
  }))
}
```

**Issue:** The component calculates `effectiveNoteId` at line 68 and uses it for all operations, but the Actions panel buttons were using the raw `noteId` prop instead.

### 3. Race Condition: Event Dispatch vs Button Click

**File:** `components/canvas/canvas-panel.tsx` (lines 3458-3461)

**Problem:**
```typescript
// BEFORE (Race condition):
window.dispatchEvent(new CustomEvent('set-annotation-panel', {
  detail: { panelId, noteId }
}))
noteButton.click()  // ❌ Clicked immediately, before event is processed!
```

**Issue:** The `set-annotation-panel` event was dispatched and the annotation button was clicked **synchronously**, but React's `useEffect` hook that listens for the event runs asynchronously. The state hadn't updated yet when the button was clicked.

---

## Solutions Implemented

### Solution 1: Extract Panel-Specific noteId in AnnotationToolbar

**File:** `components/canvas/annotation-toolbar.tsx`

**Added:**
1. State to store override panel info from Tools button
2. Event listener for `set-annotation-panel` event
3. Logic to extract noteId from panel's composite key in dataStore

**Changes:**
```typescript
// AFTER (Fixed):
import React from "react"

export function AnnotationToolbar() {
  const { dispatch, state, dataStore, noteId } = useCanvas()
  const [overridePanelInfo, setOverridePanelInfo] = React.useState<{ panelId: string; noteId: string } | null>(null)

  // Listen for panel-specific annotation creation requests from Tools button
  React.useEffect(() => {
    const handleSetAnnotationPanel = (event: Event) => {
      const customEvent = event as CustomEvent
      const { panelId, noteId } = customEvent.detail
      console.log('[AnnotationToolbar] Received set-annotation-panel event:', { panelId, noteId })
      setOverridePanelInfo({ panelId, noteId })

      // Clear the override after 5 seconds (in case button isn't clicked)
      setTimeout(() => setOverridePanelInfo(null), 5000)
    }

    window.addEventListener('set-annotation-panel', handleSetAnnotationPanel)
    return () => window.removeEventListener('set-annotation-panel', handleSetAnnotationPanel)
  }, [])

  const createAnnotation = (type: 'note' | 'explore' | 'promote') => {
    const text = state.selectedText
    const panel = overridePanelInfo?.panelId || state.currentPanel  // ✅ Use override if available

    // ✅ Use override noteId if available, otherwise extract from dataStore
    let panelNoteId = overridePanelInfo?.noteId || noteId

    // If no override, try to get noteId from dataStore
    if (!overridePanelInfo) {
      dataStore.forEach((value: any, key: string) => {
        if (value && typeof value === 'object' && 'id' in value) {
          if (value.id === panel) {
            // Extract noteId from composite key (format: "noteId::panelId")
            if (key.includes('::')) {
              panelNoteId = key.split('::')[0]
              console.log('[AnnotationToolbar] Found panel noteId from composite key:', panelNoteId, 'for panel:', panel)
            }
          }
        }
      })
    }

    console.log('[AnnotationToolbar] Creating annotation with noteId:', panelNoteId, 'for panel:', panel, 'override:', overridePanelInfo)

    // Clear the override after using it
    if (overridePanelInfo) {
      setOverridePanelInfo(null)
    }

    // ✅ Use panelNoteId everywhere
    const draftBranch = createAnnotationBranch(type, panel, panelNoteId || '', text, smartPosition)

    plainProvider.createBranch({
      id: annotationId,
      noteId: panelNoteId,  // ✅ Correct panel-specific noteId
      parentId: panel,
      type: type,
      // ...
    })
  }
}
```

### Solution 2: Use effectiveNoteId in Actions Panel

**File:** `components/canvas/canvas-panel.tsx` (lines 3460, 3506, 3552)

**Changes:**
```typescript
// AFTER (Fixed):
{/* Note Button */}
<button
  onClick={() => {
    const annotationToolbar = document.getElementById('annotation-toolbar')
    const noteButton = annotationToolbar?.querySelector('.annotation-btn.note') as HTMLButtonElement
    if (noteButton) {
      console.log('[CanvasPanel] Dispatching set-annotation-panel event:', { panelId, noteId: effectiveNoteId })
      window.dispatchEvent(new CustomEvent('set-annotation-panel', {
        detail: { panelId, noteId: effectiveNoteId }  // ✅ Use effectiveNoteId
      }))
      // Wait for the event to be processed before clicking
      setTimeout(() => noteButton.click(), 10)  // ✅ Added delay
    }
    setShowToolsDropdown(false)
    setActiveToolPanel(null)
  }}
>
  <span style={{ fontSize: '32px' }}>📝</span>
  <span>Note</span>
</button>

{/* Explore Button - Same fix */}
{/* Promote Button - Same fix */}
```

**Applied to all three buttons:** Note, Explore, Promote

### Solution 3: Add Delay Between Event and Click

**File:** `components/canvas/canvas-panel.tsx` (lines 3462, 3508, 3554)

**Changes:**
```typescript
// BEFORE (Race condition):
window.dispatchEvent(new CustomEvent('set-annotation-panel', {
  detail: { panelId, noteId: effectiveNoteId }
}))
noteButton.click()  // ❌ Immediate

// AFTER (Fixed):
window.dispatchEvent(new CustomEvent('set-annotation-panel', {
  detail: { panelId, noteId: effectiveNoteId }
}))
setTimeout(() => noteButton.click(), 10)  // ✅ 10ms delay for event processing
```

**Rationale:** The 10ms delay ensures the `useEffect` hook in `annotation-toolbar.tsx` has time to process the event and update the `overridePanelInfo` state before the button click triggers `createAnnotation()`.

---

## Affected Files

### Modified Files

1. **`components/canvas/annotation-toolbar.tsx`**
   - Added: React import
   - Added: `overridePanelInfo` state
   - Added: `useEffect` listener for `set-annotation-panel` event
   - Modified: `createAnnotation()` to use panel-specific noteId
   - Lines changed: 1-70, 185-245

2. **`components/canvas/canvas-panel.tsx`**
   - Modified: Actions panel Note button onClick (lines 3458-3464)
   - Modified: Actions panel Explore button onClick (lines 3504-3510)
   - Modified: Actions panel Promote button onClick (lines 3550-3556)
   - Changed `noteId` → `effectiveNoteId` in all three event dispatches
   - Added `setTimeout` delay in all three button clicks
   - Added console.log for debugging

### Supporting Files (No changes, but related)

- `lib/models/annotation.ts` - Defines `createAnnotationBranch` function signature
- `lib/canvas/composite-id.ts` - Defines `ensurePanelKey` for composite keys
- `lib/data-store.ts` - DataStore implementation

---

## Testing Performed

### Manual Testing

1. **Setup:**
   - Created two notes with different note_ids
   - Opened both notes side-by-side in multi-note workspace
   - Note A (Left): `003722dd-0f6b-43a4-a56c-c80750158c7c`
   - Note B (Right): `a6bfec0e-bff3-4e30-bc85-5cf2bdb953e3`

2. **Test Case 1: Create annotations from Tools button**
   - Selected text "first panel" in left panel
   - Clicked Tools (wrench icon) → Actions → Note
   - Console showed: `[CanvasPanel] Dispatching set-annotation-panel event: { panelId: 'main', noteId: '003722dd...' }`
   - Console showed: `[AnnotationToolbar] Received set-annotation-panel event: { panelId: 'main', noteId: '003722dd...' }`
   - Console showed: `[AnnotationToolbar] Creating annotation with noteId: 003722dd... override: {panelId: 'main', noteId: '003722dd...'}`

3. **Test Case 2: Verify different panels use different noteIds**
   - Selected text "second panel" in right panel
   - Clicked Tools → Actions → Note
   - Console showed: `noteId: 'a6bfec0e...'` (different from left panel!)

4. **Database Verification:**
   ```sql
   SELECT id, note_id, title FROM branches
   WHERE deleted_at IS NULL
   ORDER BY created_at DESC LIMIT 2;
   ```
   **Result:**
   ```
   id                                   | note_id                              | title
   -------------------------------------|--------------------------------------|-------------
   <uuid-1>                             | a6bfec0e-bff3-4e30-bc85-5cf2bdb953e3 | second panel
   <uuid-2>                             | 003722dd-0f6b-43a4-a56c-c80750158c7c | first panel
   ```
   ✅ **PASS**: Different note_ids!

5. **Test Case 3: Reload and verify branches display**
   - Reloaded page
   - Left panel showed only "first panel" branch ✅
   - Right panel showed only "second panel" branch ✅
   - No mixed/duplicate branches ✅

---

## Implementation Timeline

1. **Investigation Phase** (Oct 19, 2025)
   - Discovered annotations showing in wrong panels
   - Traced issue to database having wrong note_id values
   - Identified annotation-toolbar using global noteId

2. **First Fix Attempt**
   - Modified annotation-toolbar to extract noteId from dataStore
   - Bug persisted when using Tools button

3. **Second Fix Attempt**
   - Found Actions panel was using wrong `noteId` variable
   - Changed to `effectiveNoteId`
   - Bug still persisted

4. **Final Fix**
   - Discovered race condition between event dispatch and button click
   - Added 10ms setTimeout delay
   - ✅ Bug resolved

---

## Verification Commands

### Check annotations in database:
```bash
docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
"SELECT id, note_id, parent_id, type, title, original_text, created_at
FROM branches
WHERE deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 10;"
```

### Check panels and their note associations:
```bash
docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
"SELECT panel_id, note_id, type, title, created_at
FROM panels
WHERE deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 5;"
```

### Verify note IDs are different:
```bash
docker exec annotation_postgres psql -U postgres -d annotation_dev -c \
"SELECT COUNT(DISTINCT note_id) as unique_notes, COUNT(*) as total_branches
FROM branches
WHERE deleted_at IS NULL;"
```

Expected: `unique_notes` should equal the number of different panels/notes

---

## Lessons Learned

1. **Multi-note workspace context**: In multi-note workspaces, never assume a global `noteId` from context is correct for a specific panel
2. **Composite keys matter**: The `noteId::panelId` composite key pattern is essential for isolating data per note
3. **React async state**: Event dispatching and state updates are async; synchronous button clicks can race
4. **Component props vs computed values**: Always use the computed/effective value (`effectiveNoteId`) rather than raw props (`noteId`)

---

## Future Improvements

1. **Type safety**: Add TypeScript types for custom events to prevent wrong prop passing
2. **Validation**: Add runtime assertions to verify noteId matches panel's actual note before creating annotations
3. **Testing**: Add integration tests for multi-note workspace annotation creation
4. **Direct function calls**: Consider passing noteId directly to annotation creation function instead of using global event system

---

## Related Issues

- Initial report: User noticed branches not displaying after reload
- Database revealed: All annotations sharing same note_id
- Console logs showed: Global noteId being reused across different panels

---

## Status: RESOLVED ✅

All panels now correctly:
- Create annotations with their own note_id
- Display only their own branches after reload
- Maintain proper data isolation in multi-note workspaces
