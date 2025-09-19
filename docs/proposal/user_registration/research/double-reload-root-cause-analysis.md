# Double Reload Issue - Root Cause Analysis

## Summary
The double reload issue occurs because localStorage backup restoration incorrectly overwrites fresh content on the first page reload.

## Root Cause

The issue is in `/components/canvas/tiptap-editor-plain.tsx` at line 268:

```typescript
if (age < 5 * 60 * 1000 && !providerHasContent && existingVersion === 0) {
  // Restores localStorage backup
}
```

## Why It Happens

### First Reload Sequence:
1. **PlainOfflineProvider is recreated** - New instance with empty in-memory cache
2. **localStorage backup exists** - Created during previous session (on visibility change, line 674)
3. **Restoration conditions are met:**
   - `age < 5 * 60 * 1000`: Backup is less than 5 minutes old ✓
   - `!providerHasContent`: Provider cache is empty (new instance) ✓
   - `existingVersion === 0`: No version in empty cache ✓
4. **Old localStorage content overwrites** any fresh data that should be loaded

### Second Reload Sequence:
1. **PlainOfflineProvider is recreated again** 
2. **localStorage was cleared** after first reload's restoration
3. **No localStorage backup exists** to restore
4. **Correct content loads** from database without interference

## Evidence

From the Playwright test:
```
=== CONCLUSION ===
The localStorage backup WOULD be restored on first reload
This explains why old content appears on first reload
The condition at line 230 in tiptap-editor-plain.tsx allows restoration
because the backup is less than 5 minutes old.
```

## The Problem

The logic assumes that if the provider has no content (`!providerHasContent`), then localStorage backup should be restored. However, on page reload:
- Provider is always newly created with empty cache
- This makes `providerHasContent` always false initially
- Leading to unwanted restoration of stale localStorage content

## Why Two Reloads Fix It

1. **First reload**: Restores old localStorage content, then clears localStorage after restoration
2. **Second reload**: No localStorage to restore, loads fresh content properly

## Key Code Locations

- **Restoration logic**: `/components/canvas/tiptap-editor-plain.tsx:268`
- **localStorage save on visibility**: `/components/canvas/tiptap-editor-plain.tsx:674`
- **Provider recreation**: `/lib/provider-switcher.ts` - PlainOfflineProvider created fresh each time