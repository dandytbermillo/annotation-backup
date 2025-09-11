/**
 * ProseMirror Plugin for Annotation Hover Detection
 * Based on production patterns from Notion, TipTap, Medium
 * Handles hover state in both edit and non-edit modes
 */

import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorView } from '@tiptap/pm/view'

export const annotationHoverKey = new PluginKey('annotationHover')

interface HoverState {
  hoveredAnnotation: HTMLElement | null
  hoveredBranchId: string | null
  hoveredType: string | null
  mouseX: number
  mouseY: number
}

interface HoverIconManager {
  show: (x: number, y: number, branchId: string, type: string) => void
  hide: () => void
  destroy: () => void
}

/**
 * Creates external hover icon manager (overlay approach)
 * This keeps the icon outside the editor DOM to prevent interference
 */
function createHoverIconManager(): HoverIconManager {
  console.log('[HoverPlugin] Creating hover icon manager...')
  
  // Create overlay container
  const overlay = document.createElement('div')
  overlay.className = 'annotation-hover-overlay-plugin'
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 999999;
    pointer-events: none;
    overflow: visible;
  `
  document.body.appendChild(overlay)

  // Create icon element
  const icon = document.createElement('button')
  icon.className = 'annotation-hover-icon-plugin'
  icon.setAttribute('aria-label', 'Annotation actions')
  icon.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    </svg>
  `
  icon.style.cssText = `
    position: absolute;
    width: 24px;
    height: 24px;
    padding: 3px;
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0,0,0,.12);
    background: white;
    border: 1px solid rgba(0,0,0,.08);
    display: none;
    opacity: 0;
    transition: opacity .12s, transform .12s;
    transform: translateY(4px) scale(.98);
    pointer-events: auto;
    cursor: pointer;
  `
  overlay.appendChild(icon)

  let hideTimeout: NodeJS.Timeout | null = null
  let currentBranchId: string | null = null
  let currentType: string | null = null

  // Icon hover state
  let isOverIcon = false
  icon.addEventListener('mouseenter', () => {
    isOverIcon = true
    if (hideTimeout) {
      clearTimeout(hideTimeout)
      hideTimeout = null
    }
    icon.style.background = '#f7fafc'
    icon.style.borderColor = '#cbd5e0'
    icon.style.transform = 'translateY(0) scale(1.05)'
  })

  icon.addEventListener('mouseleave', () => {
    isOverIcon = false
    icon.style.background = 'white'
    icon.style.borderColor = 'rgba(0,0,0,.08)'
    icon.style.transform = 'translateY(0) scale(1)'
    
    // Hide after delay if not hovering annotation
    hideTimeout = setTimeout(() => {
      icon.style.opacity = '0'
      icon.style.transform = 'translateY(4px) scale(.98)'
      setTimeout(() => {
        icon.style.display = 'none'
      }, 120)
    }, 200)
  })

  // Click handler for opening panel
  icon.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
    
    if (currentBranchId) {
      console.log('[HoverPlugin] Opening panel for branch:', currentBranchId)
      window.dispatchEvent(new CustomEvent('create-panel', { 
        detail: { panelId: currentBranchId } 
      }))
    }
  })

  return {
    show(x: number, y: number, branchId: string, type: string) {
      console.log('[HoverPlugin IconManager] SHOW called:', {
        x, y, branchId, type,
        overlayExists: !!overlay.parentElement,
        iconExists: !!icon.parentElement
      })
      
      if (hideTimeout) {
        clearTimeout(hideTimeout)
        hideTimeout = null
      }

      currentBranchId = branchId
      currentType = type

      // Position icon above the annotation
      const iconW = 24
      const offset = 24 // Distance above text
      
      icon.style.left = `${x - iconW / 2}px`
      icon.style.top = `${y - offset}px`
      icon.style.display = 'block'
      
      console.log('[HoverPlugin IconManager] Icon positioned:', {
        left: icon.style.left,
        top: icon.style.top,
        display: icon.style.display
      })
      
      // Set data attributes for tooltip
      icon.setAttribute('data-branch-id', branchId)
      icon.setAttribute('data-annotation-type', type)
      
      // Fade in
      requestAnimationFrame(() => {
        icon.style.opacity = '1'
        icon.style.transform = 'translateY(0) scale(1)'
      })
    },

    hide() {
      if (isOverIcon) return // Don't hide if mouse is over icon
      
      hideTimeout = setTimeout(() => {
        icon.style.opacity = '0'
        icon.style.transform = 'translateY(4px) scale(.98)'
        setTimeout(() => {
          icon.style.display = 'none'
        }, 120)
      }, 200)
    },

    destroy() {
      if (hideTimeout) clearTimeout(hideTimeout)
      overlay.remove()
    }
  }
}

/**
 * Create the ProseMirror plugin for annotation hover
 * This follows the pattern recommended in the research
 */
