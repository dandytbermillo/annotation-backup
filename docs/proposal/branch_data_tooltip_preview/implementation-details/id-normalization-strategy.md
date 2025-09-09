# ID Normalization Strategy

## Overview
The annotation system uses different ID formats in different contexts, requiring careful normalization to ensure data lookups succeed.

## ID Format Variations

### UI Format
- Pattern: `branch-<uuid>`
- Example: `branch-04742759-8d3e-4b1a-9f2e-1234567890ab`
- Used by: DOM elements, canvasDataStore, UI components

### Database Format
- Pattern: `<uuid>` (raw UUID without prefix)
- Example: `04742759-8d3e-4b1a-9f2e-1234567890ab`
- Used by: PostgreSQL, API endpoints, plain provider

## Normalization Function

```typescript
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function normalizeIds(branchId: string) {
  if (!branchId) return { uiId: '', dbId: '' }
  
  // Already has prefix
  if (branchId.startsWith('branch-')) {
    return { 
      uiId: branchId,                    // Keep as-is for UI
      dbId: branchId.slice(7)            // Remove prefix for DB
    }
  }
  
  // Raw UUID without prefix
  if (UUID_RE.test(branchId)) {
    return { 
      uiId: `branch-${branchId}`,        // Add prefix for UI
      dbId: branchId                     // Keep as-is for DB
    }
  }
  
  // Fallback for non-standard IDs (e.g., temp-123)
  return { 
    uiId: branchId, 
    dbId: branchId 
  }
}
```

## Usage Patterns

### Canvas Data Store Lookups
```typescript
const { uiId } = normalizeIds(branchId)
const branch = canvasDataStore.get(uiId)  // Always use UI format
```

### API Calls
```typescript
const { dbId } = normalizeIds(branchId)
fetch(`/api/postgres-offline/branches?id=${dbId}`)  // Always use DB format
```

### DOM Queries
```typescript
const { uiId, dbId } = normalizeIds(branchId)
// Try both formats as DOM might have either
const element = document.querySelector(`[data-branch="${uiId}"]`) ||
                document.querySelector(`[data-branch="${dbId}"]`)
```

## Provider-Specific Patterns

### Yjs Provider
- Uses UI format (`branch-<uuid>`)
- Access via: `branchesMap.get(uiId)`

### Plain Provider
- Uses DB format (raw UUID)
- Access via: `plainProvider.getBranch(dbId)`

## Common Pitfalls

1. **Double Prefixing**: Check if ID already has prefix before adding
2. **Wrong Format for Provider**: Remember Yjs uses UI format, Plain uses DB format
3. **API Inconsistency**: Some endpoints expect different formats
4. **Temporary IDs**: Handle `temp-` prefixed IDs specially

## Validation
Always normalize IDs at entry points to prevent format mismatches deeper in the code.