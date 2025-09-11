# Exact Code Fixes Reference

**Date:** 2025-09-11  
**Purpose:** Preserve the exact code changes that fixed the main panel content persistence issue for future reference

## Critical Fix #1: Remove Content Prop When Using Provider

### File: `components/canvas/canvas-panel.tsx`

#### Before (BROKEN):
```tsx
// Line 844-856
) : isPlainMode ? (
  plainProvider ? (
    <TiptapEditorPlain
      ref={editorRef as any}
      content={currentBranch.content}  // ❌ THIS WAS THE PROBLEM
      isEditable={true}
      noteId={currentNoteId || ''}
      panelId={panelId}
      onUpdate={(content) => handleUpdate(typeof content === 'string' ? content : JSON.stringify(content))}
      onSelectionChange={handleSelectionChange}
      placeholder={`Start writing your ${currentBranch.type || 'note'}...`}
      provider={plainProvider}
    />
```

#### After (FIXED):
```tsx
// Line 844-856
) : isPlainMode ? (
  plainProvider ? (
    <TiptapEditorPlain
      ref={editorRef as any}
      // DON'T pass content when using provider to avoid triggering fallback effect
      isEditable={true}  // TEMPORARILY: Always editable
      noteId={currentNoteId || ''}
      panelId={panelId}
      onUpdate={(content) => handleUpdate(typeof content === 'string' ? content : JSON.stringify(content))}
      onSelectionChange={handleSelectionChange}
      placeholder={`Start writing your ${currentBranch.type || 'note'}...`}
      provider={plainProvider}
    />
```

**Why This Fixed It:** When using PlainOfflineProvider, content should ONLY come from the provider's `loadDocument()` method. Passing the content prop triggered the fallback content effect which could overwrite the loaded content with stale or empty data.

---

## Critical Fix #2: Prevent Setting Null During Load

### File: `components/canvas/tiptap-editor-plain.tsx`

#### Before (BROKEN):
```tsx
// Line 166-169
setIsContentLoading(true)
setLoadedContent(null)  // ❌ THIS TRIGGERED FALLBACK EFFECT
```

#### After (FIXED):
```tsx
// Line 166-169
setIsContentLoading(true)
// DON'T clear loaded content here - it causes the fallback effect to trigger
// The loaded content will be updated when the new content arrives
```

**Why This Fixed It:** Setting loadedContent to null while loading triggered the fallback content useEffect, which would see !loadedContent as true and potentially apply empty fallback content.

---

## Critical Fix #3: Guard Against Saving During Load

### File: `components/canvas/tiptap-editor-plain.tsx`

#### Before (BROKEN):
```tsx
// Line 350-401 (onUpdate handler)
onUpdate: ({ editor }) => {
  const json = editor.getJSON()
  // Hash current content to detect real changes
  const contentStr = JSON.stringify(json)
  ;(window as any).__lastContentHash = (window as any).__lastContentHash || new Map()
  const key = `${noteId}:${panelId}`
  const prev = (window as any).__lastContentHash.get(key)
  if (prev === contentStr) return
  (window as any).__lastContentHash.set(key, contentStr)

  // ❌ NO CHECK FOR LOADING STATE - COULD SAVE EMPTY CONTENT

  // Store the latest content globally for emergency saves
  ;(window as any).__latestContent = (window as any).__latestContent || new Map()
  ;(window as any).__latestContent.set(key, json)
  
  // Debounce saves...
```

