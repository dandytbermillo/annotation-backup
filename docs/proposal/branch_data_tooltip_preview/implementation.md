# Implementation Plan — Branch Data Tooltip Preview

Feature: `branch_data_tooltip_preview`
Folder: `context-os/docs/proposal/annotation_system/branch_data_tooltip_preview/`

Status: completed (retroactive documentation)
Owner: @dandytbermillo
Created: 2025-09-09
Implemented: 2025-09-08

## Summary
Display contextual tooltips showing branch annotation content when users hover over annotated text with a magnifier icon (🔎). The tooltip shows the actual notes typed in the annotation panel, not the selected text or editor content. Uses branch-first data precedence with proper ID normalization and async guards.

## Goals
- Show actual branch notes (what user typed in annotation panel) in tooltip
- Prevent raw JSON or HTML from appearing in tooltips
- Ensure consistent behavior across Yjs and Plain modes
- Provide immediate display when data exists (no unnecessary loading states)
- Handle ID format mismatches between UI (`branch-<uuid>`) and DB (`<uuid>`)

## Out of Scope
- Minimap integration (handled by Infinite Canvas OS)
- Tooltip styling changes beyond functionality
- Real-time collaboration awareness in tooltips
- Branch content editing from tooltip

---

## Approach
Implement a unified branch-first tooltip system that prioritizes local data over network fetches. Use ProseMirror decorations to add hover targets, show a magnifier icon on hover, and display tooltip content when the icon is hovered.

### Data Precedence (Critical)
1. **Branch content** (from `canvasDataStore`) - actual annotation notes
2. **Original text** - selected text when annotation was created
3. **Provider document** - last resort fallback only
4. **"No notes added yet"** - final fallback

### ID Normalization Strategy
- UI components use: `branch-<uuid>` format
- Database/API uses: raw `<uuid>` format
- Normalize once at entry point and use consistently:
  ```typescript
  const uiId = branchId.startsWith('branch-') ? branchId : `branch-${branchId}`
  const dbId = branchId.replace(/^branch-/, '')
  ```

### Race Condition Prevention
- Tag tooltip with current branch ID before async operations
- Check tag before applying async results:
  ```typescript
  tooltipElement.dataset.branchId = uiId
  // Later in callback:
  if (tooltipElement.dataset.branchId !== currentKey) return
  ```

---

## Changes by File

### 1) components/canvas/annotation-decorations-plain.ts (NEW)
Complete Yjs-free implementation for Option A (plain mode):

**Key Components:**
- `normalizeIds()` - Handle ID format conversion
- `resolveContextFrom()` - Extract noteId/panelId from editor context
- `stripHtml()` - Remove HTML tags from content
- `extractTextFromPMJSON()` - Extract text from ProseMirror JSON structure
- `showAnnotationTooltip()` - Main tooltip display logic with branch-first precedence

**Critical Logic:**
```typescript
// Unified precedence: branch.content → originalText → provider doc
const previewText = (dsBranch?.content ? stripHtml(String(dsBranch.content)) : '')
  || (dsBranch?.originalText || '')
  || extractPreviewFromDoc(docContent)
```

**Hover Icon Management:**
- Single shared icon element attached to `document.body`
- Positioned near cursor on annotation hover
- Shows tooltip when icon itself is hovered
- Preserves editor context via dataset attributes

### 2) components/canvas/annotation-decorations.ts (MODIFIED)
Updates for Yjs collaboration mode to match plain mode behavior:

**Key Changes:**
- Add `tooltipElement.dataset.branchId = uiId` for async guards
- Implement branch-first rendering:
  ```typescript
  const branchPreview = branch.content 
    ? String(branch.content).replace(/<[^>]*>/g, '').trim() 
    : (branch.original_text || branch.originalText || '')
  ```
- Only fetch documents when no branch preview exists
- Add `extractTextFromPM()` helper for JSON parsing
- Include async response validation

### 3) components/canvas/tiptap-editor-plain.tsx (MODIFIED)
- Import from `'./annotation-decorations-plain'` instead of `'./annotation-decorations'`
- Register plugin via `onCreate` callback:
  ```typescript
  onCreate: ({ editor }) => {
    editor.registerPlugin(AnnotationDecorations())
  }
  ```

### 4) components/canvas/tiptap-editor.tsx (EXISTING)
- Already has correct plugin registration
- Uses standard `annotation-decorations.ts` for Yjs mode

---

## Implementation Details

### Hover Icon Behavior
1. User hovers annotated text → show magnifier icon (🔎)
2. Icon follows cursor position with slight offset
3. Icon hover → show full tooltip with branch content
4. Leave icon/tooltip → hide after 300ms delay

### Tooltip Content Resolution
```
1. Check window.canvasDataStore.get(uiId) for branch data
2. If branch.content exists:
   - Check if JSON string → parse and extract text
   - Else strip HTML tags
3. Else use branch.originalText
4. Else try provider document (shouldn't happen)
5. Show "No notes added yet" as final fallback
```

