/**
 * Annotation Strict Boundary Plugin
 * 
 * A more aggressive approach to prevent annotation extension at boundaries.
 * This plugin completely overrides TipTap's mark handling for annotations.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Slice, Fragment } from '@tiptap/pm/model'

export const annotationStrictBoundaryKey = new PluginKey('annotationStrictBoundary')

export const AnnotationStrictBoundary = () =>
  new Plugin({
    key: annotationStrictBoundaryKey,
    
    props: {
      // Override how transactions handle marks
      transformPasted(slice, view) {
        // When pasting at annotation boundaries, strip annotation marks
        const { state } = view
        const { $from } = state.selection
        const annType = state.schema.marks.annotation
        
        if (!annType) return slice
        
        // Check if we're at an annotation boundary
        const marks = $from.marks()
        const hasAnnotation = marks.some(m => m.type === annType)
        
        if (hasAnnotation) {
          // Remove annotation marks from pasted content
          const fragment = slice.content
          const newFragment = fragment.map(node => {
            if (node.marks.some(m => m.type === annType)) {
              return node.mark(node.marks.filter(m => m.type !== annType))
            }
            return node
          })
          return new Slice(newFragment, slice.openStart, slice.openEnd)
        }
        
        return slice
      },
      
      // The most important hook - called before ANY edit
      handleDOMEvents: {
        beforeinput(view, event) {
          const inputType = (event as InputEvent).inputType
          const data = (event as InputEvent).data
          
          // Handle text insertion
          if (inputType === 'insertText' || inputType === 'insertCompositionText') {
            const { state } = view
            const { empty, $from } = state.selection
            
            if (!empty) return false
            
            const annType = state.schema.marks.annotation
            if (!annType) return false
            
            const pos = $from.pos
            const marks = $from.marks()
            const hasAnnotation = marks.some(m => m.type === annType)
            
            if (hasAnnotation) {
              // Check if we're at the edge of the annotation
              let isAtEdge = false
              
              // Check if there's no annotation immediately before
              if (pos > 0) {
                const $before = state.doc.resolve(pos - 1)
                const marksBefore = $before.marks()
                if (!marksBefore.some(m => m.type === annType)) {
                  isAtEdge = true
                  console.log('At START edge of annotation')
                }
              } else {
                isAtEdge = true // At document start
              }
              
              // Check if there's no annotation immediately after
              if (!isAtEdge && pos < state.doc.content.size) {
                try {
                  const $after = state.doc.resolve(pos + 1)
                  const marksAfter = $after.marks()
                  if (!marksAfter.some(m => m.type === annType)) {
                    isAtEdge = true
                    console.log('At END edge of annotation')
                  }
                } catch {
                  // At document end
                  isAtEdge = true
                }
              }
              
              if (isAtEdge && data) {
                // Insert text without the annotation mark
                event.preventDefault()
                
                // Create a transaction that inserts plain text
                const tr = state.tr.insertText(data, pos)
                
                // Explicitly remove annotation mark from stored marks
                const storedMarks = state.storedMarks || []
                const newMarks = storedMarks.filter(m => m.type !== annType)
                tr.setStoredMarks(newMarks.length > 0 ? newMarks : null)
                
                view.dispatch(tr)
                return true
              }
            }
          }
          
          return false
        },
        
        // Also handle composition events for IME
        compositionstart(view) {
          const { state } = view
          const { $from } = state.selection
          const annType = state.schema.marks.annotation
          
          if (annType) {
            // Store the composition start state
            (view as any)._compositionStartMarks = $from.marks()
          }
          return false
        },
        
        compositionend(view) {
          const { state } = view
          const annType = state.schema.marks.annotation
          
          if (annType && (view as any)._compositionStartMarks) {
            // Clear stored annotation marks if needed
            const storedMarks = state.storedMarks || []
            const newMarks = storedMarks.filter(m => m.type !== annType)
            if (newMarks.length !== storedMarks.length) {
              view.dispatch(state.tr.setStoredMarks(newMarks.length > 0 ? newMarks : null))
            }
            delete (view as any)._compositionStartMarks
          }
          return false
        }
      }
    },
    
    // Clean up stored marks after each transaction
    appendTransaction(transactions, oldState, newState) {
      // Check if cursor moved to/from annotation boundary
      const annType = newState.schema.marks.annotation
      if (!annType) return null
      
      const { empty, $from } = newState.selection
      if (!empty) return null
      
      const marks = $from.marks()
      const hasAnnotation = marks.some(m => m.type === annType)
      const storedMarks = newState.storedMarks || []
      const hasStoredAnnotation = storedMarks.some(m => m.type === annType)
      
      // If we're not in an annotation but have stored annotation mark, remove it
      if (!hasAnnotation && hasStoredAnnotation) {
        console.log('Removing stored annotation mark (not in annotation)')
        return newState.tr.setStoredMarks(
          storedMarks.filter(m => m.type !== annType)
        )
      }
      
      // If we're at an annotation boundary, remove stored annotation mark
      if (hasAnnotation) {
        const pos = $from.pos
        let isAtBoundary = false
        
        // Check before
        if (pos > 0) {
          try {
            const $before = newState.doc.resolve(pos - 1)
            if (!$before.marks().some(m => m.type === annType)) {
              isAtBoundary = true
            }
          } catch {}
        } else {
          isAtBoundary = true
        }
        
        // Check after
        if (!isAtBoundary && pos < newState.doc.content.size) {
          try {
            const $after = newState.doc.resolve(pos + 1)
            if (!$after.marks().some(m => m.type === annType)) {
              isAtBoundary = true
            }
          } catch {}
        } else if (pos >= newState.doc.content.size - 1) {
          isAtBoundary = true
        }
        
        if (isAtBoundary && hasStoredAnnotation) {
          console.log('At annotation boundary - removing stored mark')
          return newState.tr.setStoredMarks(
            storedMarks.filter(m => m.type !== annType)
          )
        }
      }
      
      return null
    }
  })