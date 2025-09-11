# SECURITY FIX REQUIRED - XSS Vulnerability in Tooltip

## Vulnerability Details

**Type**: Cross-Site Scripting (XSS)  
**Severity**: Medium  
**Location**: Tooltip title rendering  
**Files Affected**:
- components/canvas/annotation-tooltip.ts
- components/canvas/annotation-decorations.ts

## The Problem

Branch titles are inserted directly into innerHTML without HTML escaping:

```typescript
// VULNERABLE CODE
tooltipElement.innerHTML = `
  <div class="tooltip-header">
    <span class="tooltip-title">${branch.title || '...'}</span>
  </div>
`
```

If `branch.title` contains HTML/JavaScript, it will be executed.

## Proof of Concept

1. User creates annotation with title: `<img src=x onerror="alert('XSS')">`
2. When tooltip shows, the JavaScript executes

## Solution

### Option 1: HTML Escape Function (Recommended)
```typescript
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Then use:
<span class="tooltip-title">${escapeHtml(branch.title || '...')}</span>
```

### Option 2: Use textContent After Creation
```typescript
// Create structure first
tooltipElement.innerHTML = `
  <div class="tooltip-header">
    <span class="tooltip-icon">${getTypeIcon(type)}</span>
    <span class="tooltip-title"></span>
  </div>
  <div class="tooltip-content"></div>
  <div class="tooltip-footer">Click to open panel</div>
`

// Then safely set text content
const titleEl = tooltipElement.querySelector('.tooltip-title')
if (titleEl) {
  titleEl.textContent = branch.title || `${type.charAt(0).toUpperCase() + type.slice(1)} annotation`
}

const contentEl = tooltipElement.querySelector('.tooltip-content')
if (contentEl) {
  contentEl.textContent = preview  // Already text-only
}
```

### Option 3: Use DOMPurify Library
```typescript
import DOMPurify from 'dompurify'

tooltipElement.innerHTML = DOMPurify.sanitize(`
  <div class="tooltip-header">
    <span class="tooltip-title">${branch.title || '...'}</span>
  </div>
`)
```

## Files to Fix

1. **components/canvas/annotation-tooltip.ts**
   - Lines: 178, 192, 209, 240
   
2. **components/canvas/annotation-decorations.ts**
   - Lines: 184, 199, 264, 314

## Testing After Fix

1. Create annotation with title: `<script>alert('test')</script>`
2. Verify it displays as literal text, not executed
3. Test with: `<img src=x onerror="alert('XSS')">`
4. Test with: `" onclick="alert('XSS')`
5. Ensure normal titles still display correctly

## Risk Assessment

- **Current Risk**: Medium - requires user to input malicious title
- **After Fix**: None - all content properly escaped
- **Priority**: HIGH - should be fixed immediately

## Note

The content area is already safe because it's text-only:
```typescript
content = doc.content.replace(/<[^>]*>/g, '').trim()  // Strips HTML
```

Only the title needs fixing.
