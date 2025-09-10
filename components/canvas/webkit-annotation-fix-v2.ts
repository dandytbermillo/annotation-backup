import { Plugin, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

/**
 * WebKit Annotation Fix V2
 * 
 * Properly handles cursor placement within annotations for Safari/Electron.
 * Calculates the exact character position where the user clicked.
 */
export const WebKitAnnotationFixV2 = () => {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          
          // Check if clicking on an annotation
          const annotationEl = target.classList?.contains('annotation') 
            ? target 
            : target.closest('.annotation') as HTMLElement
          
          if (!annotationEl) {
            return false
          }
          
          // Don't interfere with hover icon clicks
          if (target.classList?.contains('annotation-hover-icon')) {
            return false
          }
          
          // Prevent default to handle it ourselves
          event.preventDefault()
          
          // Focus the editor first
          if (!view.hasFocus()) {
            view.focus()
          }
          
          // Method 1: Try using posAtCoords for exact position
          const coords = { left: event.clientX, top: event.clientY }
          const pos = view.posAtCoords(coords)
          
          if (pos && pos.pos) {
            // Create a text selection at the exact position
            try {
              const selection = TextSelection.create(view.state.doc, pos.pos)
              const tr = view.state.tr.setSelection(selection)
              view.dispatch(tr)
              
              // Force cursor visibility in WebKit
              requestAnimationFrame(() => {
                view.focus()
              })
              
              return true
            } catch (e) {
              console.log('TextSelection.create failed, trying fallback', e)
            }
          }
          
          // Method 2: Fallback - calculate position within the annotation
          try {
            // Get the annotation's position in the document
            const annotationPos = view.posAtDOM(annotationEl, 0)
            
            // Get click position relative to annotation element
            const rect = annotationEl.getBoundingClientRect()
            const relativeX = event.clientX - rect.left
            
            // Estimate character position based on click location
            // This is approximate but better than always going to the end
            const text = annotationEl.textContent || ''
            const avgCharWidth = rect.width / text.length
            const charOffset = Math.min(
              Math.max(0, Math.floor(relativeX / avgCharWidth)),
              text.length
            )
            
            const finalPos = annotationPos + charOffset
            
            // Create selection at calculated position
            const selection = TextSelection.create(view.state.doc, finalPos)
            const tr = view.state.tr.setSelection(selection)
            view.dispatch(tr)
            
            // Force focus for WebKit
            requestAnimationFrame(() => {
              view.focus()
              
              // Additional WebKit hack: toggle contentEditable
              const dom = view.dom as HTMLElement
              const wasEditable = dom.contentEditable
              dom.contentEditable = 'false'
              setTimeout(() => {
                dom.contentEditable = wasEditable
                view.focus()
              }, 0)
            })
            
            return true
          } catch (e) {
            console.error('Failed to set cursor in annotation:', e)
            return false
          }
        },
        
        // Secondary handler for click events (backup)
        click(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          
          // Only handle if we're in an annotation and no selection exists
          if ((target.classList?.contains('annotation') || target.closest('.annotation')) 
              && view.state.selection.empty) {
            
            // Try to place cursor again
            setTimeout(() => {
              const coords = { left: event.clientX, top: event.clientY }
              const pos = view.posAtCoords(coords)
              
              if (pos && pos.pos) {
                try {
                  const selection = TextSelection.create(view.state.doc, pos.pos)
                  const tr = view.state.tr.setSelection(selection)
                  view.dispatch(tr)
                  view.focus()
                } catch (e) {
                  // Silent fallback
                }
              }
            }, 10)
          }
          
          return false
        }
      }
    }
  })
}