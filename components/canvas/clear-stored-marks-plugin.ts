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
        const { empty, $from } = state.selection
        if (!empty) return false

        const annType = state.schema.marks.annotation
        if (!annType) return false

        // Treat caret as "inside" if any of these are true:
        // This is the key fix - we check BOTH before AND after
        const inStored = !!state.storedMarks?.some(m => m.type === annType)
        const inHere = $from.marks().some(m => m.type === annType)
        const beforeHas = !!$from.nodeBefore?.marks?.some(m => m.type === annType)
        const afterHas = !!$from.nodeAfter?.marks?.some(m => m.type === annType)

        if (inStored || inHere || beforeHas || afterHas) {
          // Inside or at a boundary: do not clear; let typing continue annotation
          return false
        }

        // Caret truly outside: ensure further typing is plain text
        view.dispatch(state.tr.setStoredMarks(null))
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
        const { empty, $from } = state.selection
        
        if (!empty) return false
        
        const annType = state.schema.marks.annotation
        if (!annType) {
          console.warn('[ClearStoredMarks] No annotation mark in schema')
          return false
        }
        
        // Improved boundary detection with three checks
        const inStored = !!state.storedMarks?.some(m => m.type === annType)
        const inHere = $from.marks().some(m => m.type === annType)
        const beforeHas = !!$from.nodeBefore?.marks?.some(m => m.type === annType)
        const storedMarks = state.storedMarks
        
        console.log('[ClearStoredMarks]', {
          position: $from.pos,
          inStored,
          inHere,
          beforeHas,
          isInsideAnnotation: inStored || inHere || beforeHas,
          storedMarks: storedMarks?.map(m => m.type.name),
          willClear: !(inStored || inHere || beforeHas) && storedMarks?.some(m => m.type.name === 'annotation')
        })
        
        // Only clear if we're truly outside the annotation
        if (!(inStored || inHere || beforeHas)) {
          const tr = state.tr.setStoredMarks(null)
          view.dispatch(tr)
        }
        
        return false
      },
    },
  })