#### After (FIXED):
```tsx
// Line 350-401 (onUpdate handler)
onUpdate: ({ editor }) => {
  const json = editor.getJSON()
  // Hash current content to detect real changes
  const contentStr = JSON.stringify(json)
  ;(window as any).__lastContentHash = (window as any).__lastContentHash || new Map()
  const key = `${noteId}:${panelId}`
  const prev = (window as any).__lastContentHash.get(key)
  if (prev === contentStr) return
  (window as any).__lastContentHash.set(key, contentStr)

  // CRITICAL: Don't save empty content if we're still loading
  if (isContentLoading) {
    console.log(`[TiptapEditorPlain-${panelId}] Skipping save - still loading content`)
    return
  }

  // Log when we're about to save empty content
  const isEmpty = !json.content || json.content.length === 0 || 
    (json.content.length === 1 && json.content[0].type === 'paragraph' && !json.content[0].content)
  
  if (isEmpty) {
    console.warn(`[TiptapEditorPlain-${panelId}] WARNING: Saving empty content for note ${noteId}, panel ${panelId}`)
    debugLog('TiptapEditorPlain', 'EMPTY_CONTENT_SAVE', {
      noteId,
      panelId,
      contentPreview: createContentPreview(json),
      metadata: { 
        isLoading: isContentLoading,
        hasLoadedContent: !!loadedContent,
        trigger: 'onUpdate'
      }
    })
  }

  // Store the latest content globally for emergency saves
  ;(window as any).__latestContent = (window as any).__latestContent || new Map()
  ;(window as any).__latestContent.set(key, json)
  
  // Debounce saves...
```

**Why This Fixed It:** Prevents saving content while the editor is still loading from the database, which could result in saving empty content over real content.

---

## Critical Fix #4: Strengthen Fallback Content Guard

### File: `components/canvas/tiptap-editor-plain.tsx`

#### Before (BROKEN):
```tsx
// Line 548-563 (fallback content effect)
useEffect(() => {
  if (editor && !provider && !isContentLoading && !loadedContent && content !== undefined) {
    const currentJSON = editor.getJSON()
    const newContent = typeof content === 'string' 
      ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] }
      : content
    
    // Only update if content actually changed
    if (JSON.stringify(currentJSON) !== JSON.stringify(newContent)) {
      editor.commands.setContent(newContent)
    }
  }
}, [editor, content, isContentLoading, loadedContent, provider])
```

#### After (FIXED):
```tsx
// Line 548-570 (fallback content effect)
useEffect(() => {
  // NEVER use fallback content when we have a provider
  if (provider) return
  
  if (editor && !isContentLoading && !loadedContent && content !== undefined && content !== '') {
    const currentJSON = editor.getJSON()
    const newContent = typeof content === 'string' 
      ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] }
      : content
    
    // Only update if content actually changed and is not empty
    const isEmpty = !newContent.content || newContent.content.length === 0 ||
      (newContent.content.length === 1 && newContent.content[0].type === 'paragraph' && !newContent.content[0].content)
    
    if (!isEmpty && JSON.stringify(currentJSON) !== JSON.stringify(newContent)) {
      console.log(`[TiptapEditorPlain-${panelId}] Setting fallback content (no provider mode)`)
      editor.commands.setContent(newContent)
    }
  }
}, [editor, content, isContentLoading, loadedContent, provider, panelId])
```

**Why This Fixed It:** Added explicit early return when provider exists, preventing any possibility of fallback content being applied when using PlainOfflineProvider.

---

## Supporting Fix: Panel ID Normalization

### File: `app/api/postgres-offline/documents/route.ts`

#### The Correct Pattern (preserved):
```tsx
// Line 16-19
const normalizePanelId = (noteId: string, panelId: string): string => {
  if (isUuid(panelId)) return panelId
  return uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
}
```

**Important:** This uses `${noteId}:${panelId}` format with colon separator and `uuidv5.DNS` namespace. This must be consistent across all endpoints.

---

## Debug Logging Code Added

### File: `lib/debug-logger.ts` (Complete File)
```typescript
// Debug logger for tracking content persistence issues
let sessionId = typeof window !== 'undefined' 
  ? `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  : 'server'

export async function debugLog(
  component: string,
  action: string,
  data: {
    noteId?: string
    panelId?: string
    contentPreview?: string
    metadata?: any
  }
) {
  try {
    // Log to console
    console.log(`[DEBUG ${component}] ${action}:`, data)
    
    // Log to database
    await fetch('/api/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component,
        action,
        noteId: data.noteId,
        panelId: data.panelId,
        contentPreview: data.contentPreview?.substring(0, 500), // Limit preview size
        metadata: data.metadata,
        sessionId
      })
    })
  } catch (error) {
    console.error('[Debug Logger] Failed to log:', error)
  }
}

