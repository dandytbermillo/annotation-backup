# Note Deletion Process for PostgreSQL Persistence

## Current State
The codebase currently does NOT implement note deletion from PostgreSQL. When a note is deleted from the canvas:
- The UI removes the visual panel
- YJS document state is updated (note marked as deleted)
- **PostgreSQL retains all YJS updates forever** (no cleanup)

## Proposed Implementation

### 1. Database Schema Update
Add a `deleted_at` column to support soft deletes:
```sql
ALTER TABLE notes ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE panels ADD COLUMN deleted_at TIMESTAMP;
```

### 2. Deletion Options

#### Option A: Hard Delete (Complete Removal)
```typescript
async deleteNote(noteId: string): Promise<void> {
  // Transaction to ensure consistency
  await client.query('BEGIN')
  
  // Delete in order of dependencies:
  // 1. YJS updates for note and all panels
  await client.query(
    `DELETE FROM yjs_updates WHERE doc_name = $1 OR doc_name LIKE $2`,
    [`note:${noteId}`, `panel:${noteId}:%`]
  )
  
  // 2. Snapshots
  await client.query('DELETE FROM snapshots WHERE note_id = $1', [noteId])
  
  // 3. Annotations
  await client.query('DELETE FROM annotations WHERE note_id = $1', [noteId])
  
  // 4. Panels
  await client.query('DELETE FROM panels WHERE note_id = $1', [noteId])
  
  // 5. Note itself
  await client.query('DELETE FROM notes WHERE id = $1', [noteId])
  
  await client.query('COMMIT')
}
```

#### Option B: Soft Delete (Recoverable)
```typescript
async softDeleteNote(noteId: string): Promise<void> {
  // Mark as deleted but keep data
  await client.query(
    `UPDATE notes SET deleted_at = NOW() WHERE id = $1`,
    [noteId]
  )
  
  // Update YJS document to reflect deletion
  const ydoc = await loadDocument(`note:${noteId}`)
  ydoc.getMap('metadata').set('deleted', true)
  ydoc.getMap('metadata').set('deletedAt', new Date().toISOString())
}
```

### 3. Integration Points

#### YJS Provider Enhancement
```typescript
// In enhanced-yjs-provider.ts
class EnhancedYJSProvider {
  async deleteNote(noteId: string): Promise<void> {
    // 1. Update YJS state
    const notesMap = this.mainDoc.getMap('notes')
    notesMap.delete(noteId)
    
    // 2. Remove subdocs
    const noteDoc = this.editorCache.get(`note:${noteId}`)
    if (noteDoc) {
      noteDoc.destroy()
      this.editorCache.delete(`note:${noteId}`)
    }
    
    // 3. Trigger PostgreSQL deletion
    if (this.persistence.deleteNote) {
      await this.persistence.deleteNote(noteId)
    }
  }
}
```

#### API Route
```typescript
// app/api/notes/[noteId]/route.ts
export async function DELETE(
  request: Request,
  { params }: { params: { noteId: string } }
) {
  const adapter = new PostgresAdapter()
  await adapter.deleteNote(params.noteId)
  
  return NextResponse.json({ success: true })
}
```

#### UI Integration
```typescript
// In canvas component
async function handleDeleteNote(noteId: string) {
  if (!confirm('Delete this note? This action cannot be undone.')) {
    return
  }
  
  try {
    // Remove from UI immediately
    removePanel(noteId)
    
    // Delete from backend
    await fetch(`/api/notes/${noteId}`, { method: 'DELETE' })
    
    // Update YJS state
    provider.deleteNote(noteId)
  } catch (error) {
    console.error('Failed to delete note:', error)
    // Restore UI if deletion failed
  }
}
```

### 4. Considerations

1. **Cascading Deletes**: Must delete in correct order to respect foreign keys
2. **Performance**: Use transactions for consistency
3. **Recovery**: Soft delete allows recovery; hard delete is permanent
4. **Sync**: Other clients need to be notified of deletion
5. **Storage**: Hard delete frees space; soft delete retains history

### 5. Recommended Approach

Start with **soft delete** for safety:
- Add `deleted_at` timestamps
- Filter out deleted notes in queries
- Allow recovery via admin interface
- Periodic cleanup of old soft-deleted notes

This preserves the YJS event-sourcing model while providing logical deletion.