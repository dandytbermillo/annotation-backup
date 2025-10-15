// @ts-nocheck
/**
 * Overlay-based hover icon for annotations
 * Lives outside editor DOM to prevent cursor interference
 * Handles multi-line annotations with exact line detection
 */

import type { EditorView } from '@tiptap/pm/view'

type HoverIconOpts = {
  view: EditorView
  iconEl?: HTMLElement          // if omitted, we'll create one
  offset?: number               // px above the line (reduced for closer positioning)
  editingOffset?: number        // px above the line while editing
  hideWhileTyping?: boolean
  annotationSelector?: string   // default: '.annotation'
}

export function attachHoverIcon(opts: HoverIconOpts) {
  const {
    view,
    offset = 8,              // Much closer to text (was 24)
    editingOffset = 12,      // Closer in edit mode too (was 36)
    hideWhileTyping = true,
    annotationSelector = '.annotation',
  } = opts
  
  // Initialization complete

  // Overlay root appended to <body>, not inside the editor
  const overlay = document.createElement('div')
  overlay.className = 'annotation-hover-overlay'
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 10002;
    pointer-events: none;
    overflow: visible;
  `
  document.body.appendChild(overlay)
  
  console.log('[HoverIcon] Overlay created and attached:', {
    parent: overlay.parentElement?.tagName,
    zIndex: overlay.style.zIndex,
    pointerEvents: overlay.style.pointerEvents,
    position: overlay.style.position
  })

  // Create or use provided icon element
  const icon = opts.iconEl ?? document.createElement('button')
  if (!opts.iconEl) {
    icon.className = 'annotation-hover-icon-overlay'
    icon.setAttribute('aria-label', 'Annotation actions')
    
    // Square icon SVG
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
      pointer-events: auto; /* the only interactive thing in the overlay */
      cursor: pointer;
      z-index: 10003; /* Higher than tooltip to ensure it stays on top */
    `
    overlay.appendChild(icon)
  }

  let raf = 0
  let lastAnno: HTMLElement | null = null
  let typingFadeTO: number | null = null
  let isOverIcon = false
  let hideTimeout: NodeJS.Timeout | null = null

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

  const getAnnotationEl = (t: EventTarget | null): HTMLElement | null => {
    if (!(t instanceof Element)) return null
    return t.closest(annotationSelector) as HTMLElement | null
  }

  // Pick the client-rect (line box) under the mouse for multi-line spans
  const getLineRectAtY = (el: HTMLElement, clientY: number): DOMRect => {
    const rects = Array.from(el.getClientRects())
    if (!rects.length) return el.getBoundingClientRect()
    
    // Find the rect that contains the Y coordinate
    const hit = rects.find(r => clientY >= r.top && clientY <= r.bottom)
    if (hit) return hit
    
    // If between lines, find nearest
    return rects.reduce((best, r) => {
      const d = Math.abs(clientY - (r.top + r.bottom) / 2)
      const bd = Math.abs(clientY - (best.top + best.bottom) / 2)
      return d < bd ? r : best
    }, rects[0])
  }

  const isEditing = () =>
    view.hasFocus()

  const show = (left: number, top: number) => {
    if (hideTimeout) {
      clearTimeout(hideTimeout)
      hideTimeout = null
    }
    
    // If icon is already visible and we're hovering it, don't reposition
    if (icon.style.display === 'block' && isOverIcon) {
      return
    }
    
    icon.style.left = `${left}px`
    icon.style.top = `${top}px`
    
    // Always ensure the icon is visible
    icon.style.display = 'block'
    
    // Force a reflow to ensure the display change is applied
    void icon.offsetHeight
    
    // Then apply the fade-in animation
    requestAnimationFrame(() => {
      icon.style.opacity = '1'
      icon.style.transform = 'translateY(0) scale(1)'
    })
  }

  const hide = () => {
    if (isOverIcon) return // Don't hide if mouse is over icon
    
    hideTimeout = setTimeout(() => {
      icon.style.opacity = '0'
      icon.style.transform = 'translateY(4px) scale(.98)'
      setTimeout(() => {
        icon.style.display = 'none'
      }, 120)
      lastAnno = null
    }, 200) // Small delay to prevent flicker
  }

  let noAnnotationTimeout: NodeJS.Timeout | null = null
  
  const onMove = (e: MouseEvent) => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      // Don't hide if we're over the icon itself
      if (e.target === icon || icon.contains(e.target as Node)) {
        if (noAnnotationTimeout) {
          clearTimeout(noAnnotationTimeout)
          noAnnotationTimeout = null
        }
        return
      }
      
      const anno = getAnnotationEl(e.target)
      
      if (!anno) {
        // Add a small delay before hiding to prevent premature hiding
        // This fixes the issue where icon disappears immediately on first hover
        if (!noAnnotationTimeout && !isOverIcon) {
          noAnnotationTimeout = setTimeout(() => {
            // Double-check we're still not over an annotation
            const currentTarget = document.elementFromPoint(e.clientX, e.clientY)
            const stillHasAnnotation = currentTarget && getAnnotationEl(currentTarget)
            if (!stillHasAnnotation && !isOverIcon) {
              hide()
            }
            noAnnotationTimeout = null
          }, 100) // Small delay to confirm we've really left the annotation
        }
        return
      }
      
      // Clear the timeout if we found an annotation
      if (noAnnotationTimeout) {
        clearTimeout(noAnnotationTimeout)
        noAnnotationTimeout = null
      }

      // Check if it's the same annotation - don't reposition if so
      if (lastAnno === anno && icon.style.display === 'block') {
        // Same annotation and icon already visible, don't reposition
        return
      }
      
      lastAnno = anno
      
      // Get the annotation's bounding rect
      const annoRect = anno.getBoundingClientRect()
      const iconW = icon.offsetWidth || 24
      const iconH = icon.offsetHeight || 24
      const currentOffset = isEditing() ? editingOffset : offset

      // Position icon at the END of the annotation, slightly overlapping the top
      // This keeps it close to the text so mouse can easily reach it
      let viewportLeft = annoRect.right - iconW - 4  // Near the right edge of annotation
      let viewportTop = annoRect.top - (iconH / 2)   // Overlapping the top of the text
      
      // Alternative: position near mouse but at the edge of text
      // This follows the mouse but stays attached to the annotation
      const mouseNearLeft = e.clientX < annoRect.left + 50
      const mouseNearRight = e.clientX > annoRect.right - 50
      
      if (mouseNearLeft) {
        viewportLeft = annoRect.left - 2  // Show at start if mouse near start
      } else if (mouseNearRight) {
        viewportLeft = annoRect.right - iconW + 2  // Show at end if mouse near end
      } else {
        viewportLeft = e.clientX - iconW / 2  // Follow mouse in the middle
      }

      // Clamp to viewport boundaries
      const minLeft = 4
      const maxLeft = document.documentElement.clientWidth - iconW - 4
      const clampedLeft = clamp(viewportLeft, minLeft, maxLeft)
      
      // If too close to top, overlap bottom instead
      if (annoRect.top < iconH / 2) {
        viewportTop = annoRect.bottom - (iconH / 2)
      }
      
      show(clampedLeft, viewportTop)

      // Store annotation data for tooltip
      const branchId = anno.getAttribute('data-branch') || 
                      anno.getAttribute('data-branch-id') || ''
      const annotationType = anno.getAttribute('data-type') || 'note'
      
      icon.setAttribute('data-branch-id', branchId)
      icon.setAttribute('data-annotation-type', annotationType)
    })
  }

  const onLeave = (e: MouseEvent) => {
    // If leaving the editor entirely, hide
    if (!(e.relatedTarget instanceof Node) || !view.dom.contains(e.relatedTarget)) {
      hide()
    }
  }

  const onScroll = () => {
    // Reposition against last known annotation if icon is visible
    if (!lastAnno || icon.style.display !== 'block') return
    
    // Recalculate position based on new scroll position
    const rect = lastAnno.getBoundingClientRect()
    const iconW = icon.offsetWidth || 24
    const iconH = icon.offsetHeight || 24
    
    // Keep icon at the end of annotation, overlapping top
    const viewportLeft = rect.right - iconW - 4
    let viewportTop = rect.top - (iconH / 2)
    
    // If too close to top, overlap bottom instead
    if (rect.top < iconH / 2) {
      viewportTop = rect.bottom - (iconH / 2)
    }
    
    show(viewportLeft, viewportTop)
  }

  const onInput = () => {
    if (!hideWhileTyping) return
    
    // Don't fade if hovering over the icon
    if (isOverIcon) return
    
    // Fade icon during typing
    if (icon.style.display === 'block') {
      icon.style.opacity = '0.35'
    }
    
    if (typingFadeTO) clearTimeout(typingFadeTO)
    typingFadeTO = window.setTimeout(() => {
      if (icon.style.display === 'block' && !isOverIcon) {
        icon.style.opacity = '1'
      }
    }, 250)
  }

  // Icon hover handlers
  icon.addEventListener('mouseenter', () => {
    isOverIcon = true
    if (hideTimeout) {
      clearTimeout(hideTimeout)
      hideTimeout = null
    }
    
    // Ensure icon is fully visible when hovering (even in edit mode)
    icon.style.opacity = '1'
    icon.style.display = 'block' // Ensure it stays visible
    
    // Visual feedback
    icon.style.background = '#f7fafc'
    icon.style.borderColor = '#cbd5e0'
    icon.style.transform = 'translateY(0) scale(1.05)'
  })

  icon.addEventListener('mouseleave', (e) => {
    isOverIcon = false
    // Reset visual state
    icon.style.background = 'white'
    icon.style.borderColor = 'rgba(0,0,0,.08)'
    icon.style.transform = 'translateY(0) scale(1)'
    
    // Check if we're moving to the tooltip
    const relatedTarget = e.relatedTarget as HTMLElement
    const isGoingToTooltip = relatedTarget && relatedTarget.closest('.annotation-tooltip')
    
    // Only hide if not over the annotation and not going to tooltip
    if (!lastAnno && !isGoingToTooltip) {
      hide()
    }
  })

  // Add mouseover for initial detection (faster than waiting for mousemove)
  const onMouseOver = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    const anno = getAnnotationEl(target)
    if (anno && anno !== lastAnno) {
      // Immediately trigger the icon display on first hover
      onMove(e)
    }
  }
  
  // Attach event listeners with CAPTURE phase for edit mode reliability
  console.log('[HoverIcon] Attaching event listeners with capture phase')
  
  // Use capture phase (third parameter = true) to get events BEFORE editor processing
  // This is critical for edit mode where TipTap might consume events
  view.dom.addEventListener('mouseover', onMouseOver, true) // Detect initial hover
  view.dom.addEventListener('mousemove', onMove, true) // true = capture phase
  view.dom.addEventListener('mouseleave', onLeave, { passive: true })
  window.addEventListener('scroll', onScroll, { passive: true })
  view.dom.addEventListener('input', onInput)

  // Accessibility: respect reduced motion preference
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (mediaQuery.matches) {
    icon.style.transition = 'none'
  }

  // Public API
  return {
    destroy() {
      cancelAnimationFrame(raf)
      if (hideTimeout) clearTimeout(hideTimeout)
      if (typingFadeTO) clearTimeout(typingFadeTO)
      if (noAnnotationTimeout) clearTimeout(noAnnotationTimeout)
      
      view.dom.removeEventListener('mouseover', onMouseOver, true)
      view.dom.removeEventListener('mousemove', onMove, true) // Remove capture phase listener
      view.dom.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('scroll', onScroll)
      view.dom.removeEventListener('input', onInput)
      
      overlay.remove()
    },
    element: icon,
    overlay: overlay,
  }
}
