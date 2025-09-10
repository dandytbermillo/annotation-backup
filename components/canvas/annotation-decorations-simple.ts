import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

/**
 * Simplified AnnotationDecorations plugin
 * Only adds CSS classes for styling - no event handlers, no DOM manipulation
 * This avoids interfering with cursor placement in Safari/Chrome
 */
export const AnnotationDecorationsSimple = () => {
  return new Plugin({
    state: {
      init() {
        return { decorations: DecorationSet.empty }
      },
      
      apply(tr, value, oldState, newState) {
        // Create decorations for annotations
        const decorations: Decoration[] = []
        
        newState.doc.descendants((node, pos) => {
          if (node.isText && node.marks.length > 0) {
            const annotationMark = node.marks.find(mark => mark.type.name === 'annotation')
            if (annotationMark) {
              // Add a simple CSS class decoration
              // No event handlers, no DOM elements - just styling
              decorations.push(
                Decoration.inline(pos, pos + node.nodeSize, {
                  class: 'annotation-decorated',
                  nodeName: 'span',
                })
              )
            }
          }
        })
        
        return {
          decorations: DecorationSet.create(newState.doc, decorations)
        }
      }
    },
    
    props: {
      decorations(state) {
        return this.getState(state)?.decorations
      }
    }
  })
}