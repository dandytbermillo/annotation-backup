import { Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'

/**
 * Safari Manual Cursor Fix
 * 
 * Since arrow keys work but clicking doesn't, we need to manually
 * handle clicks and place the cursor ourselves.
 */
export const SafariManualCursorFix = () => {
  const isSafari = typeof navigator !== 'undefined' && 
    navigator.userAgent.includes('Safari') && 
    !navigator.userAgent.includes('Chrome')
  
  if (!isSafari) {
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

          // Prevent default to handle it ourselves
          event.preventDefault()
          event.stopPropagation()

          // Get the text node inside the annotation
          const textNode = (function findTextNode(node: Node): Text | null {
            if (node.nodeType === Node.TEXT_NODE) {
              return node as Text
            }
            for (const child of Array.from(node.childNodes)) {
              const found = findTextNode(child)
              if (found) return found
            }
            return null
          })(annotationEl)

          if (!textNode || !textNode.textContent) {
            return false
          }

          // Calculate click position within the annotation
          const rect = annotationEl.getBoundingClientRect()
          const relativeX = event.clientX - rect.left
          const text = textNode.textContent
          
          // Create a range to measure character positions
          const range = document.createRange()
          let clickedOffset = 0
          
          // Binary search for the clicked character position
          for (let i = 0; i <= text.length; i++) {
            range.setStart(textNode, 0)
            range.setEnd(textNode, i)
            const rangeRect = range.getBoundingClientRect()
            const width = rangeRect.width
            
            if (width >= relativeX) {
              // Check if we're closer to this character or the previous one
              if (i > 0) {
                range.setStart(textNode, 0)
                range.setEnd(textNode, i - 1)
                const prevRect = range.getBoundingClientRect()
                const prevWidth = prevRect.width
                const midPoint = (prevWidth + width) / 2
                clickedOffset = relativeX < midPoint ? i - 1 : i
              } else {
                clickedOffset = 0
              }
              break
            }
            clickedOffset = i
          }

          // Get the ProseMirror position
          try {
            const pos = view.posAtDOM(textNode, clickedOffset)
            const selection = TextSelection.create(view.state.doc, pos)
            const tr = view.state.tr.setSelection(selection)
            view.dispatch(tr)
            
            // Force focus
            view.focus()
            
            // Force Safari to show the cursor by manipulating selection
            setTimeout(() => {
              const sel = window.getSelection()
              if (sel) {
                sel.removeAllRanges()
                const newRange = document.createRange()
                newRange.setStart(textNode, clickedOffset)
                newRange.setEnd(textNode, clickedOffset)
                sel.addRange(newRange)
              }
            }, 0)
            
            return true
          } catch (e) {
            console.error('Failed to set cursor position:', e)
            return false
          }
        }
      }
    }
  })
}