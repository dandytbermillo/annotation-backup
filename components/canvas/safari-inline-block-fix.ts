import { Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

/**
 * Safari Inline Block Fix
 * 
 * Based on research of Notion, Medium, and Draft.js:
 * The key to fixing Safari/Electron cursor visibility in annotations
 * is to ensure the annotation spans are display: inline-block.
 * 
 * This plugin ensures that all annotation spans have the correct
 * display property, even if they're created dynamically.
 */
export const SafariInlineBlockFix = () => {
  return new Plugin({
    view(view: EditorView) {
      // Apply inline-block to all annotations on initialization
      const applyInlineBlock = () => {
        const annotations = view.dom.querySelectorAll('.annotation')
        annotations.forEach((el) => {
          const span = el as HTMLElement
          // Force inline-block display
          span.style.display = 'inline-block'
          span.style.lineHeight = '1.2'
          span.style.verticalAlign = 'baseline'
          // Ensure text selection is allowed
          span.style.webkitUserSelect = 'text'
          span.style.userSelect = 'text'
        })
      }

      // Apply immediately
      setTimeout(applyInlineBlock, 0)

      return {
        update(view: EditorView) {
          // Reapply after any updates to catch new annotations
          requestAnimationFrame(applyInlineBlock)
        }
      }
    }
  })
}