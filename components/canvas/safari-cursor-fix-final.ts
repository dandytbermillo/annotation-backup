import { Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'

/**
 * Safari Cursor Fix - Final Solution
 * 
 * Based on research of how Notion, Medium, and Draft.js handle this:
 * 1. Ensure annotation spans are display: inline-block
 * 2. Don't manipulate contentEditable (this breaks typing!)
 * 3. Use native browser caret positioning when possible
 */
export const SafariCursorFixFinal = () => {
  const isWebKit = typeof navigator !== 'undefined' && 
    (navigator.userAgent.includes('Safari') || navigator.userAgent.includes('WebKit'))
  
  if (!isWebKit) {
    // No fix needed for non-WebKit browsers
    return new Plugin({})
  }

  return new Plugin({
    view(view: EditorView) {
      // Ensure all annotations have inline-block display
      const fixAnnotationDisplay = () => {
        const annotations = view.dom.querySelectorAll('.annotation')
        annotations.forEach((el) => {
          const span = el as HTMLElement
          // Only set if not already set to avoid constant reflows
          if (span.style.display !== 'inline-block') {
            span.style.display = 'inline-block'
            span.style.lineHeight = '1.2'
            span.style.verticalAlign = 'baseline'
          }
        })
      }

      // Apply on initialization
      setTimeout(fixAnnotationDisplay, 0)

      return {
        update() {
          // Reapply after updates
          requestAnimationFrame(fixAnnotationDisplay)
        }
      }
    }
  })
}