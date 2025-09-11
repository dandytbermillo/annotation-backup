/**
 * Overlay-based hover icon for annotations
 * Lives outside editor DOM to prevent cursor interference
 * Handles multi-line annotations with exact line detection
 */

import type { EditorView } from '@tiptap/pm/view'

type HoverIconOpts = {
  view: EditorView
  iconEl?: HTMLElement          // if omitted, we'll create one
  offset?: number               // px above the line
  editingOffset?: number        // px above the line while editing
  hideWhileTyping?: boolean
  annotationSelector?: string   // default: '.annotation'
}

export function attachHoverIcon(opts: HoverIconOpts) {
  const {
    view,
    offset = 24,
    editingOffset = 36,
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
    z-index: 999999;
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

  const onMove = (e: MouseEvent) => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      // Debug logging to understand edit mode issue
      const isEditorFocused = view.hasFocus()
      const targetElement = e.target as HTMLElement
      
      console.log('[HoverIcon] MouseMove Debug:', {
        target: targetElement.tagName,
        targetClass: targetElement.className,
        isEditorFocused,
        isEditMode: isEditing(),
        mouseX: e.clientX,
        mouseY: e.clientY,
        overlayExists: !!overlay,
        iconVisible: icon.style.display,
        targetPath: e.composedPath ? e.composedPath().map((el: any) => el.tagName || el).slice(0, 5) : 'no path'
      })
      
      // Don't hide if we're over the icon itself
      if (e.target === icon || icon.contains(e.target as Node)) {
        return
      }
      
      const anno = getAnnotationEl(e.target)
      console.log('[HoverIcon] Annotation found:', !!anno, anno?.className)
      
      if (!anno) {
        // Only hide if not over icon
        if (!isOverIcon) {
          hide()
        }
        return
      }

      lastAnno = anno

      // Don't reposition if we're hovering over the icon
      if (isOverIcon && icon.style.display === 'block') {
        return
      }
      
      // Get the exact line rect under the mouse
      const lineRect = getLineRectAtY(anno, e.clientY)
      const iconW = icon.offsetWidth || 24
      const currentOffset = isEditing() ? editingOffset : offset

      // Calculate position in viewport coordinates (since overlay is position: fixed)
      const viewportLeft = e.clientX - iconW / 2
      let viewportTop = lineRect.top - currentOffset

      // Clamp to viewport boundaries
      const minLeft = 4
      const maxLeft = document.documentElement.clientWidth - iconW - 4
      const clampedLeft = clamp(viewportLeft, minLeft, maxLeft)
      
      // If too close to top, show below instead
      if (lineRect.top < currentOffset + 6) {
        viewportTop = lineRect.bottom + 8
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
    const currentOffset = isEditing() ? editingOffset : offset
    
    const viewportLeft = rect.left + rect.width / 2 - iconW / 2
    let viewportTop = rect.top - currentOffset
    
    // If too close to top, show below instead
    if (rect.top < currentOffset + 6) {
      viewportTop = rect.bottom + 8
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
    
    // Visual feedback
    icon.style.background = '#f7fafc'
    icon.style.borderColor = '#cbd5e0'
    icon.style.transform = 'translateY(0) scale(1.05)'
  })

  icon.addEventListener('mouseleave', () => {
    isOverIcon = false
    // Reset visual state
    icon.style.background = 'white'
    icon.style.borderColor = 'rgba(0,0,0,.08)'
    icon.style.transform = 'translateY(0) scale(1)'
    
    // Only hide if not over the annotation
    if (!lastAnno) {
      hide()
    }
  })

  // Store reference to document handler for cleanup
  const documentMoveHandler = (e: MouseEvent) => {
    if (view.dom.contains(e.target as Node)) {
      onMove(e)
    }
  }
  
  // Attach event listeners
  console.log('[HoverIcon] Attaching event listeners to document and view.dom')
  
  // Listen on document level to catch all events
  document.addEventListener('mousemove', documentMoveHandler, { passive: true })
  
  // Keep mouseleave on view.dom for when leaving editor
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
      
      document.removeEventListener('mousemove', documentMoveHandler)
      view.dom.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('scroll', onScroll)
      view.dom.removeEventListener('input', onInput)
      
      overlay.remove()
    },
    element: icon,
    overlay: overlay,
  }
}