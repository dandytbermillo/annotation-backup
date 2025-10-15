// @ts-nocheck
import { Plugin, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

/**
 * Browser-Specific Cursor Fix
 * 
 * Applies different strategies based on the browser:
 * - Firefox: Simple TextSelection.create (works well)
 * - Safari/WebKit: More aggressive approach with mark manipulation
 * - Electron: Same as Safari
 */
export const BrowserSpecificCursorFix = () => {
  let browserType: 'firefox' | 'safari' | 'chrome' | 'electron' | 'other' = 'other'
  
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent
    if (ua.includes('Firefox')) {
      browserType = 'firefox'
    } else if (ua.includes('Electron')) {
      browserType = 'electron'
    } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
      browserType = 'safari'
    } else if (ua.includes('Chrome')) {
      browserType = 'chrome'
    }
  }
  
  console.log(`[CursorFix] Detected browser: ${browserType}`)
  
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
          
          // Don't interfere with hover icon
          if (target.classList?.contains('annotation-hover-icon')) {
            return false
          }
          
          // For Firefox - use simple approach that works
          if (browserType === 'firefox') {
            // Get exact click position
            const pos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY
            })
            
            if (pos) {
              // Simple TextSelection works fine in Firefox
              const tr = view.state.tr.setSelection(
                TextSelection.create(view.state.doc, pos.pos)
              )
              view.dispatch(tr)
              view.focus()
              return true
            }
            return false
          }
          
          // For Safari/Electron - only suppress overlays here; selection set on click
          if (browserType === 'safari' || browserType === 'electron') {
            const icon = document.querySelector('.annotation-hover-icon') as HTMLElement | null
            const tip = document.querySelector('.annotation-tooltip') as HTMLElement | null
            if (icon) icon.style.pointerEvents = 'none'
            if (tip) tip.style.pointerEvents = 'none'
            setTimeout(() => {
              if (icon) icon.style.pointerEvents = 'auto'
              if (tip) tip.style.pointerEvents = 'auto'
            }, 120)
            return false
          }
          
          // For Chrome and others - standard approach
          const pos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY
          })
          
          if (pos) {
            const tr = view.state.tr.setSelection(
              TextSelection.create(view.state.doc, pos.pos)
            )
            view.dispatch(tr)
            view.focus()
            return true
          }
          
          return false
        },
        // Place caret on click for Safari/Electron (and fallback)
        click(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          const annotationEl = target.classList?.contains('annotation')
            ? target
            : target.closest('.annotation') as HTMLElement
          if (!annotationEl) return false
          const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
          const isWebKit = ua.includes('Safari') || ua.includes('Electron') || ua.includes('Chrome')
          if (!isWebKit) return false
          // Compute approximate character offset within the annotation text
          const rect = annotationEl.getBoundingClientRect()
          const relX = Math.max(0, Math.min(event.clientX - rect.left, rect.width))
          const textNode = (function findText(n: Node): Text | null {
            if (n.nodeType === Node.TEXT_NODE) return n as Text
            for (const child of Array.from(n.childNodes)) {
              const t = findText(child)
              if (t) return t
            }
            return null
          })(annotationEl)
          if (textNode && textNode.data && textNode.data.length > 0) {
            // Binary search on character width using Range
            const r = document.createRange()
            r.setStart(textNode, 0)
            r.setEnd(textNode, textNode.data.length)
            const full = r.getBoundingClientRect()
            // Quick checks
            let lo = 0, hi = textNode.data.length
            while (lo < hi) {
              const mid = (lo + hi) >> 1
              r.setStart(textNode, 0)
              r.setEnd(textNode, mid)
              const midRect = r.getBoundingClientRect()
              const width = midRect.width - full.left + full.left // width relative
              if (midRect.width < relX) lo = mid + 1
              else hi = mid
            }
            const charOffset = lo
            try {
              const pmPos = view.posAtDOM(textNode, charOffset)
              const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pmPos)).scrollIntoView()
              view.dispatch(tr)
              if (!view.hasFocus()) view.focus()
              return true
            } catch {}
          }
          // Fallbacks: DOM caret → coords
          const docAny: any = document as any
          let range: Range | null = null
          if (typeof docAny.caretRangeFromPoint === 'function') {
            range = docAny.caretRangeFromPoint(event.clientX, event.clientY)
          } else if (typeof docAny.caretPositionFromPoint === 'function') {
            const posObj = docAny.caretPositionFromPoint(event.clientX, event.clientY)
            if (posObj) {
              range = document.createRange()
              range.setStart(posObj.offsetNode, posObj.offset)
              range.collapse(true)
            }
          }
          if (range && range.startContainer) {
            try {
              const pmPos = view.posAtDOM(range.startContainer, range.startOffset)
              if (typeof pmPos === 'number') {
                const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pmPos)).scrollIntoView()
                view.dispatch(tr)
                if (!view.hasFocus()) view.focus()
                return true
              }
            } catch {}
          }
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (pos) {
            const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.pos)).scrollIntoView()
            view.dispatch(tr)
            if (!view.hasFocus()) view.focus()
            return true
          }
          return false
        },
        
        // Additional focus handler for all browsers
        focus(view: EditorView) {
          view.dom.classList.add('editor-focused')
          
          // Special handling for Safari/Electron
          if (browserType === 'safari' || browserType === 'electron') {
            const dom = view.dom as HTMLElement
            dom.style.caretColor = 'black'
            
            // Check if cursor is in annotation
            const { from } = view.state.selection
            const $from = view.state.doc.resolve(from)
            if ($from.marks().some(m => m.type.name === 'annotation')) {
              // Force reflow
              dom.offsetHeight
            }
          }
          
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
