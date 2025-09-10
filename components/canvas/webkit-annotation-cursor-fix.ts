import { Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'

/**
 * WebKit Annotation Cursor Fix
 * 
 * Manually places cursor when clicking on annotations in Safari/Chrome
 * since these browsers have issues with cursor placement on styled inline elements
 */
export const WebKitAnnotationCursorFix = () => {
  // Detect if we're in a WebKit browser (Safari or Chrome)
  const isWebKit = /webkit/i.test(navigator.userAgent)
  const isSafari = /safari/i.test(navigator.userAgent) && !/chrome/i.test(navigator.userAgent)
  const isChrome = /chrome/i.test(navigator.userAgent)
  
  // Only apply fix for WebKit browsers
  if (!isWebKit && !isSafari && !isChrome) {
    return new Plugin({}) // Return empty plugin for Firefox
  }

  console.log('[WebKitAnnotationCursorFix] Detected WebKit browser, applying cursor fix')

  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          
          // Check if we clicked on an annotation
          if (!target.classList.contains('annotation') && !target.closest('.annotation')) {
            return false // Let normal handling continue
          }

          // Get the annotation element
          const annotationEl = target.classList.contains('annotation') 
            ? target 
            : target.closest('.annotation') as HTMLElement

          if (!annotationEl) {
            return false
          }

          // Get click position relative to the editor
          const editorRect = view.dom.getBoundingClientRect()
          const x = event.clientX - editorRect.left
          const y = event.clientY - editorRect.top

          // Find the position in the document
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
          
          if (!pos) {
            return false
          }

          // Create a text selection at that position
          const selection = TextSelection.create(view.state.doc, pos.pos)
          
          // Apply the selection
          const tr = view.state.tr.setSelection(selection)
          view.dispatch(tr)
          
          // Focus the editor
          view.focus()
          
          // Prevent default only for WebKit browsers on annotations
          event.preventDefault()
          
          console.log('[WebKitAnnotationCursorFix] Manually placed cursor at position:', pos.pos)
          
          return true // We handled it
        }
      }
    }
  })
}