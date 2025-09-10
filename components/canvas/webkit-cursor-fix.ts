import { Plugin, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

/**
 * WebKit Cursor Fix Plugin
 * 
 * Fixes cursor visibility issues in Safari and Electron (Chromium)
 * when clicking on annotated text.
 */
export const WebKitCursorFix = () => {
  return new Plugin({
    props: {
      handleDOMEvents: {
        // Nudge focus and caret placement on mousedown (WebKit)
        mousedown(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          
          // Check if clicking on an annotation
          if (target.classList?.contains('annotation') || target.closest('.annotation')) {
            // Don't prevent default - let normal text selection happen
            // For WebKit browsers, ensure focus and caret after a micro-task
            setTimeout(() => {
              if (!view.hasFocus()) {
                view.focus()
              }
              
              // Get the position where the user clicked
              const pos = view.posAtCoords({
                left: event.clientX,
                top: event.clientY
              })
              
              if (pos) {
                // Set caret exactly at click point
                const tr = view.state.tr.setSelection(
                  TextSelection.create(view.state.doc, pos.pos)
                )
                view.dispatch(tr)
              }
            }, 0)
          }
          
          return false // Don't prevent other handlers
        },
        
        // Ensure focus is maintained
        focus(view: EditorView) {
          // Add a class to help with CSS targeting
          view.dom.classList.add('editor-focused')
          return false
        },
        
        blur(view: EditorView) {
          view.dom.classList.remove('editor-focused')
          return false
        }
      }
    }
  })
}
