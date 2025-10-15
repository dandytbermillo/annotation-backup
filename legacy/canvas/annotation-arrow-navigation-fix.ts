// @ts-nocheck
import { Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Mark } from 'prosemirror-model'

/**
 * Annotation Arrow Navigation Fix
 * 
 * Fixes arrow key navigation at annotation boundaries, especially when
 * annotation is at the end of the content. Allows cursor to move past
 * the annotation using right arrow key.
 */
export const AnnotationArrowNavigationFix = () => {
  // Log plugin creation
  fetch('/api/debug/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      component: 'AnnotationArrowNavigationFix',
      action: 'plugin_created',
      metadata: {},
      content_preview: 'Plugin initialized'
    })
  }).catch(() => {})
  
  return new Plugin({
    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        // Only handle right arrow key
        if (event.key !== 'ArrowRight') {
          return false
        }

        const { state } = view
        const { selection } = state
        const { $from, empty } = selection
        const pos = $from.pos
        const doc = state.doc

        // Log arrow key press details
        fetch('/api/debug/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            component: 'AnnotationArrowNavigationFix',
            action: 'right_arrow_pressed',
            metadata: {
              pos,
              docSize: doc.content.size,
              atEnd: pos === doc.content.size,
              empty: empty,
              marks: $from.marks().map((m: Mark) => ({ type: m.type.name, attrs: m.attrs }))
            },
            content_preview: `Right arrow at pos ${pos}/${doc.content.size}`
          })
        }).catch(() => {})

        // Only handle when cursor is at a single position (not a range)
        if (!empty) {
          return false
        }

        // Get marks at current position
        const marks = $from.marks()
        const hasAnnotationMark = marks.some((mark: Mark) => mark.type.name === 'annotation')

        // If we're not in an annotation, let default handling continue
        if (!hasAnnotationMark) {
          fetch('/api/debug/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              component: 'AnnotationArrowNavigationFix',
              action: 'skip_no_annotation',
              metadata: { pos },
              content_preview: 'Not in annotation, skipping'
            })
          }).catch(() => {})
          return false
        }

        // Check if the next position would be outside the annotation
        const nodeAfter = $from.nodeAfter
        const marksAfter = nodeAfter ? nodeAfter.marks : []
        const nextHasAnnotation = marksAfter.some((mark: Mark) => mark.type.name === 'annotation')
        
        // Also check if we're at the end of a text node or paragraph
        const atNodeEnd = $from.parentOffset === $from.parent.content.size
        const atDocEnd = pos === doc.content.size - 1 // -1 because doc usually has a final newline

        fetch('/api/debug/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            component: 'AnnotationArrowNavigationFix',
            action: 'annotation_boundary_check',
            metadata: { 
              pos, 
              atNodeEnd,
              atDocEnd,
              nextHasAnnotation,
              parentOffset: $from.parentOffset,
              parentSize: $from.parent.content.size,
              docSize: doc.content.size
            },
            content_preview: `Checking boundary: atNodeEnd=${atNodeEnd}, nextHasAnnotation=${nextHasAnnotation}`
          })
        }).catch(() => {})

        // If we're at the end of annotation (next position doesn't have annotation mark)
        // OR we're at the end of the current node/paragraph in an annotation
        if ((atNodeEnd || atDocEnd) && !nextHasAnnotation) {
          fetch('/api/debug/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              component: 'AnnotationArrowNavigationFix',
              action: 'handling_annotation_boundary',
              metadata: { pos, atNodeEnd, atDocEnd, marks: marks.map((m: Mark) => m.type.name) },
              content_preview: 'At annotation boundary, inserting space'
            })
          }).catch(() => {})
          
          // Insert a regular space after the annotation
          const tr = state.tr.insertText(' ', pos)
          
          // Move cursor to after the space
          const newPos = pos + 1
          tr.setSelection(state.selection.constructor.create(tr.doc, newPos))
          
          // Remove annotation mark from the inserted space
          marks.forEach((mark: Mark) => {
            if (mark.type.name === 'annotation') {
              tr.removeMark(pos, newPos, mark)
            }
          })
          
          view.dispatch(tr)
          
          event.preventDefault()
          return true
        }
        
        // Alternative: If we're right at the last character of an annotation
        // Check if cursor is at the last position of annotated text
        const $pos = state.doc.resolve(pos)
        const markEnd = marks.find((m: Mark) => m.type.name === 'annotation')
        
        if (markEnd && pos > 0) {
          // Check if the next character doesn't have the annotation mark
          try {
            const nextPos = state.doc.resolve(Math.min(pos + 1, doc.content.size))
            const nextMarks = nextPos.marks()
            const nextHasAnnotationMark = nextMarks.some((m: Mark) => m.type.name === 'annotation')
            
            if (!nextHasAnnotationMark) {
              fetch('/api/debug/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  component: 'AnnotationArrowNavigationFix',
                  action: 'at_annotation_end',
                  metadata: { pos, nextPos: pos + 1 },
                  content_preview: 'At end of annotation mark, moving cursor out'
                })
              }).catch(() => {})
              
              // Just move the cursor forward without inserting text
              const tr = state.tr
              tr.setSelection(state.selection.constructor.create(doc, Math.min(pos + 1, doc.content.size)))
              view.dispatch(tr)
              
              event.preventDefault()
              return true
            }
          } catch (e) {
            // Position might be invalid, ignore
          }
        }

        return false
      }
    }
  })
}
