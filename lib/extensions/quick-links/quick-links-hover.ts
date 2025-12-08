// @ts-nocheck
/**
 * Quick Links Hover Icon Manager
 * Overlay-based hover icon for quick links (following annotation hover pattern)
 * Lives outside editor DOM to prevent cursor interference
 *
 * Based on components/canvas/hover-icon.ts pattern
 */

import type { EditorView } from '@tiptap/pm/view'

export interface QuickLinkHoverData {
  workspaceId: string
  workspaceName: string
  entryId: string
  entryName: string
  dashboardId: string | null
}

export interface QuickLinkHoverOpts {
  /** TipTap editor view */
  view: EditorView
  /** Callback when navigate button is clicked */
  onNavigate?: (data: QuickLinkHoverData) => void
  /** CSS selector for quick link elements */
  linkSelector?: string
  /** Offset above the link in pixels */
  offset?: number
}

export function attachQuickLinkHoverIcon(opts: QuickLinkHoverOpts) {
  const {
    view,
    onNavigate,
    linkSelector = '.quick-link',
    offset = 8,
  } = opts

  // Create overlay root appended to body (not inside editor)
  const overlay = document.createElement('div')
  overlay.className = 'quick-link-hover-overlay'
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

  // Create icon button element
  const icon = document.createElement('button')
  icon.className = 'quick-link-hover-icon'
  icon.setAttribute('aria-label', 'Navigate to workspace')
  icon.setAttribute('type', 'button')

  // External link icon SVG
  icon.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
      <polyline points="15 3 21 3 21 9"></polyline>
      <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>
  `

  icon.style.cssText = `
    position: absolute;
    width: 22px;
    height: 22px;
    padding: 4px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,.25);
    background: #252830;
    border: 1px solid rgba(255,255,255,.15);
    display: none;
    opacity: 0;
    transition: opacity .12s, transform .12s, background .12s;
    transform: translateY(4px) scale(.95);
    pointer-events: auto;
    cursor: pointer;
    color: #a5b4fc;
    z-index: 10003;
  `
  overlay.appendChild(icon)

  let lastLink: HTMLElement | null = null
  let hideTimeout: NodeJS.Timeout | null = null
  let noLinkTimeout: NodeJS.Timeout | null = null
  let isOverIcon = false
  let currentLinkData: QuickLinkHoverData | null = null
  let raf = 0

  const getLinkEl = (t: EventTarget | null): HTMLElement | null => {
    if (!(t instanceof Element)) return null
    return t.closest(linkSelector) as HTMLElement | null
  }

  const show = (left: number, top: number) => {
    if (hideTimeout) {
      clearTimeout(hideTimeout)
      hideTimeout = null
    }

    // Don't reposition if hovering icon
    if (icon.style.display === 'block' && isOverIcon) {
      return
    }

    icon.style.left = `${left}px`
    icon.style.top = `${top}px`
    icon.style.display = 'block'

    // Force reflow
    void icon.offsetHeight

    requestAnimationFrame(() => {
      icon.style.opacity = '1'
      icon.style.transform = 'translateY(0) scale(1)'
    })
  }

  const hide = () => {
    if (isOverIcon) return

    hideTimeout = setTimeout(() => {
      icon.style.opacity = '0'
      icon.style.transform = 'translateY(4px) scale(.95)'
      setTimeout(() => {
        icon.style.display = 'none'
      }, 120)
      lastLink = null
      currentLinkData = null
    }, 150)
  }

  const onMove = (e: MouseEvent) => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      // Don't process if over the icon itself
      if (e.target === icon || icon.contains(e.target as Node)) {
        if (noLinkTimeout) {
          clearTimeout(noLinkTimeout)
          noLinkTimeout = null
        }
        return
      }

      const link = getLinkEl(e.target)

      if (!link) {
        // Add small delay before hiding to prevent premature hiding
        if (!noLinkTimeout && !isOverIcon) {
          noLinkTimeout = setTimeout(() => {
            const currentTarget = document.elementFromPoint(e.clientX, e.clientY)
            const stillHasLink = currentTarget && getLinkEl(currentTarget)
            if (!stillHasLink && !isOverIcon) {
              hide()
            }
            noLinkTimeout = null
          }, 100)
        }
        return
      }

      // Clear timeout if found a link
      if (noLinkTimeout) {
        clearTimeout(noLinkTimeout)
        noLinkTimeout = null
      }

      // Don't reposition for same link
      if (lastLink === link && icon.style.display === 'block') {
        return
      }

      lastLink = link

      // Extract link data from attributes
      currentLinkData = {
        workspaceId: link.getAttribute('data-workspace-id') || '',
        workspaceName: link.getAttribute('data-workspace-name') || link.textContent || '',
        entryId: link.getAttribute('data-entry-id') || '',
        entryName: link.getAttribute('data-entry-name') || '',
        dashboardId: link.getAttribute('data-dashboard-id'),
      }

      // Get link's bounding rect (viewport coordinates for fixed positioning)
      const linkRect = link.getBoundingClientRect()
      const iconW = 22
      const iconH = 22

      // Position at end of link, slightly above (overlapping top)
      let viewportLeft = linkRect.right - iconW - 4
      let viewportTop = linkRect.top - (iconH / 2)

      // Follow mouse position within the link
      const mouseNearLeft = e.clientX < linkRect.left + 50
      const mouseNearRight = e.clientX > linkRect.right - 50

      if (mouseNearLeft) {
        viewportLeft = linkRect.left - 2
      } else if (mouseNearRight) {
        viewportLeft = linkRect.right - iconW + 2
      } else {
        viewportLeft = e.clientX - iconW / 2
      }

      // Clamp to viewport boundaries
      const minLeft = 4
      const maxLeft = document.documentElement.clientWidth - iconW - 4
      viewportLeft = Math.max(minLeft, Math.min(viewportLeft, maxLeft))

      // If too close to top, overlap bottom instead
      if (linkRect.top < iconH / 2) {
        viewportTop = linkRect.bottom - (iconH / 2)
      }

      show(viewportLeft, viewportTop)
    })
  }

  const onLeave = (e: MouseEvent) => {
    // If leaving the editor entirely, hide
    if (!(e.relatedTarget instanceof Node) || !view.dom.contains(e.relatedTarget)) {
      hide()
    }
  }

  const onMouseOver = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    const link = getLinkEl(target)
    if (link && link !== lastLink) {
      // Immediately trigger the icon display on first hover
      onMove(e)
    }
  }

  // Icon hover handlers
  icon.addEventListener('mouseenter', () => {
    isOverIcon = true
    if (hideTimeout) {
      clearTimeout(hideTimeout)
      hideTimeout = null
    }
    icon.style.opacity = '1'
    icon.style.display = 'block'
    icon.style.background = '#323743'
    icon.style.borderColor = 'rgba(165, 180, 252, 0.4)'
    icon.style.transform = 'translateY(0) scale(1.05)'
  })

  icon.addEventListener('mouseleave', () => {
    isOverIcon = false
    icon.style.background = '#252830'
    icon.style.borderColor = 'rgba(255,255,255,.15)'
    icon.style.transform = 'translateY(0) scale(1)'

    if (!lastLink) {
      hide()
    }
  })

  // Click handler - navigate to workspace
  icon.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()

    if (currentLinkData && onNavigate) {
      onNavigate(currentLinkData)
    }
  })

  // Attach event listeners with CAPTURE phase (critical for TipTap/ProseMirror)
  view.dom.addEventListener('mouseover', onMouseOver, true)
  view.dom.addEventListener('mousemove', onMove, true)
  view.dom.addEventListener('mouseleave', onLeave, { passive: true })

  return {
    destroy() {
      cancelAnimationFrame(raf)
      if (hideTimeout) clearTimeout(hideTimeout)
      if (noLinkTimeout) clearTimeout(noLinkTimeout)
      view.dom.removeEventListener('mouseover', onMouseOver, true)
      view.dom.removeEventListener('mousemove', onMove, true)
      view.dom.removeEventListener('mouseleave', onLeave)
      overlay.remove()
    },
    element: icon,
    overlay: overlay,
  }
}