### JSON Content Handling
When branch.content is ProseMirror JSON:
```typescript
if (contentStr.startsWith('{') || contentStr.startsWith('[')) {
  try {
    const parsed = JSON.parse(contentStr)
    txt = extractTextFromPM(parsed)  // Recursively extract text nodes
  } catch {
    txt = stripHtml(contentStr)  // Fallback to HTML stripping
  }
}
```

---

## Risks and Mitigations

### Risk: Tooltip shows raw JSON
**Mitigation:** Always parse JSON strings and extract text before display

### Risk: Wrong tooltip content due to race conditions
**Mitigation:** Tag tooltip with branch ID and validate before updates

### Risk: ID format mismatches cause missing data
**Mitigation:** Normalize IDs once at entry, use consistently throughout

### Risk: Yjs imports in plain mode
**Mitigation:** Separate annotation-decorations-plain.ts with no Yjs dependencies

### Risk: Tooltip shows editor content instead of branch notes
**Mitigation:** Branch-first precedence ensures branch content is prioritized

---

## Validation

### Manual Testing Performed:
- ✅ Hover annotated text → magnifier icon appears
- ✅ Hover icon → tooltip shows branch content (not JSON)
- ✅ Multiple annotations → correct content for each
- ✅ Quick hover between annotations → no content mixing
- ✅ Plain mode → no Yjs imports or errors
- ✅ Yjs mode → consistent behavior with plain mode
- ✅ Empty branch → shows "No notes added yet"
- ✅ Branch with content → shows actual notes

### Automated Tests Needed:
- ID normalization unit tests
- JSON extraction unit tests
- Race condition simulation tests
- Mode separation validation

---

## Acceptance Criteria (ACHIEVED)
- ✅ Tooltip shows actual branch notes, not selected text
- ✅ No raw JSON or HTML visible in tooltips
- ✅ Consistent behavior across Yjs and Plain modes
- ✅ Immediate display when data exists
- ✅ Proper fallback chain with meaningful messages
- ✅ No Yjs dependencies in plain mode
- ✅ Race conditions prevented via async guards

---

## Deliverables
- ✅ Created: `components/canvas/annotation-decorations-plain.ts`
- ✅ Modified: `components/canvas/annotation-decorations.ts`
- ✅ Modified: `components/canvas/tiptap-editor-plain.tsx`
- ✅ Applied: `codex/proposal/tooltip-unified-branch-first.patch`
- ✅ Test scripts: `test-tooltip-stability.js`, `debug-branch-content.js`
- ✅ This implementation plan (retroactive documentation)

---

## Repository Location and Structure

### Current Location:
- Implementation files in main codebase under `components/canvas/`
- Proposal patches in `codex/proposal/`
- This plan in `context-os/docs/proposal/annotation_system/branch_data_tooltip_preview/`

### Recommended Structure:
```
docs/proposal/branch_data_tooltip_preview/
├── implementation.md (this file)
├── initial.md (feature request - to be created)
├── reports/
│   └── 2025-09-09-implementation-report.md
├── implementation-details/
│   ├── id-normalization-strategy.md
│   └── branch-first-precedence.md
├── post-implementation-fixes/
│   ├── README.md
│   └── json-extraction-fix.md
└── test-scripts/
    ├── test-tooltip-stability.js
    └── debug-branch-content.js
```

---

## Deviation Logging

### Deviations from Standard Process:
1. **No initial.md created first** - Feature was implemented directly without planning phase
2. **Patches created before plan** - Multiple patch iterations in `codex/proposal/`
3. **Test scripts in root** - Should be under feature folder
4. **Retroactive documentation** - This plan created after implementation

### Rationale:
- Urgent user-facing issue required immediate fix
- Iterative debugging approach needed to identify root cause
- Solution evolved through multiple attempts

---

## Rollback Plan
If tooltip system causes issues:
1. Remove plugin registration from both editor files
2. Delete `annotation-decorations-plain.ts`
3. Revert changes to `annotation-decorations.ts`
4. Remove test scripts
5. No database changes to revert

---

## Timeline (Actual)
- Day 1 (2025-09-08): Initial implementation attempts, JSON issue identified
- Day 1.5: Root cause analysis, ID normalization fix
- Day 2: Branch-first precedence fix, working solution
- Day 2 (2025-09-09): Applied unified patch, retroactive documentation

---

## Lessons Learned

### Key Insights:
1. **Understand data architecture first** - Confusion between document vs branch content caused initial issues
2. **Simple solutions often best** - stripHtml() was simpler than complex JSON parsing
3. **Mode consistency critical** - Different logic in Yjs vs Plain caused bugs
4. **Branch-first is correct** - Branch store contains what users expect to see

### Future Improvements:
1. Add runtime mode lock to prevent Yjs loading in plain mode
2. Implement cache invalidation strategy for branch updates
3. Add performance monitoring for tooltip display latency
4. Consider tooltip content editing capability

---

## Related Documentation
- `codex/proposal/option-a-tooltip-cache-first.md`
- `codex/proposal/option-a-plain-mode-yjs-guardrails.patch`
- `codex/proposal/tooltip-unified-branch-first.patch`
- `CLAUDE.md` (Option A requirements)