export function getSessionId() {
  return sessionId
}

// Helper to create a content preview
export function createContentPreview(content: any): string {
  if (!content) return 'null'
  if (typeof content === 'string') return content.substring(0, 100)
  try {
    const str = JSON.stringify(content)
    return str.substring(0, 200)
  } catch {
    return 'invalid content'
  }
}
```

---

## Database Schema for Debug Logging

### File: `migrations/007_debug_logs.up.sql`
```sql
-- Create debug logs table for tracking content persistence issues
CREATE TABLE IF NOT EXISTS debug_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  component VARCHAR(100),
  action VARCHAR(100),
  note_id UUID,
  panel_id VARCHAR(255),
  content_preview TEXT,
  metadata JSONB,
  session_id VARCHAR(100)
);

-- Create index for faster queries
CREATE INDEX idx_debug_logs_timestamp ON debug_logs(timestamp DESC);
CREATE INDEX idx_debug_logs_note_panel ON debug_logs(note_id, panel_id);
CREATE INDEX idx_debug_logs_session ON debug_logs(session_id);

-- Optional: Auto-cleanup old logs after 7 days
CREATE OR REPLACE FUNCTION cleanup_old_debug_logs() 
RETURNS void AS $$
BEGIN
  DELETE FROM debug_logs WHERE timestamp < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;
```

---

## Key Debug Log Calls Added

### In `tiptap-editor-plain.tsx`:
```typescript
// When starting to load content
debugLog('TiptapEditorPlain', 'START_LOAD', {
  noteId,
  panelId,
  metadata: { component: 'editor', action: 'start_load' }
})

// When content is loaded
debugLog('TiptapEditorPlain', 'CONTENT_LOADED', {
  noteId,
  panelId,
  contentPreview: createContentPreview(loadedDoc),
  metadata: { hasContent: !!loadedDoc, contentType: typeof loadedDoc }
})

// When content is set in editor
debugLog('TiptapEditorPlain', 'CONTENT_SET_IN_EDITOR', {
  noteId,
  panelId,
  contentPreview: createContentPreview(afterContent),
  metadata: { 
    beforeEmpty: !beforeContent.content || beforeContent.content.length === 0,
    afterEmpty: !afterContent.content || afterContent.content.length === 0,
    success: true
  }
})

// When empty content is about to be saved (warning)
debugLog('TiptapEditorPlain', 'EMPTY_CONTENT_SAVE', {
  noteId,
  panelId,
  contentPreview: createContentPreview(json),
  metadata: { 
    isLoading: isContentLoading,
    hasLoadedContent: !!loadedContent,
    trigger: 'onUpdate'
  }
})
```

---

## Testing Commands

### Verify the Fix:
```bash
# 1. Clear debug logs
docker exec annotation_postgres psql -U postgres -d annotation_dev \
  -c "DELETE FROM debug_logs;"

# 2. Start the app
npm run dev

# 3. Create a note, add content, switch notes multiple times

# 4. Check logs for the pattern
docker exec annotation_postgres psql -U postgres -d annotation_dev \
  -c "SELECT timestamp, action, content_preview FROM debug_logs 
      WHERE note_id = 'YOUR-NOTE-ID' 
      ORDER BY timestamp;"
```

### Expected Healthy Pattern:
```
START_LOAD → CONTENT_LOADED (with content) → CONTENT_SET_IN_EDITOR (same content)
```

### Previous Broken Pattern:
```
START_LOAD → CONTENT_LOADED (with content) → CONTENT_SET_IN_EDITOR (empty paragraph)
```

---

## Summary of Root Causes

1. **Content Prop Interference**: Passing content prop while using provider created conflicting sources of truth
2. **Loading State Race**: Setting loadedContent to null triggered fallback effects
3. **Missing Guards**: No check for isContentLoading before saving
4. **Weak Provider Check**: Fallback effect could still run with provider present

All four issues had to be fixed together for the solution to work reliably.