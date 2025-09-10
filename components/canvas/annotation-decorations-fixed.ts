import { Plugin } from 'prosemirror-state'
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view'

/**
 * Fixed AnnotationDecorations plugin that doesn't interfere with clicks
 * Key changes:
 * - No mousedown/mouseup handlers that block events
 * - Hover icon uses pointer-events: none except for the icon itself
 * - Simpler implementation that doesn't interfere with cursor placement
 */
export const AnnotationDecorationsFixed = () => {
  let hoverIcon: HTMLElement | null = null
  let tooltipElement: HTMLElement | null = null
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
        pointer-events: auto; /* Icon itself can be clicked */
        transition: all 0.2s ease;
      `
      document.body.appendChild(hoverIcon)

      // Create tooltip element using the original class
      tooltipElement = document.createElement('div')
      tooltipElement.className = 'annotation-tooltip'
      // Don't add inline styles - use the CSS classes we added
      document.body.appendChild(tooltipElement)

      // Show hover icon ONLY (no tooltip when hovering annotation text)
      const showHoverElements = (annotation: HTMLElement) => {
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
        
        // Get branch ID for the icon
        const branchId = annotation.getAttribute('data-branch') || 
                        annotation.getAttribute('data-branch-id')
        
        if (branchId) {
          hoverIcon!.setAttribute('data-branch-id', branchId)
        }
        
        // DO NOT show tooltip here - only show it when hovering the icon
      }

      // Hide hover elements
      const hideHoverElements = () => {
        hideTimeout = setTimeout(() => {
          if (hoverIcon) hoverIcon.style.display = 'none'
          if (tooltipElement) tooltipElement.style.display = 'none'
          currentAnnotation = null
        }, 200) // Small delay to prevent flickering
      }

      // Mouse over handler - use event delegation
      const handleMouseOver = (e: MouseEvent) => {
        const target = e.target as HTMLElement
        
        // Check if we're hovering over an annotation
        const annotation = target.classList.contains('annotation') 
          ? target 
          : target.closest('.annotation') as HTMLElement
        
        if (annotation) {
          showHoverElements(annotation)
        }
      }

      // Mouse out handler
      const handleMouseOut = (e: MouseEvent) => {
        const target = e.target as HTMLElement
        const relatedTarget = e.relatedTarget as HTMLElement
        
        // Check if we're leaving the annotation
        const annotation = target.classList.contains('annotation') 
          ? target 
          : target.closest('.annotation') as HTMLElement
        
        if (annotation) {
          // Check if we're moving to the hover icon or tooltip
          if (!relatedTarget || 
              (!relatedTarget.closest('.annotation-hover-icon') && 
               !relatedTarget.closest('.annotation-tooltip') &&
               !relatedTarget.closest('.annotation'))) {
            hideHoverElements()
          }
        }
      }

      // Click handler for hover icon only
      hoverIcon.addEventListener('click', (e) => {
        e.stopPropagation()
        const branchId = hoverIcon!.getAttribute('data-branch-id')
        if (branchId) {
          console.log('[AnnotationDecorationsFixed] Opening branch panel:', branchId)
          window.dispatchEvent(new CustomEvent('create-panel', { 
            detail: { panelId: branchId } 
          }))
        }
      })

      // Helper function to get type icon
      const getTypeIcon = (type: string) => {
        switch(type) {
          case 'note': return '📝'
          case 'explore': return '🔍'
          case 'promote': return '⭐'
          default: return '📝'
        }
      }

      // Helper function to check if tooltip is scrollable
      const checkTooltipScrollable = () => {
        if (!tooltipElement) return
        
        setTimeout(() => {
          const contentEl = tooltipElement.querySelector('.tooltip-content') as HTMLElement
          if (contentEl) {
            if (contentEl.scrollHeight > contentEl.clientHeight) {
              tooltipElement.classList.add('has-scroll')
              contentEl.style.overflowY = 'auto'
            } else {
              tooltipElement.classList.remove('has-scroll')
              contentEl.style.overflowY = 'hidden'
            }
          }
        }, 10)
      }

      // Show tooltip when hovering over the icon
      hoverIcon.addEventListener('mouseenter', async () => {
        if (hideTimeout) {
          clearTimeout(hideTimeout)
          hideTimeout = null
        }
        // Add hover effect
        hoverIcon!.style.background = '#f7fafc'
        hoverIcon!.style.borderColor = '#cbd5e0'
        hoverIcon!.style.transform = 'scale(1.1)'
        
        // Show tooltip with branch content when hovering icon
        const branchId = hoverIcon!.getAttribute('data-branch-id')
        const type = currentAnnotation?.getAttribute('data-type') || 'note'
        
        if (branchId && tooltipElement) {
          const iconRect = hoverIcon!.getBoundingClientRect()
          
          // Position tooltip
          tooltipElement!.style.left = `${iconRect.right + 10}px`
          tooltipElement!.style.top = `${iconRect.top}px`
          
          // Show loading state with proper structure
          tooltipElement!.innerHTML = `
            <div class="tooltip-header">
              <span class="tooltip-icon">${getTypeIcon(type)}</span>
              <span class="tooltip-title">Loading...</span>
            </div>
            <div class="tooltip-content">Loading branch content...</div>
            <div class="tooltip-footer">Click icon to open panel</div>
          `
          
          // Make tooltip visible
          tooltipElement!.classList.add('visible')
          
          // Fetch branch content (same logic as original)
          const noteIdFromPath = window.location.pathname.match(/note\/([^/]+)/)?.[1]
          const noteId = noteIdFromPath || document.querySelector('[data-note-id]')?.getAttribute('data-note-id')
          
          if (noteId) {
            // Fetch document content for this branch
            fetch(`/api/postgres-offline/documents/${noteId}/${branchId}`)
              .then(res => res.json())
              .then(doc => {
                let content = ''
                if (doc && doc.content) {
                  if (typeof doc.content === 'string') {
                    content = doc.content.replace(/<[^>]*>/g, '').trim()
                  } else if (doc.content.content) {
                    // Extract text from ProseMirror JSON
                    const extractText = (node: any): string => {
                      let text = ''
                      if (node.text) text += node.text
                      if (node.content && Array.isArray(node.content)) {
                        for (const child of node.content) {
                          text += extractText(child)
                        }
                      }
                      return text
                    }
                    content = extractText(doc.content)
                  }
                }
                
                // Don't truncate content - let scrolling handle long text
                const fullContent = content || 'No notes added yet'
                const title = `${type.charAt(0).toUpperCase() + type.slice(1)} annotation`
                
                tooltipElement!.innerHTML = `
                  <div class="tooltip-header">
                    <span class="tooltip-icon">${getTypeIcon(type)}</span>
                    <span class="tooltip-title">${title}</span>
                  </div>
                  <div class="tooltip-content">${fullContent}</div>
                  <div class="tooltip-footer">Click icon to open panel</div>
                `
                
                // Check if content is scrollable
                checkTooltipScrollable()
              })
              .catch(err => {
                console.error('[AnnotationDecorationsFixed] Error:', err)
                tooltipElement!.innerHTML = `<div style="color: #e53e3e;">Error loading content</div>`
              })
          }
        }
      })

      hoverIcon.addEventListener('mouseleave', () => {
        console.log('[AnnotationDecorationsFixed] Icon mouseleave - hiding tooltip')
        // Remove hover effect
        hoverIcon!.style.background = 'white'
        hoverIcon!.style.borderColor = '#e2e8f0'
        hoverIcon!.style.transform = 'scale(1)'
        
        // Hide tooltip immediately when leaving icon
        if (tooltipElement) {
          tooltipElement.style.display = 'none'
          tooltipElement.style.opacity = '0'
        }
        
        hideHoverElements()
      })

      // Attach listeners to editor
      editorView.dom.addEventListener('mouseover', handleMouseOver)
      editorView.dom.addEventListener('mouseout', handleMouseOut)

      return {
        destroy() {
          // Clean up event listeners
          editorView.dom.removeEventListener('mouseover', handleMouseOver)
          editorView.dom.removeEventListener('mouseout', handleMouseOut)
          
          // Remove hover elements
          if (hoverIcon && hoverIcon.parentNode) {
            hoverIcon.parentNode.removeChild(hoverIcon)
            hoverIcon = null
          }
          if (tooltipElement && tooltipElement.parentNode) {
            tooltipElement.parentNode.removeChild(tooltipElement)
            tooltipElement = null
          }
        }
      }
    }
  })
}