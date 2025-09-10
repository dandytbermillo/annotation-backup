# Implementation Plan — Sticky Highlight Effect Prevention

Feature: `sticky_highlight_effect`
Folder: `context-os/docs/proposal/annotation_system/sticky_highlight_effect/`

Status: draft
Owner: <assign>
Created: 2025-01-09

## Summary
Prevent annotation highlight marks from extending when users type at the boundaries of annotated text. Currently, typing at the end of a highlighted span causes the range to grow and new text inherits the annotation background, which is undesired behavior.

## Goals
- Annotation marks should not extend when typing at their boundaries
- Clear visual/behavioral boundaries for annotations
- Preserve existing annotation functionality (tooltips, hover effects)
- Consistent behavior across plain and collaborative modes

## Out of Scope
- Changing annotation data model or storage
- Modifying annotation creation workflow
- Altering tooltip display logic
- Backend/API changes

---

## Problem Analysis

### Current Behavior
When a user types at the end of an annotated span:
1. The annotation mark extends to include new characters
2. New text inherits the annotation background color
3. The annotation's semantic boundary becomes unclear
4. Users cannot easily "exit" the annotation to type normal text

### Root Cause
ProseMirror marks are "inclusive" by default, meaning they extend to include new content typed at their boundaries. The annotation mark currently lacks:
- `inclusive: false` configuration
- Smart exit behavior
- Visual boundary indicators

---

## Approach

Implement a multi-layered solution:
1. **Primary Fix**: Set annotation marks as non-inclusive
2. **Enhanced UX**: Add keyboard shortcuts for mark exit
3. **Visual Feedback**: Provide boundary indicators
4. **Smart Plugin**: Auto-exit annotations at boundaries

### Implementation Strategy

Note on TipTap/ProseMirror imports (readiness fix):
- In this codebase, import ProseMirror primitives via TipTap re‑exports to match bundling and existing usage:
  - `import { Plugin, PluginKey } from '@tiptap/pm/state'`
  - `import { Decoration, DecorationSet } from '@tiptap/pm/view'`
- Keep `inclusive: false` as a top‑level property on the Annotation Mark (not in addOptions).
- Keyboard shortcuts should return `true` when handled to prevent default behavior.
- Register the boundary plugin in both editors (plain and collab) after existing plugins.
- CSS integration: import the new stylesheet once (e.g., in `app/globals.css`) so boundary indicators are available in all editors.

**Phase 1 (Essential)**: Non-inclusive marks
- Modify the Annotation mark definition with `inclusive: false` and `keepOnSplit: false`
- Test in both plain and collaborative modes
- Verify tooltips and hover effects still work

**Phase 2 (Enhanced)**: Smart exit behavior
- Add keyboard shortcuts (Space, Arrow keys)
- Implement boundary detection plugin
- Add visual indicators for annotation edges

**Phase 3 (Polish)**: Fine-tune behavior
- Handle edge cases (nested annotations, multiple marks)
- Add configuration options
- Optimize performance

---

## Changes by File

### 1) components/canvas/tiptap-editor-plain.tsx
```typescript
const Annotation = Mark.create({
  name: 'annotation',
  
  // Primary fix: prevent mark extension
  inclusive: false,
  // Prevent carry-over on Enter splits
  keepOnSplit: false,
  
  addOptions() {
    return {
      HTMLAttributes: {},
      exitOnArrowRight: true,  // Configuration option
      exitOnSpace: true,        // Configuration option
    }
  },

  addAttributes() {
    // Existing attributes unchanged
    return {
      id: { /* ... */ },
      type: { /* ... */ },
      branchId: { /* ... */ },
      'data-branch': { /* ... */ },
    }
  },

  // Add keyboard shortcuts for smart exit
  addKeyboardShortcuts() {
    return {
      // Exit annotation on right arrow at boundary
      'ArrowRight': ({ editor }) => {
        if (!this.options.exitOnArrowRight) return false
        
        const { $from, $to } = editor.state.selection
        if ($from.pos === $to.pos) {
          const marks = $from.marks()
          const hasAnnotation = marks.some(mark => mark.type.name === 'annotation')
          
          if (hasAnnotation) {
            // Check if at annotation boundary
            const after = $from.nodeAfter
            if (!after || !after.marks.some(m => m.type.name === 'annotation')) {
              editor.commands.unsetMark('annotation')
              return true // handled: prevent default
            }
          }
        }
        return false
      },
      
      // Exit annotation on space
      'Space': ({ editor }) => {
        if (!this.options.exitOnSpace) return false
        
        const { $from } = editor.state.selection
        const marks = $from.marks()
        if (marks.some(mark => mark.type.name === 'annotation')) {
          // Insert space without annotation mark
          editor.chain()
            .insertContent(' ')
            .unsetMark('annotation')
            .run()
          return true // handled: prevent default
        }
        return false
      }
    }
  },

  // Existing parseHTML and renderHTML unchanged
  parseHTML() { /* ... */ },
  renderHTML({ HTMLAttributes, mark }) { /* ... */ },
})
```

