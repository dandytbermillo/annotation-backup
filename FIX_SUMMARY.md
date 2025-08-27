# TipTap Editor Content Isolation Fix

## Problem
1. New notes were showing content from other notes
2. Content was duplicating when switching between notes
3. The persistence key `panel-main` was shared across all notes

## Root Cause
The Y.Doc persistence was using only the panel ID (e.g., "panel-main") as the storage key. Since all notes have a "main" panel, they were sharing the same persisted data.

## Solution Applied
Updated the persistence keys in `lib/yjs-provider.ts` to include the note ID:

### Before:
```typescript
await enhancedProvider.persistence.persist(`panel-${panelId}`, update)
enhancedProvider.persistence.load(`panel-${panelId}`)
```

### After:
```typescript
await enhancedProvider.persistence.persist(`${noteId || 'default'}-panel-${panelId}`, update)
enhancedProvider.persistence.load(`${noteId || 'default'}-panel-${panelId}`)
```

## Result
- Each note now has its own isolated persistence namespace
- New notes start with empty content
- No more content duplication between notes
- PostgreSQL stores data with keys like `note-1234567890-panel-main`

## Testing
1. Create a new note - it should start empty
2. Add content to the note
3. Switch to another note
4. Create another new note - it should also start empty
5. Switch back to the first note - content should be preserved

The fix ensures proper data isolation while maintaining all collaborative features and PostgreSQL persistence.