import { Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

/**
 * Annotation Decorations - Hover Only Version
 * Shows hover icon and reuses the original tooltip exactly as designed
 * Does NOT interfere with cursor placement
 */
export const AnnotationDecorationsHoverOnly = () => {
  let hoverIcon: HTMLElement | null = null
  let currentAnnotation: HTMLElement | null = null
  let hideTimeout: NodeJS.Timeout | null = null

  return new Plugin({
    view(editorView: EditorView) {
      // Create hover icon element (square shape)
      hoverIcon = document.createElement('div')
      hoverIcon.className = 'annotation-hover-icon'
      hoverIcon.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        </svg>
      `
      hoverIcon.style.cssText = `
        position: absolute;
        width: 24px;
        height: 24px;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        cursor: pointer;
        display: none;
        z-index: 1000;
        padding: 3px;
        pointer-events: auto;
        transition: all 0.2s ease;
      `
      document.body.appendChild(hoverIcon)

      // Show hover icon ONLY
      const showHoverIcon = (annotation: HTMLElement) => {
        if (hideTimeout) {
          clearTimeout(hideTimeout)
          hideTimeout = null
        }

        currentAnnotation = annotation
        const rect = annotation.getBoundingClientRect()
        
        // Position hover icon to the right of the annotation
        hoverIcon!.style.left = `${rect.right + 5}px`
        hoverIcon!.style.top = `${rect.top - 3}px`
        hoverIcon!.style.display = 'block'
        
        // Get branch ID and type for the icon
        const branchId = annotation.getAttribute('data-branch') || 
                        annotation.getAttribute('data-branch-id')
        const annotationType = annotation.getAttribute('data-type') || 'note'
        
        if (branchId) {
          hoverIcon!.setAttribute('data-branch-id', branchId)
          hoverIcon!.setAttribute('data-annotation-type', annotationType)
        }
      }

      // Hide hover icon
      const hideHoverIcon = () => {
        hideTimeout = setTimeout(() => {
          if (hoverIcon) hoverIcon.style.display = 'none'
          currentAnnotation = null
        }, 200)
      }

      // Mouse over handler
      const handleMouseOver = (e: MouseEvent) => {
        const target = e.target as HTMLElement
        const annotation = target.classList.contains('annotation') 
          ? target 
          : target.closest('.annotation') as HTMLElement
        
        if (annotation) {
          showHoverIcon(annotation)
        }
      }

      // Mouse out handler
      const handleMouseOut = (e: MouseEvent) => {
        const target = e.target as HTMLElement
        const relatedTarget = e.relatedTarget as HTMLElement
        const annotation = target.classList.contains('annotation') 
          ? target 
          : target.closest('.annotation') as HTMLElement
        
        if (annotation) {
          if (!relatedTarget || 
              (!relatedTarget.closest('.annotation-hover-icon') && 
               !relatedTarget.closest('.annotation'))) {
            hideHoverIcon()
          }
        }
      }

      // Click handler for hover icon
      hoverIcon.addEventListener('click', (e) => {
        e.stopPropagation()
        const branchId = hoverIcon!.getAttribute('data-branch-id')
        if (branchId) {
          // Dispatch event to show tooltip using the original implementation
          const event = new CustomEvent('show-annotation-tooltip', {
            detail: { 
              branchId, 
              element: hoverIcon,
              type: hoverIcon!.getAttribute('data-annotation-type') || 'note'
            }
          })
          window.dispatchEvent(event)
          
          // Also dispatch panel open event
          window.dispatchEvent(new CustomEvent('create-panel', { 
            detail: { panelId: branchId } 
          }))
        }
      })

      // Hover effects for the icon
      hoverIcon.addEventListener('mouseenter', () => {
        if (hideTimeout) {
          clearTimeout(hideTimeout)
          hideTimeout = null
        }
        hoverIcon!.style.background = '#f7fafc'
        hoverIcon!.style.borderColor = '#cbd5e0'
        hoverIcon!.style.transform = 'scale(1.1)'
        
        // Dispatch event to show the original tooltip
        const branchId = hoverIcon!.getAttribute('data-branch-id')
        const type = hoverIcon!.getAttribute('data-annotation-type') || 'note'
        if (branchId) {
          const event = new CustomEvent('show-annotation-tooltip', {
            detail: { branchId, element: hoverIcon, type }
          })
          window.dispatchEvent(event)
        }
      })

      hoverIcon.addEventListener('mouseleave', () => {
        hoverIcon!.style.background = 'white'
        hoverIcon!.style.borderColor = '#e2e8f0'
        hoverIcon!.style.transform = 'scale(1)'
        
        // Dispatch event to hide tooltip
        window.dispatchEvent(new CustomEvent('hide-annotation-tooltip'))
        hideHoverIcon()
      })

      // Attach listeners to editor
      editorView.dom.addEventListener('mouseover', handleMouseOver)
      editorView.dom.addEventListener('mouseout', handleMouseOut)

      return {
        destroy() {
          editorView.dom.removeEventListener('mouseover', handleMouseOver)
          editorView.dom.removeEventListener('mouseout', handleMouseOut)
          
          if (hoverIcon && hoverIcon.parentNode) {
            hoverIcon.parentNode.removeChild(hoverIcon)
            hoverIcon = null
          }
        }
      }
    }
  })
}