### 2) components/canvas/tiptap-editor-collab.tsx
```typescript
// Identical changes as tiptap-editor-plain.tsx
// Ensure consistency across both editor types
const Annotation = Mark.create({
  name: 'annotation',
  inclusive: false,
  keepOnSplit: false,
  // ... same implementation as plain editor
})
```

### 3) components/canvas/tiptap-editor.tsx (if still in use)
```typescript
// Apply same changes for consistency
// Even if this is legacy code, prevent future issues
const Annotation = Mark.create({
  name: 'annotation',
  inclusive: false,
  // ... same implementation
})
```

### 4) components/canvas/annotation-boundary-plugin.ts (new file)
```typescript
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const annotationBoundaryKey = new PluginKey('annotation-boundary')

export function AnnotationBoundaryPlugin() {
  return new Plugin({
    key: annotationBoundaryKey,
    
    state: {
      init() {
        return { activeAnnotations: new Set() }
      },
      
      apply(tr, state) {
        // Track active annotations for boundary detection
        const newState = { ...state }
        const { $from } = tr.selection
        
        if ($from) {
          const marks = $from.marks()
          const annotationMark = marks.find(m => m.type.name === 'annotation')
          
          if (annotationMark) {
            newState.activeAnnotations.add(annotationMark.attrs.id)
          }
        }
        
        return newState
      }
    },
    
    props: {
      decorations(state) {
        const decorations: Decoration[] = []
        
        // Add visual indicators at annotation boundaries
        state.doc.descendants((node, pos) => {
          node.marks.forEach(mark => {
            if (mark.type.name === 'annotation') {
              // Add end-of-annotation indicator
              const endPos = pos + node.nodeSize
              decorations.push(
                Decoration.widget(endPos, () => {
                  const span = document.createElement('span')
                  span.className = 'annotation-boundary'
                  span.setAttribute('data-annotation-id', mark.attrs.id)
                  return span
                }, { side: 1 })
              )
            }
          })
        })
        
        return DecorationSet.create(state.doc, decorations)
      }
    },
    
    appendTransaction(transactions, oldState, newState) {
      const tr = transactions[0]
      if (!tr || !tr.docChanged) return null
      
      // Auto-exit annotation when typing at boundary
      const { $from } = newState.selection
      const marks = $from.marks()
      const hasAnnotation = marks.some(m => m.type.name === 'annotation')
      
      if (hasAnnotation && tr.steps.length > 0) {
        // Check if we just typed at annotation boundary
        const typed = tr.steps.some(step => step.constructor.name === 'ReplaceStep')
        
        if (typed) {
          const after = $from.nodeAfter
          
          // If next node doesn't have annotation, exit the mark
          if (!after || !after.marks.some(m => m.type.name === 'annotation')) {
            // housekeeping transaction should not pollute undo
            const exitTr = newState.tr.setMeta('addToHistory', false)
            exitTr.removeStoredMark(newState.schema.marks.annotation)
            return exitTr
          }
        }
      }
      
      return null
    }
  })
}
```

