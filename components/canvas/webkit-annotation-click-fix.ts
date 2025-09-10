import { Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'

/**
 * WebKit Annotation Click Fix
 * 
 * Aggressive fix for cursor not appearing when clicking on annotations
 * in Safari and Electron (Chromium/WebKit browsers).
 * 
 * The issue: WebKit doesn't properly show the cursor when clicking on
 * styled inline elements within contenteditable.
 */
export const WebKitAnnotationClickFix = () => {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          
          // Check if we're clicking on an annotation
          const annotationEl = target.classList?.contains('annotation') 
            ? target 
            : target.closest('.annotation') as HTMLElement
          
          if (annotationEl) {
            // Temporarily disable overlays to avoid focus/click interference
            const icon = document.querySelector('.annotation-hover-icon') as HTMLElement | null
            const tip = document.querySelector('.annotation-tooltip') as HTMLElement | null
            if (icon) icon.style.pointerEvents = 'none'
            if (tip) tip.style.pointerEvents = 'none'
            setTimeout(() => {
              if (icon) icon.style.pointerEvents = 'auto'
              if (tip) tip.style.pointerEvents = 'auto'
            }, 120)
            // Allow default so click can place caret reliably in WebKit
            return false
          }
          
          return false
        },
        
        // Place caret precisely at click position (WebKit-friendly)
        click(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          
          if (!(target.classList?.contains('annotation') || target.closest('.annotation'))) {
            return false
          }
          // Prefer DOM-based caret resolution for Safari/Electron
          const doc: any = document as any
          let range: Range | null = null
          if (typeof doc.caretRangeFromPoint === 'function') {
            range = doc.caretRangeFromPoint(event.clientX, event.clientY)
          } else if (typeof doc.caretPositionFromPoint === 'function') {
            const posObj = doc.caretPositionFromPoint(event.clientX, event.clientY)
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
                const sel = TextSelection.create(view.state.doc, pmPos)
                view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
                if (!view.hasFocus()) view.focus()
                return true
              }
            } catch {}
          }
          // Fallback to coordinate mapping
          const coords = { left: event.clientX, top: event.clientY }
          const pos = view.posAtCoords(coords)
          if (pos && typeof pos.pos === 'number') {
            const sel = TextSelection.create(view.state.doc, pos.pos)
            const tr = view.state.tr.setSelection(sel).scrollIntoView()
            view.dispatch(tr)
            if (!view.hasFocus()) view.focus()
            return true
          }
          return false
        }
      },
      
      // Additional attribute to help with CSS
      attributes: {
        class: 'webkit-fix-active'
      }
    },
    
    // View update to ensure cursor remains visible
    view(view: EditorView) {
      return {
        update(view: EditorView, prevState) {
          // Check if selection changed and we're in an annotation
          if (!view.state.selection.eq(prevState.selection)) {
            const { from } = view.state.selection
            const resolved = view.state.doc.resolve(from)
            const marks = resolved.marks()
            
            // If cursor is in annotation, ensure it's visible
            if (marks.some(mark => mark.type.name === 'annotation')) {
              const editorEl = view.dom as HTMLElement
              
              // Add class for CSS targeting
              editorEl.classList.add('cursor-in-annotation')
              
              // Force cursor visibility in WebKit
              if (navigator.userAgent.includes('Safari') || navigator.userAgent.includes('WebKit')) {
                editorEl.style.caretColor = '#000'
                editorEl.style.webkitTextFillColor = 'initial'
              }
            } else {
              view.dom.classList.remove('cursor-in-annotation')
            }
          }
        }
      }
    }
  })
}
