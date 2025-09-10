import { Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

/**
 * Safari Proven Fix - Based on research document
 * 
 * The research conclusively shows:
 * 1. display: inline-block WORKS for Safari cursor placement
 * 2. margin-right: 1px helps with adjacent spans
 * 3. -webkit-user-modify: read-write-plaintext-only stabilizes behavior
 * 
 * This plugin ensures all three fixes are applied.
 */
export const SafariProvenFix = () => {
  return new Plugin({
    view(view: EditorView) {
      // Apply the proven CSS fixes to all annotations
      const applyProvenFixes = () => {
        const annotations = view.dom.querySelectorAll('.annotation')
        annotations.forEach((el) => {
          const span = el as HTMLElement
          
          // Apply ALL the proven fixes from the research
          span.style.display = 'inline-block'
          span.style.verticalAlign = 'middle' // Prevents tall cursor
          span.style.lineHeight = '1' // Normalizes cursor height
          span.style.marginRight = '1px' // Helps with adjacent spans
          
          // Safari-specific fix for plain text editing
          span.style.webkitUserModify = 'read-write-plaintext-only'
          span.style.caretColor = 'auto'
          span.style.userSelect = 'text'
        })
      }

      // Apply immediately
      setTimeout(applyProvenFixes, 0)

      return {
        update() {
          // Reapply after any updates
          requestAnimationFrame(applyProvenFixes)
        }
      }
    }
  })
}