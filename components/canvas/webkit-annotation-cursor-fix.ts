// @ts-nocheck
import { Plugin, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

/**
 * WebKit Annotation Cursor Fix
 * 
 * Manually places cursor when clicking on annotations in Safari/Chrome
 * since these browsers have issues with cursor placement on styled inline elements
 */
export const WebKitAnnotationCursorFix = () => {
  console.log('[WebKitAnnotationCursorFix] Plugin function called')
  
  // Detect if we're in a WebKit browser (Safari or Chrome)
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isChrome = /chrome/i.test(userAgent)
  const isSafari = /safari/i.test(userAgent) && !isChrome
  const isFirefox = /firefox/i.test(userAgent)
  
  console.log('[WebKitAnnotationCursorFix] Browser detection:', {
    userAgent,
    isChrome,
    isSafari,
    isFirefox
  })
  
  // For now, apply to all browsers for testing
  console.log('[WebKitAnnotationCursorFix] Creating plugin for cursor fix')

  const plugin = new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          
          console.log('[WebKitAnnotationCursorFix] 🖱️ ANY Mousedown event detected')
          
          // Try to find annotation with different selectors
          const hasAnnotationClass = target.classList.contains('annotation')
          const closestAnnotation = target.closest('.annotation')
          const closestSpanAnnotation = target.closest('span.annotation')
          const parentElement = target.parentElement
          
          console.log('[WebKitAnnotationCursorFix] Mousedown details:', {
            target: target.tagName,
            classList: target.classList.toString(),
            hasAnnotationClass,
            closestAnnotation: closestAnnotation?.tagName,
            closestSpanAnnotation: closestSpanAnnotation?.tagName,
            parentTag: parentElement?.tagName,
            parentClasses: parentElement?.className,
            textContent: target.textContent?.substring(0, 50)
          })
          
          // Check if we clicked on an annotation
          if (!hasAnnotationClass && !closestAnnotation) {
            console.log('[WebKitAnnotationCursorFix] Not an annotation click, skipping')
            return false // Let normal handling continue
          }

          // Get the annotation element
          const annotationEl = target.classList.contains('annotation') 
            ? target 
            : target.closest('.annotation') as HTMLElement

          if (!annotationEl) {
            console.log('[WebKitAnnotationCursorFix] Could not find annotation element')
            return false
          }

          console.log('[WebKitAnnotationCursorFix] Found annotation:', {
            text: annotationEl.textContent,
            branchId: annotationEl.getAttribute('data-branch'),
            type: annotationEl.getAttribute('data-type')
          })

          // Get click position relative to the editor
          const editorRect = view.dom.getBoundingClientRect()
          const x = event.clientX - editorRect.left
          const y = event.clientY - editorRect.top

          console.log('[WebKitAnnotationCursorFix] Click coordinates:', { x, y })

          // Find the position in the document
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
          
          if (!pos) {
            console.log('[WebKitAnnotationCursorFix] Could not find position at coordinates')
            return false
          }

          console.log('[WebKitAnnotationCursorFix] Document position:', pos.pos)

          // Create a text selection at that position
          const selection = TextSelection.create(view.state.doc, pos.pos)
          
          // Apply the selection
          const tr = view.state.tr.setSelection(selection)
          view.dispatch(tr)
          
          // Focus the editor
          view.focus()
          
          // Prevent default only for WebKit browsers on annotations
          event.preventDefault()
          
          console.log('[WebKitAnnotationCursorFix] ✅ Successfully placed cursor at position:', pos.pos)
          
          return true // We handled it
        }
      }
    }
  })
  
  console.log('[WebKitAnnotationCursorFix] Plugin created:', plugin)
  return plugin
}
