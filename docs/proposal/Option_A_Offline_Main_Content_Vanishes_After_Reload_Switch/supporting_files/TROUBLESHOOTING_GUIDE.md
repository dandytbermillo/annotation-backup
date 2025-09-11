# Troubleshooting Guide: Content Persistence Issues

## Quick Diagnosis Checklist

### Symptoms
- [ ] Main panel content disappears on second load
- [ ] Content lost when switching between notes
- [ ] Content missing after app reload
- [ ] Branch panels work but main panel doesn't
- [ ] Content briefly appears then vanishes

### Immediate Checks

1. **Check Provider Mode**
```typescript
// In canvas-panel.tsx, verify:
const isPlainMode = isPlainModeActive()  // Should be true for Option A
```

2. **Verify Content Prop NOT Passed**
```tsx
// In canvas-panel.tsx around line 846
<TiptapEditorPlain
  // Should NOT have: content={currentBranch.content}
  provider={plainProvider}
/>
```

3. **Check Debug Logs**
```bash
# View recent logs
docker exec annotation_postgres psql -U postgres -d annotation_dev \
  -c "SELECT timestamp, action, content_preview 
      FROM debug_logs 
      ORDER BY timestamp DESC 
      LIMIT 20;"
```

## Common Issues and Solutions

### Issue 1: Content Disappears on Second Load

**Symptom:** First load works, second load shows empty editor

**Check:**
```sql
SELECT action, content_preview 
FROM debug_logs 
WHERE note_id = 'YOUR-NOTE-ID' 
ORDER BY timestamp DESC LIMIT 10;
```

**Look for:** `CONTENT_LOADED` with content followed by `CONTENT_SET_IN_EDITOR` with empty

**Solution:** Ensure `tiptap-editor-plain.tsx` has:
```typescript
// Line 166-169
setIsContentLoading(true)
// DON'T set: setLoadedContent(null)
```

### Issue 2: Empty Content Being Saved

**Symptom:** Database has empty documents overwriting good content

**Check:**
```sql
SELECT version, content, created_at 
FROM document_saves 
WHERE note_id = 'YOUR-NOTE-ID' 
ORDER BY created_at DESC;
```

**Look for:** Higher version numbers with `{"type":"doc","content":[{"type":"paragraph"}]}`

**Solution:** Ensure loading guard in onUpdate:
```typescript
if (isContentLoading) {
  return  // Don't save while loading
}
```

### Issue 3: Race Condition During Fast Switching

**Symptom:** Content lost when rapidly switching between notes

**Check:** Look for overlapping START_LOAD events in debug logs

**Solution:** Verify debounce is working:
```typescript
// Should have 800ms debounce
setTimeout(() => {
  provider.saveDocument(noteId, panelId, json)
}, 800)
```

### Issue 4: Panel ID Mismatch

**Symptom:** Content saves but can't be loaded

**Check:**
```sql
SELECT DISTINCT panel_id 
FROM document_saves 
WHERE note_id = 'YOUR-NOTE-ID';
```

**Look for:** Multiple UUIDs for what should be the same panel

**Solution:** Verify normalization:
```typescript
// Must use consistent format
uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
```

## Debug Log Patterns

### Healthy Flow
```
1. START_LOAD
2. CONTENT_LOADED (with actual content)
3. CONTENT_SET_IN_EDITOR (matching content)
4. (user edits)
5. (800ms delay)
6. Save to database
```

### Problem Flow #1: Loading Race
```
1. START_LOAD
2. onUpdate triggered (empty)  ← PROBLEM
3. CONTENT_LOADED (with content)
4. Empty content saved
```

### Problem Flow #2: Fallback Effect
```
1. START_LOAD
2. Fallback effect runs  ← PROBLEM
3. Sets empty content
4. CONTENT_LOADED (ignored)
```

### Problem Flow #3: Double Load
```
1. START_LOAD
2. START_LOAD  ← PROBLEM (duplicate)
3. CONTENT_LOADED (first)
4. CONTENT_LOADED (second, may be empty)
```

## Emergency Fixes

### Quick Fix 1: Clear Bad Data
```sql
-- Find and remove empty saves
DELETE FROM document_saves 
WHERE content = '{"type":"doc","content":[{"type":"paragraph"}]}'
  AND note_id = 'YOUR-NOTE-ID';
```

### Quick Fix 2: Reset Version Numbers
```sql
-- Reset to last good version
UPDATE document_saves 
SET version = 1 
WHERE note_id = 'YOUR-NOTE-ID' 
  AND panel_id = 'YOUR-PANEL-ID'
  AND version > 1000000;
```

### Quick Fix 3: Disable Debug Logging
```typescript
// In debug-logger.ts, add early return
export async function debugLog(...) {
  return  // Temporary disable
  // ... rest of function
}
```

## Prevention Checklist

### Before Deployment
- [ ] Run `npm run type-check`
- [ ] Run `npm run lint`
- [ ] Test create → edit → switch → return flow
- [ ] Test reload after editing
- [ ] Check debug logs for EMPTY_CONTENT_SAVE warnings

### Code Review Points
- [ ] Never pass content prop with provider
- [ ] Always check isContentLoading before saves
- [ ] Fallback effect has provider guard
- [ ] Panel ID normalization is consistent
- [ ] Version numbers are incremental (not timestamps)

## Monitoring in Production

### SQL Queries for Monitoring

**Check for empty content saves:**
```sql
SELECT COUNT(*), DATE(created_at) 
FROM document_saves 
WHERE content = '{"type":"doc","content":[{"type":"paragraph"}]}'
GROUP BY DATE(created_at)
ORDER BY DATE(created_at) DESC;
```

**Check for version overflow:**
```sql
SELECT note_id, panel_id, version 
FROM document_saves 
WHERE version > 1000000;
```

**Check session health:**
```sql
SELECT session_id, COUNT(*) as event_count,
       SUM(CASE WHEN action = 'EMPTY_CONTENT_SAVE' THEN 1 ELSE 0 END) as empty_saves
FROM debug_logs 
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY session_id
HAVING SUM(CASE WHEN action = 'EMPTY_CONTENT_SAVE' THEN 1 ELSE 0 END) > 0;
```

## Contact for Help

If issues persist after trying these solutions:
1. Collect debug logs for the session
2. Note the exact reproduction steps
3. Check browser console for errors
4. Document which of the 4 critical fixes might be missing