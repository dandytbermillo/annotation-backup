import { Plugin, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

/**
 * WebKit Radical Fix
 * 
 * A more aggressive approach for Safari/Electron cursor visibility.
 * Temporarily removes and re-adds the annotation mark to force cursor display.
 */
export const WebKitRadicalFix = () => {
  let isWebKit = false
  
  if (typeof navigator !== 'undefined') {
    isWebKit = /WebKit/i.test(navigator.userAgent) && !/Firefox/i.test(navigator.userAgent)
  }
  
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          // Only apply this fix for WebKit browsers (Safari, Electron)
          if (!isWebKit) {
            return false
          }
          
          const target = event.target as HTMLElement
          
          // Check if clicking on an annotation
          const annotationEl = target.classList?.contains('annotation') 
            ? target 
            : target.closest('.annotation') as HTMLElement
          
          if (!annotationEl) {
            return false
          }
          
          // Don't interfere with hover icon
          if (target.classList?.contains('annotation-hover-icon')) {
            return false
          }
          
          // Prevent default handling
          event.preventDefault()
          event.stopPropagation()
          
          // Get the exact position where user clicked
          const coords = { left: event.clientX, top: event.clientY }
          const pos = view.posAtCoords(coords)
          
          if (!pos) {
            return false
          }
          
          const { state } = view
          const $pos = state.doc.resolve(pos.pos)
          
          // Find the annotation mark at this position
          const marks = $pos.marks()
          const annotationMark = marks.find(m => m.type.name === 'annotation')
          
          if (annotationMark) {
            // Get the range of the annotation
            let start = pos.pos
            let end = pos.pos
            
            // Find start of annotation
            state.doc.nodesBetween(Math.max(0, pos.pos - 100), pos.pos, (node, nodePos) => {
              if (node.isText && node.marks.some(m => m.eq(annotationMark))) {
                start = Math.min(start, nodePos)
              }
            })
            
            // Find end of annotation
            state.doc.nodesBetween(pos.pos, Math.min(state.doc.content.size, pos.pos + 100), (node, nodePos) => {
              if (node.isText && node.marks.some(m => m.eq(annotationMark))) {
                end = Math.max(end, nodePos + node.nodeSize)
              }
            })
            
            // Create a transaction that:
            // 1. Removes the annotation mark
            // 2. Sets the selection
            // 3. Re-adds the annotation mark
            let tr = state.tr
            
            // Remove the mark
            tr = tr.removeMark(start, end, annotationMark.type)
            
            // Set selection at click position
            tr = tr.setSelection(TextSelection.create(tr.doc, pos.pos))
            
            // Dispatch without the mark first
            view.dispatch(tr)
            
            // Force focus
            view.focus()
            
            // Re-add the mark after a micro-task
            setTimeout(() => {
              const newTr = view.state.tr.addMark(start, end, annotationMark)
              view.dispatch(newTr)
            }, 0)
            
            return true
          }
          
          // Fallback: just set selection without mark manipulation
          const tr = state.tr.setSelection(TextSelection.create(state.doc, pos.pos))
          view.dispatch(tr)
          view.focus()
          
          return true
        },
        
        // Alternative approach using focus event
        focus(view: EditorView) {
          if (!isWebKit) {
            return false
          }
          
          // Add a class for CSS targeting
          view.dom.classList.add('webkit-focused')
          
          // Check if cursor is in an annotation
          const { from } = view.state.selection
          const $from = view.state.doc.resolve(from)
          const marks = $from.marks()
          
          if (marks.some(m => m.type.name === 'annotation')) {
            // Force cursor visibility by manipulating DOM
            const dom = view.dom as HTMLElement
            
            // Temporarily change caret color to ensure visibility
            dom.style.caretColor = 'black'
            
            // Force reflow
            dom.offsetHeight
            
            // Reset after animation frame
            requestAnimationFrame(() => {
              dom.style.caretColor = ''
            })
          }
          
          return false
        },
        
        blur(view: EditorView) {
          view.dom.classList.remove('webkit-focused')
          return false
        }
      }
    },
    
    // Additional view layer for WebKit
    view(view: EditorView) {
      return {
        update(view: EditorView, prevState) {
          if (!isWebKit) return
          
          // If selection changed and we're in an annotation
          if (!view.state.selection.eq(prevState.selection)) {
            const { from } = view.state.selection
            const $from = view.state.doc.resolve(from)
            const marks = $from.marks()
            
            if (marks.some(m => m.type.name === 'annotation')) {
              // Force DOM update
              const dom = view.dom as HTMLElement
              
              // Toggle a data attribute to force re-render
              if (dom.dataset.webkitHack === 'true') {
                delete dom.dataset.webkitHack
              } else {
                dom.dataset.webkitHack = 'true'
              }
              
              // Also try the contentEditable toggle trick
              requestAnimationFrame(() => {
                const editable = dom.contentEditable
                dom.contentEditable = 'false'
                dom.contentEditable = editable
                view.focus()
              })
            }
          }
        }
      }
    }
  })
}