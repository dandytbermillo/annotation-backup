/**
 * Annotation Boundary Fix
 * 
 * Ensures typing at both START and END of annotations extends the highlight.
 * This prevents the "sticky highlight" effect where characters detach.
 * 
 * Works with keepOnSplit: false to prevent Enter from extending annotations.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state'

export const annotationStartBoundaryKey = new PluginKey('annotationStartBoundary')

export const AnnotationStartBoundaryFix = () =>
  new Plugin({
    key: annotationStartBoundaryKey,
    
    props: {
      handleTextInput(view, from, to, text) {
        const { state } = view
        const { $from } = state.selection
        
        const annType = state.schema.marks.annotation
        if (!annType) return false
        
        const pos = $from.pos
        const nodeAfter = $from.nodeAfter
        const nodeBefore = $from.nodeBefore
        
        // Check if we're at the START of an annotation
        if (nodeAfter && nodeAfter.marks.some(m => m.type === annType)) {
          const annotationMark = nodeAfter.marks.find(m => m.type === annType)
          if (annotationMark) {
            // Insert text WITH the annotation mark
            const tr = state.tr.insertText(text, from, to)
            tr.addMark(from, from + text.length, annotationMark)
            view.dispatch(tr)
            return true
          }
        }
        
        // Check if we're at the END of an annotation
        if (nodeBefore && nodeBefore.marks.some(m => m.type === annType)) {
          const annotationMark = nodeBefore.marks.find(m => m.type === annType)
          if (annotationMark) {
            // Insert text WITH the annotation mark
            const tr = state.tr.insertText(text, from, to)
            tr.addMark(from, from + text.length, annotationMark)
            view.dispatch(tr)
            return true
          }
        }
        
        return false // Let default handling continue
      },
      
      // Also handle keyboard events for single characters
      handleKeyDown(view, event) {
        // Only handle printable characters
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey) {
          return false
        }
        
        const { state } = view
        const { empty, $from } = state.selection
        
        if (!empty) return false
        
        const annType = state.schema.marks.annotation
        if (!annType) return false
        
        const pos = $from.pos
        const nodeAfter = $from.nodeAfter
        const nodeBefore = $from.nodeBefore
        
        // Check if we're at the START of an annotation
        if (nodeAfter && nodeAfter.marks.some(m => m.type === annType)) {
          const annotationMark = nodeAfter.marks.find(m => m.type === annType)
          if (annotationMark) {
            event.preventDefault()
            const tr = state.tr.insertText(event.key, pos)
            tr.addMark(pos, pos + 1, annotationMark)
            view.dispatch(tr)
            return true
          }
        }
        
        // Check if we're at the END of an annotation
        if (nodeBefore && nodeBefore.marks.some(m => m.type === annType)) {
          const annotationMark = nodeBefore.marks.find(m => m.type === annType)
          if (annotationMark) {
            event.preventDefault()
            const tr = state.tr.insertText(event.key, pos)
            tr.addMark(pos, pos + 1, annotationMark)
            view.dispatch(tr)
            return true
          }
        }
        
        return false
      }
    }
  })