#### 4b) components/canvas/clear-stored-marks-plugin.ts (new file)
Guard against ProseMirror storedMarks “leaking” the annotation to new text when the caret is just outside an annotated span (IME‑safe):
```typescript
import { Plugin } from '@tiptap/pm/state'

export const ClearStoredMarksAtBoundary = () =>
  new Plugin({
    props: {
      handleTextInput(view) {
        const { state } = view
        const { empty, from } = state.selection
        if (!empty) return false
        const ann = state.schema.marks.annotation
        // If caret is NOT inside an annotation mark, clear stored marks
        if (!state.doc.rangeHasMark(from, from, ann)) {
          view.dispatch(state.tr.setStoredMarks(null))
        }
        return false // allow input to continue normally
      },
    },
  })
```
Register this plugin in both editors (plain and collab), after your existing plugins.

### 5) styles/annotation-boundaries.css (new file)
```css
/* Visual indicators for annotation boundaries */
.annotation {
  position: relative;
  /* Existing styles preserved */
}

/* Subtle boundary indicator */
.annotation::after {
  content: '';
  position: absolute;
  right: -1px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: currentColor;
  opacity: 0.3;
  pointer-events: none;
}

/* Alternative: visible boundary marker */
.annotation-boundary {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: rgba(0, 0, 0, 0.2);
  margin: 0 1px;
  vertical-align: middle;
}

/* Hover state for clearer boundaries */
.annotation:hover::after {
  opacity: 0.5;
  background: var(--annotation-color, currentColor);
}

/* Exit hint on hover */
.annotation:hover::before {
  content: 'Press → to exit';
  position: absolute;
  top: -20px;
  right: 0;
  font-size: 10px;
  color: #666;
  background: white;
  padding: 2px 4px;
  border-radius: 2px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
  white-space: nowrap;
  opacity: 0;
  animation: fadeIn 0.3s 0.5s forwards;
}

@keyframes fadeIn {
  to { opacity: 1; }
}
```

Integration note: add a single import (or @import) in your global stylesheet to activate these styles, e.g. in `app/globals.css`:
```css
@import '../styles/annotation-boundaries.css';
```

### 6) Register plugin in editors
```typescript
// In tiptap-editor-plain.tsx, tiptap-editor-collab.tsx
import { AnnotationBoundaryPlugin } from './annotation-boundary-plugin'
import { ClearStoredMarksAtBoundary } from './clear-stored-marks-plugin'

// In editor configuration
onCreate: ({ editor }) => {
  editor.registerPlugin(AnnotationDecorations())
  editor.registerPlugin(PerformanceMonitor())
  editor.registerPlugin(AnnotationBoundaryPlugin())  // Add this
  editor.registerPlugin(ClearStoredMarksAtBoundary()) // IME‑safe boundary guard
}
```

Parity reminder: ensure both editors (plain and collab) define the Annotation mark with `inclusive: false` and register the boundary plugin. Keep keyboard shortcuts identical across both to avoid mode‑specific behavior differences.

---

## Configuration Options

Add to app configuration or environment variables:
```typescript
// lib/annotation-config.ts
export const annotationConfig = {
  // Mark behavior
  inclusive: false,              // Core fix - always false
  exitOnArrowRight: true,        // Exit on right arrow
  exitOnSpace: true,             // Exit on space
  
  // Visual feedback
  showBoundaryIndicators: true,  // Visual boundary markers
  showExitHint: true,            // "Press → to exit" hint
  
  // Smart exit
  autoExitAtBoundary: true,      // Plugin-based auto-exit
  preserveOnBackspace: true,     // Keep annotation when backspacing
}
```

---

## Testing Strategy

### Unit Tests
1. **Mark Extension Prevention**
   - Type at end of annotation → new text not annotated
   - Type in middle → existing behavior preserved
   - Delete at boundary → annotation preserved

2. **Keyboard Shortcuts**
   - Right arrow at end → exits annotation (return true only when handled)
   - Space at end → inserts space and exits
   - Other keys → normal behavior

