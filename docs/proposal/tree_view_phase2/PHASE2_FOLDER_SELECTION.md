# Phase 2: Folder Selection for Note Creation

## Overview
Allow users to choose which folder to save their notes in, rather than defaulting to "Uncategorized".

## Implementation Approach

### 1. Update Create Note Dialog
**File**: `components/notes-explorer-phase1.tsx`

Add a folder selector dropdown in the create note dialog:
- Show tree structure in dropdown
- Default to currently selected folder (if any)
- Fall back to "Uncategorized" if no selection

### 2. Modify API to Accept Parent ID
**File**: `app/api/items/route.ts`

The POST endpoint already accepts `parentId` - we just need to pass it from the UI.

### 3. UI Changes Required

#### A. Add Folder Selector Component
```typescript
const FolderSelector = ({ 
  currentFolderId, 
  onSelect,
  folders 
}) => {
  return (
    <select 
      value={currentFolderId} 
      onChange={(e) => onSelect(e.target.value)}
      className="w-full px-3 py-2 border rounded"
    >
      <option value="">Select folder...</option>
      {folders.map(folder => (
        <option key={folder.id} value={folder.id}>
          {folder.path}
        </option>
      ))}
    </select>
  );
};
```

#### B. Update Create Note Handler
```typescript
const handleCreateNote = async () => {
  const response = await fetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'note',
      name: noteName,
      parentId: selectedFolderId || uncategorizedId, // User's choice
      metadata: {},
      position: 0
    })
  });
};
```

### 4. Additional Features

1. **Remember Last Used Folder**: Store user's last folder choice in localStorage
2. **Quick Folder Creation**: "Create new folder" option in dropdown
3. **Breadcrumb Display**: Show selected path: "Knowledge Base > Projects > New Note"
4. **Context Menu**: Right-click folder to "Create note here"

## User Flow

1. User clicks "Create New Note"
2. Dialog appears with:
   - Note name input
   - **Folder selector dropdown** (NEW)
   - Create/Cancel buttons
3. User selects target folder
4. Note is created in selected folder
5. Tree auto-expands to show new note

## Benefits

- Better organization from the start
- No need to move notes after creation
- More intuitive workflow
- Reduces clutter in Uncategorized

## Implementation Priority

This would be a **Phase 2 Priority 1** feature as it significantly improves UX.

Would you like me to implement this folder selection feature now?