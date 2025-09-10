/**
 * Clear Stored Marks Plugin
 * 
 * Prevents ProseMirror's storedMarks from "leaking" annotation marks
 * to new text when the cursor is just outside an annotated span.
 * This is IME-safe and works with all input methods including:
 * - Keyboard typing
 * - IME composition (Japanese, Chinese, etc.)
 * - Voice dictation
 * - Mobile autocorrect
 * - Paste operations
 */

import { Plugin } from '@tiptap/pm/state'

export const ClearStoredMarksAtBoundary = () =>
  new Plugin({
    props: {
      handleTextInput(view) {
        const { state } = view
        const { empty, from } = state.selection
        
        // Only handle when cursor is at a single position (not a selection)
        if (!empty) return false
        
        // Check if annotation mark exists in the schema
        const annotationMark = state.schema.marks.annotation
        if (!annotationMark) return false
        
        // If cursor is NOT inside an annotation mark, clear stored marks
        // This prevents the annotation from extending when typing at boundaries
        if (!state.doc.rangeHasMark(from, from, annotationMark)) {
          // Clear any stored marks to prevent them from applying to new text
          const tr = state.tr.setStoredMarks(null)
          view.dispatch(tr)
        }
        
        // Return false to allow normal text input to continue
        // This is important for accessibility and IME compatibility
        return false
      },
    },
  })

/**
 * Alternative version with debugging (use during development)
 */
export const ClearStoredMarksAtBoundaryDebug = () =>
  new Plugin({
    props: {
      handleTextInput(view) {
        const { state } = view
        const { empty, from } = state.selection
        
        if (!empty) return false
        
        const annotationMark = state.schema.marks.annotation
        if (!annotationMark) {
          console.warn('[ClearStoredMarks] No annotation mark in schema')
          return false
        }
        
        const hasAnnotation = state.doc.rangeHasMark(from, from, annotationMark)
        const storedMarks = state.storedMarks
        
        console.log('[ClearStoredMarks]', {
          position: from,
          hasAnnotation,
          storedMarks: storedMarks?.map(m => m.type.name),
          willClear: !hasAnnotation && storedMarks?.some(m => m.type.name === 'annotation')
        })
        
        if (!hasAnnotation) {
          const tr = state.tr.setStoredMarks(null)
          view.dispatch(tr)
        }
        
        return false
      },
    },
  })