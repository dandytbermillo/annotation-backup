import { Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'

/**
 * Safari Notion Fix
 * 
 * Based on how Notion actually handles this:
 * 1. Keep spans as display: inline (NOT inline-block for character-level clicks)
 * 2. Add minimal padding to avoid WebKit issues
 * 3. Use caretRangeFromPoint for precise cursor placement
 */
export const SafariNotionFix = () => {
  const isWebKit = typeof navigator !== 'undefined' && 
    (navigator.userAgent.includes('Safari') || navigator.userAgent.includes('WebKit'))
  
  if (!isWebKit) {
    return new Plugin({})
  }

  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          const annotationEl = target.classList?.contains('annotation') 
            ? target 
            : target.closest('.annotation') as HTMLElement
          
          if (!annotationEl) {
            return false
          }

          // Use Safari's caretRangeFromPoint for precise positioning
          const doc: any = document
          if (typeof doc.caretRangeFromPoint === 'function') {
            const range = doc.caretRangeFromPoint(event.clientX, event.clientY)
            if (range) {
              try {
                // Get the exact position in ProseMirror coordinates
                const pos = view.posAtDOM(range.startContainer, range.startOffset)
                if (typeof pos === 'number') {
                  // Set selection precisely where clicked
                  const selection = TextSelection.create(view.state.doc, pos)
                  view.dispatch(view.state.tr.setSelection(selection))
                  view.focus()
                  return true
                }
              } catch (e) {
                console.log('Failed to set position via caretRangeFromPoint:', e)
              }
            }
          }

          // Fallback to standard positioning
          const coords = { left: event.clientX, top: event.clientY }
          const pos = view.posAtCoords(coords)
          if (pos) {
            const selection = TextSelection.create(view.state.doc, pos.pos)
            view.dispatch(view.state.tr.setSelection(selection))
            view.focus()
            return true
          }

          return false
        }
      }
    }
  })
}