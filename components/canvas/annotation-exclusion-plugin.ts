/**
 * Annotation Exclusion Plugin
 * 
 * This plugin ensures that typing at the beginning or end of an annotation
 * does not extend the annotation mark. It works by intercepting text input
 * and explicitly controlling where marks are applied.
 */

import { Plugin, PluginKey, Transaction } from '@tiptap/pm/state'
import { ReplaceStep, ReplaceAroundStep } from '@tiptap/pm/transform'

export const annotationExclusionKey = new PluginKey('annotationExclusion')

export const AnnotationExclusionPlugin = () =>
  new Plugin({
    key: annotationExclusionKey,
    
    // Filter transactions to prevent mark extension at boundaries
    filterTransaction(tr: Transaction, state) {
      // Check each step in the transaction
      let modified = false
      
      tr.steps.forEach((step, index) => {
        // Only handle text insertion steps
        if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) {
          return
        }
        
        const map = tr.mapping.maps[index]
        if (!map) return
        
        // Get the position where text is being inserted
        const from = (step as any).from
        const to = (step as any).to
        
        // Check if we're at an annotation boundary
        const $from = state.doc.resolve(from)
        const annType = state.schema.marks.annotation
        
        if (!annType) return
        
        // Check marks at the insertion point
        const marksAtPos = $from.marks()
        const hasAnnotation = marksAtPos.some(m => m.type === annType)
        
        if (hasAnnotation) {
          // We're inside an annotation
          // Check if we're at the start or end boundary
          
          // Find the annotation node boundaries
          let annotationStart = from
          let annotationEnd = from
          
          // Walk backwards to find start
          let pos = from - 1
          while (pos >= 0) {
            const $pos = state.doc.resolve(pos)
            const marks = $pos.marks()
            if (!marks.some(m => m.type === annType)) {
              annotationStart = pos + 1
              break
            }
            pos--
            if (pos < 0) annotationStart = 0
          }
          
          // Walk forwards to find end
          pos = from
          while (pos < state.doc.content.size) {
            const $pos = state.doc.resolve(pos)
            const marks = $pos.marks()
            if (!marks.some(m => m.type === annType)) {
              annotationEnd = pos
              break
            }
            pos++
            if (pos >= state.doc.content.size) annotationEnd = state.doc.content.size
          }
          
          // If we're exactly at the start or end, remove annotation from stored marks
          if (from === annotationStart || from === annotationEnd) {
            const storedMarks = tr.storedMarks || state.storedMarks || []
            const filteredMarks = storedMarks.filter(m => m.type !== annType)
            tr.setStoredMarks(filteredMarks.length > 0 ? filteredMarks : null)
            modified = true
          }
        }
      })
      
      return true // Allow transaction to proceed
    },
    
    // Additional handling via appendTransaction
    appendTransaction(transactions, oldState, newState) {
      // Check if selection is at an annotation boundary
      const { empty, $from } = newState.selection
      if (!empty) return null
      
      const annType = newState.schema.marks.annotation
      if (!annType) return null
      
      // Get marks at current position
      const currentMarks = $from.marks()
      const hasAnnotation = currentMarks.some(m => m.type === annType)
      
      // Get stored marks
      const storedMarks = newState.storedMarks || []
      const hasStoredAnnotation = storedMarks.some(m => m.type === annType)
      
      // Logic for handling boundaries
      if (hasAnnotation) {
        // We're inside an annotation
        // Check if we're at a boundary by looking at adjacent positions
        
        const beforePos = Math.max(0, $from.pos - 1)
        const afterPos = Math.min(newState.doc.content.size, $from.pos + 1)
        
        const marksBefore = beforePos >= 0 ? newState.doc.resolve(beforePos).marks() : []
        const marksAfter = afterPos < newState.doc.content.size ? newState.doc.resolve(afterPos).marks() : []
        
        const hasAnnotationBefore = marksBefore.some(m => m.type === annType)
        const hasAnnotationAfter = marksAfter.some(m => m.type === annType)
        
        // At start boundary (no annotation before, but annotation after)
        if (!hasAnnotationBefore && hasAnnotationAfter && $from.pos > 0) {
          // Remove annotation from stored marks
          if (hasStoredAnnotation) {
            return newState.tr.setStoredMarks(
              storedMarks.filter(m => m.type !== annType)
            )
          }
        }
        
        // At end boundary (annotation before, but no annotation after)
        if (hasAnnotationBefore && !hasAnnotationAfter && $from.pos < newState.doc.content.size - 1) {
          // Remove annotation from stored marks
          if (hasStoredAnnotation) {
            return newState.tr.setStoredMarks(
              storedMarks.filter(m => m.type !== annType)
            )
          }
        }
      } else {
        // We're outside an annotation - ensure no stored annotation
        if (hasStoredAnnotation) {
          return newState.tr.setStoredMarks(
            storedMarks.filter(m => m.type !== annType)
          )
        }
      }
      
      return null
    }
  })