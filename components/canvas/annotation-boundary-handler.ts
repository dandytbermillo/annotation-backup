/**
 * Annotation Boundary Handler Plugin
 * 
 * Comprehensive solution to prevent annotation marks from extending when
 * typing at their boundaries (both start and end).
 * 
 * This handles the case where inclusive: false isn't sufficient.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const annotationBoundaryKey = new PluginKey('annotationBoundary')

export const AnnotationBoundaryHandler = () =>
  new Plugin({
    key: annotationBoundaryKey,
    
    props: {
      // Handle keyboard input before it creates a transaction
      handleKeyDown(view, event) {
        // Only handle printable characters and Enter
        const isPrintable = event.key.length === 1 && !event.ctrlKey && !event.metaKey
        const isEnter = event.key === 'Enter'
        
        if (!isPrintable && !isEnter) return false
        
        const { state } = view
        const { empty, $from } = state.selection
        
        // Only handle collapsed selections
        if (!empty) return false
        
        const annType = state.schema.marks.annotation
        if (!annType) return false
        
        // Check if we're at a boundary
        const pos = $from.pos
        
        // Helper to check if a position has annotation
        const hasAnnotationAt = (checkPos: number) => {
          if (checkPos < 0 || checkPos >= state.doc.content.size) return false
          try {
            const $pos = state.doc.resolve(checkPos)
            return $pos.marks().some(m => m.type === annType)
          } catch {
            return false
          }
        }
        
        // Check current position and adjacent positions
        const hasAnnotationHere = $from.marks().some(m => m.type === annType)
        const hasAnnotationBefore = pos > 0 && hasAnnotationAt(pos - 1)
        const hasAnnotationAfter = pos < state.doc.content.size && hasAnnotationAt(pos + 1)
        
        // Determine if we're at a boundary
        let isAtBoundary = false
        
        if (hasAnnotationHere) {
          // We're inside an annotation
          // Check if we're at the start (no annotation before)
          if (!hasAnnotationBefore && pos > 0) {
            isAtBoundary = true
            console.log('At start boundary of annotation')
          }
          // Check if we're at the end (no annotation after)
          else if (!hasAnnotationAfter && pos < state.doc.content.size) {
            isAtBoundary = true
            console.log('At end boundary of annotation')
          }
        } else if (hasAnnotationBefore && !hasAnnotationAfter) {
          // We're just after an annotation
          isAtBoundary = true
          console.log('Just after annotation')
        } else if (!hasAnnotationBefore && hasAnnotationAfter) {
          // We're just before an annotation
          isAtBoundary = true
          console.log('Just before annotation')
        }
        
        if (isAtBoundary) {
          // Insert text without annotation mark
          if (isPrintable) {
            const tr = state.tr
              .insertText(event.key, pos)
              .setStoredMarks([]) // Clear all stored marks
            
            view.dispatch(tr)
            event.preventDefault()
            return true
          } else if (isEnter) {
            const tr = state.tr
              .split(pos)
              .setStoredMarks([]) // Clear all stored marks
            
            view.dispatch(tr)
            event.preventDefault()
            return true
          }
        }
        
        return false
      },
      
      // Also handle text input for IME and paste
      handleTextInput(view, from, to, text) {
        const { state } = view
        const $from = state.doc.resolve(from)
        
        const annType = state.schema.marks.annotation
        if (!annType) return false
        
        // Helper to check if a position has annotation
        const hasAnnotationAt = (checkPos: number) => {
          if (checkPos < 0 || checkPos >= state.doc.content.size) return false
          try {
            const $pos = state.doc.resolve(checkPos)
            return $pos.marks().some(m => m.type === annType)
          } catch {
            return false
          }
        }
        
        // Check positions
        const hasAnnotationHere = $from.marks().some(m => m.type === annType)
        const hasAnnotationBefore = from > 0 && hasAnnotationAt(from - 1)
        const hasAnnotationAfter = from < state.doc.content.size && hasAnnotationAt(from + 1)
        
        // Determine if we're at a boundary
        let isAtBoundary = false
        
        if (hasAnnotationHere) {
          if (!hasAnnotationBefore && from > 0) {
            isAtBoundary = true // Start boundary
          } else if (!hasAnnotationAfter && from < state.doc.content.size) {
            isAtBoundary = true // End boundary
          }
        } else if (hasAnnotationBefore && !hasAnnotationAfter) {
          isAtBoundary = true // Just after
        } else if (!hasAnnotationBefore && hasAnnotationAfter) {
          isAtBoundary = true // Just before
        }
        
        if (isAtBoundary) {
          // Insert text without any marks
          const tr = state.tr
            .insertText(text, from, to)
            .setStoredMarks([])
          
          view.dispatch(tr)
          return true // We handled it
        }
        
        return false
      },
      
      // Handle paste events
      handlePaste(view, event) {
        const { state } = view
        const { empty, $from } = state.selection
        
        if (!empty) return false
        
        const annType = state.schema.marks.annotation
        if (!annType) return false
        
        // Similar boundary check logic as above
        const pos = $from.pos
        const hasAnnotationHere = $from.marks().some(m => m.type === annType)
        
        if (hasAnnotationHere) {
          // Check if at boundary
          const hasAnnotationBefore = pos > 0 && state.doc.resolve(pos - 1).marks().some(m => m.type === annType)
          const hasAnnotationAfter = pos < state.doc.content.size && state.doc.resolve(pos + 1).marks().some(m => m.type === annType)
          
          if ((!hasAnnotationBefore && pos > 0) || (!hasAnnotationAfter && pos < state.doc.content.size)) {
            // At boundary - handle paste without annotation
            const text = event.clipboardData?.getData('text/plain')
            if (text) {
              const tr = state.tr
                .insertText(text, pos)
                .setStoredMarks([])
              
              view.dispatch(tr)
              event.preventDefault()
              return true
            }
          }
        }
        
        return false
      }
    }
  })