3. **Plugin Behavior**
   - Auto-exit triggers correctly
   - Visual indicators appear
   - No performance degradation

### Integration Tests
1. **Plain Mode**
   - Create annotation → type at end → verify no extension
   - Multiple annotations → boundaries respected

2. **Collaborative Mode**
   - Same tests as plain mode
   - Verify sync still works correctly

3. **Edge Cases**
   - Nested annotations
   - Overlapping annotations
   - Rapid typing
   - Copy/paste operations

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing annotations | High | Test thoroughly, feature flag rollout |
| User confusion about boundaries | Medium | Clear visual indicators, documentation |
| Performance impact from plugin | Low | Optimize decoration rendering, debounce |
| Incompatibility with other marks | Medium | Test with all mark combinations |
| Cursor jumping on exit | Low | Smooth transition, maintain position |

---

## Validation

### Manual Testing Checklist
- [ ] Type at annotation end → new text not highlighted
- [ ] Type at annotation start → new text not highlighted
- [ ] Type in annotation middle → works normally
- [ ] Right arrow at boundary → exits annotation
- [ ] Space at boundary → exits annotation
- [ ] Press Enter at end of annotation → does not carry over mark (keepOnSplit: false)
- [ ] IME composition at boundary (e.g., Japanese/Chinese) → no sticky carryover
- [ ] Paste inside/outside annotation behaves as expected
- [ ] Visual indicators visible
- [ ] Tooltips still work on hover
- [ ] Copy/paste preserves annotations correctly
- [ ] Undo/redo works properly
- [ ] Performance acceptable with many annotations

### Automated Validation
```bash
# Run tests
npm run test:annotations

# Check bundle size impact
npm run build && npm run analyze

# Lint and type check
npm run lint
npm run type-check
```

---

## Acceptance Criteria

1. **Core Functionality**
   - Annotations do not extend when typing at boundaries
   - Users can exit annotations with arrow keys or space
   - Visual boundaries are clear

2. **Preservation**
   - Existing annotations remain functional
   - Tooltips and hover effects work
   - Selection and editing within annotations unchanged

3. **Performance**
   - No noticeable lag when typing
   - Plugin doesn't impact editor startup time

4. **Consistency**
   - Works in both plain and collaborative modes
   - Behavior consistent across all editors

---

## Deliverables

- Updated files:
  - `components/canvas/tiptap-editor-plain.tsx` (inclusive: false + shortcuts)
  - `components/canvas/tiptap-editor-collab.tsx` (same changes)
  - `components/canvas/tiptap-editor.tsx` (legacy support)
  - `components/canvas/annotation-boundary-plugin.ts` (new plugin)
  - `styles/annotation-boundaries.css` (visual indicators)
  
- Documentation:
  - Implementation report under `reports/`
  - User guide for new behavior
  - Configuration options documentation

---

## Repository Location and Structure (Required)

Migrate the feature to the canonical path and enforce the standard structure:

- Move the feature to `docs/proposal/sticky_highlight_effect/`.
- Move `initial.md` and `implementation.md` into that folder.
- Create subfolders:
  - `reports/` (main Implementation Report lives here)
  - `implementation-details/`
  - `post-implementation-fixes/` (include a `README.md` index)
  - `test-scripts/` (validation scripts)
- Add a note in `initial.md`: "Created in `context-os/...` on 2025-01-09."

Reference: Follow the "Directory Structure" rules in the Documentation Process Guide to keep artifacts consistent and discoverable:
- See: `docs/documentation_process_guide/DOCUMENTATION_PROCESS_GUIDE.md` → "## Directory Structure"

---

## Deviation Logging Requirements

- Implementation Report (under `reports/`): include a "Deviations From Implementation Plan" section
- `initial.md`: document any structural deviations in ATTEMPT HISTORY
- Track all configuration changes from defaults

---

## Rollback Plan

1. **Quick Revert**: Set `inclusive: true` to restore old behavior
2. **Full Rollback**: 
   - Remove keyboard shortcuts
   - Remove boundary plugin
   - Remove CSS styles
   - Revert mark definition changes