export function AnnotationHoverPlugin(): Plugin {
  let iconManager: HoverIconManager | null = null
  let hoverTimeout: NodeJS.Timeout | null = null
  let lastHoveredAnnotation: HTMLElement | null = null

  return new Plugin({
    key: annotationHoverKey,
    
    state: {
      init(): HoverState {
        return {
          hoveredAnnotation: null,
          hoveredBranchId: null,
          hoveredType: null,
          mouseX: 0,
          mouseY: 0
        }
      },
      
      apply(tr, state: HoverState): HoverState {
        // Check if we have hover metadata
        const meta = tr.getMeta(annotationHoverKey)
        if (meta) {
          return meta
        }
        return state
      }
    },

    view(view: EditorView) {
      // Create icon manager on plugin initialization
      console.log('[HoverPlugin] Initializing plugin view...')
      iconManager = createHoverIconManager()
      console.log('[HoverPlugin] Icon manager created:', !!iconManager)
      
      return {
        update(view: EditorView) {
          // View updates can trigger repositioning if needed
          const state = annotationHoverKey.getState(view.state) as HoverState
          if (state?.hoveredAnnotation && iconManager) {
            // Could reposition here if content changed
          }
        },
        
        destroy() {
          if (iconManager) {
            iconManager.destroy()
            iconManager = null
          }
          if (hoverTimeout) {
            clearTimeout(hoverTimeout)
          }
        }
      }
    },

    props: {
      handleDOMEvents: {
        mouseover(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          if (target.closest('.annotation')) {
            console.log('[HoverPlugin] MOUSEOVER on annotation!')
          }
          return false
        },
        
        mousemove(view: EditorView, event: MouseEvent) {
          // Test if handler is being called
          const target = event.target as HTMLElement
          
          // Log every 100th mousemove to confirm plugin is active
          if (Math.random() < 0.01) {
            console.log('[HoverPlugin] Mousemove handler active, target:', target.tagName, target.className)
          }
          
          // Try multiple ways to detect annotation
          const hasAnnotationClass = target.className && target.className.includes('annotation')
          const closestAnnotation = target.closest('[class*="annotation"]')
          const isSpanWithDataBranch = target.tagName === 'SPAN' && target.hasAttribute('data-branch')
          
          if (hasAnnotationClass || closestAnnotation || isSpanWithDataBranch) {
            console.log('[HoverPlugin] Potential annotation detected:', {
              targetClass: target.className,
              targetTag: target.tagName,
              hasDataBranch: target.hasAttribute('data-branch'),
              dataBranch: target.getAttribute('data-branch'),
              hasFocus: view.hasFocus(),
              iconManager: !!iconManager,
              closestFound: !!closestAnnotation
            })
          }
          
          // Clear any pending hover timeout
          if (hoverTimeout) {
            clearTimeout(hoverTimeout)
            hoverTimeout = null
          }

          // Check if target is an annotation - be more flexible
          const annotation = (
            target.closest('.annotation') || 
            target.closest('[class*="annotation"]') ||
            (target.tagName === 'SPAN' && target.hasAttribute('data-branch') ? target : null)
          ) as HTMLElement
          
          if (annotation) {
            // Only process if it's a different annotation
            if (annotation !== lastHoveredAnnotation) {
              lastHoveredAnnotation = annotation
              
              // Get annotation data
              const branchId = annotation.getAttribute('data-branch') || 
                              annotation.getAttribute('data-branch-id') || ''
              const type = annotation.getAttribute('data-type') || 'note'
              
              console.log('[HoverPlugin] Mouse over NEW annotation:', {
                branchId,
                type,
                mouseX: event.clientX,
                mouseY: event.clientY,
                hasFocus: view.hasFocus(),
                annotation: annotation.outerHTML.substring(0, 100)
              })
              
              // Use small delay to prevent flicker (300ms as per UX guidelines)
              hoverTimeout = setTimeout(() => {
                if (iconManager && annotation === lastHoveredAnnotation) {
                  // Get annotation's bounding rect
                  const rect = annotation.getBoundingClientRect()
                  
                  // Position icon at center top of annotation
                  const centerX = rect.left + rect.width / 2
                  const topY = rect.top
                  
                  iconManager.show(centerX, topY, branchId, type)
                  
                  // Update plugin state
                  const tr = view.state.tr.setMeta(annotationHoverKey, {
                    hoveredAnnotation: annotation,
                    hoveredBranchId: branchId,
                    hoveredType: type,
                    mouseX: event.clientX,
                    mouseY: event.clientY
                  })
                  view.dispatch(tr)
                }
              }, 300)
            }
          } else {
            // Not over annotation anymore
            if (lastHoveredAnnotation) {
              lastHoveredAnnotation = null
              
              if (iconManager) {
                iconManager.hide()
              }
              
              // Clear plugin state
              const tr = view.state.tr.setMeta(annotationHoverKey, {
                hoveredAnnotation: null,
                hoveredBranchId: null,
                hoveredType: null,
                mouseX: event.clientX,
                mouseY: event.clientY
              })
              view.dispatch(tr)
            }
          }
          
          // Don't consume the event
          return false
        },

        mouseleave(view: EditorView, event: MouseEvent) {
          // Hide icon when leaving editor
          if (iconManager) {
            iconManager.hide()
          }
          lastHoveredAnnotation = null
          
          // Clear hover timeout
          if (hoverTimeout) {
            clearTimeout(hoverTimeout)
            hoverTimeout = null
          }
          
          return false
        }
      }
    }
  })
}