3. **Feature Flag**: Can be controlled via config without code changes

---

## Timeline (suggested)

- Hour 1: Implement `inclusive: false` and test
- Hour 2: Add keyboard shortcuts
- Hour 3: Create boundary plugin
- Hour 4: Add visual indicators and CSS
- Hour 5: Testing and validation
- Hour 6: Documentation and implementation report

Total: ~6 hours for complete implementation

---

## Notes

- Start with Phase 1 (inclusive: false) for immediate fix
- Phases 2 and 3 can be delivered incrementally
- Consider A/B testing for keyboard shortcuts
- Monitor user feedback on boundary indicators

---

## ATTEMPT HISTORY

### 2025-01-09: Initial Implementation
- Created implementation plan based on user requirements
- Implemented Phase 1 with `inclusive: false` and `keepOnSplit: false`
- Created `ClearStoredMarksAtBoundary` plugin
- **Result**: Partial success - some boundary issues remained

### 2025-01-10: Post-Implementation Fixes

#### Attempt 1: Basic Boundary Detection (FAILED)
- Used `rangeHasMark(from, from)` for boundary detection
- **Issue**: Zero-width range detection unreliable
- **Files**: `clear-stored-marks-plugin.ts` v1

#### Attempt 2: Three-Check System (FAILED)
- Added `inStored`, `inHere`, `beforeHas` checks
- **Issue**: Missing `afterHas` check, still wrong approach
- **Files**: `clear-stored-marks-plugin.ts` v2

#### Attempt 3: DOM-Level Interception (FAILED)
- Created `AnnotationStrictBoundary` with `beforeinput` handler
- **Issue**: Tried to prevent extension instead of allowing it
- **Files**: `annotation-strict-boundary.ts`

#### Attempt 4: Transaction Filtering (FAILED)
- Created `AnnotationExclusionPlugin` with transaction filters
- **Issue**: Too late in pipeline
- **Files**: `annotation-exclusion-plugin.ts`

#### Attempt 5: Apply Marks at Boundaries (SUCCESS)
- Created `AnnotationStartBoundaryFix` to explicitly apply marks
- Removed `inclusive: false` to work with defaults
- **Result**: Both boundaries working correctly
- **Files**: `annotation-start-boundary-fix.ts`

#### Additional UX Fix
- Removed annotation click handler to improve editing experience
- Added click handler to hover icon for branch window
- **Result**: Clean separation of editing vs navigation

---

## ERRORS

### Error 1: Characters Detaching at Boundaries
- **Root Cause**: Misunderstood requirements - tried to prevent extension instead of allowing it
- **Reproduction**: Type at start/end of annotation
- **Fix**: Apply annotation marks at boundaries instead of clearing them
- **Prevention**: Test with vanilla behavior first

### Error 2: Cursor Disappearing
- **Root Cause**: Plugin interference with cursor positioning
- **Reproduction**: Click at annotation boundary with all plugins enabled
- **Fix**: Simplified plugin approach, removed aggressive handlers
- **Prevention**: Test incrementally with plugins

### Error 3: Enter Key Extending Annotation
- **Root Cause**: `keepOnSplit: false` was commented out
- **Reproduction**: Press Enter at annotation boundary
- **Fix**: Properly set `keepOnSplit: false`
- **Prevention**: Verify all configuration properties are active

---

## DEVIATIONS FROM ORIGINAL PLAN

1. **Mark Configuration**: Plan suggested `inclusive: false`, but final solution uses default (true)
   - **Rationale**: Default behavior correct for end boundary when combined with plugin

2. **Plugin Approach**: Plan suggested boundary detection and mark clearing
   - **Actual**: Plugin applies marks at boundaries rather than clearing
   - **Rationale**: Fundamental misunderstanding of requirements in original plan

3. **Phases**: Only Phase 1 was truly necessary
   - **Rationale**: Core issue solved without keyboard shortcuts or visual indicators

4. **Testing**: Required extensive manual testing and multiple iterations
   - **Rationale**: Complex interaction between plugins and mark behavior
