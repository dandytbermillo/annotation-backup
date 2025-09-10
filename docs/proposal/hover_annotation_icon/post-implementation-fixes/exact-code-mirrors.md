# Canonical Code Mirrors (Hover Annotation Icon)

This document mirrors the exact current code from the codebase for the hover icon and tooltip modules. Use this as the source of truth when comparing or reviewing.

Last synced: 2025-09-10

## 1) components/canvas/annotation-decorations-hover-only.ts

```typescript
import { Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { 
  initializeTooltip, 
  showAnnotationTooltip, 
  hideAnnotationTooltip, 
  hideAnnotationTooltipSoon,
  cleanupTooltip 
} from './annotation-tooltip'

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

      // Initialize tooltip on startup
      initializeTooltip()
      
      // Click handler for hover icon
      hoverIcon.addEventListener('click', (e) => {
        e.stopPropagation()
        const branchId = hoverIcon!.getAttribute('data-branch-id')
        if (branchId) {
          // Open panel
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
        
        // Show the original tooltip using the shared function
        const branchId = hoverIcon!.getAttribute('data-branch-id')
        const type = hoverIcon!.getAttribute('data-annotation-type') || 'note'
        if (branchId) {
          showAnnotationTooltip(branchId, type, hoverIcon!)
        }
      })

      hoverIcon.addEventListener('mouseleave', () => {
        hoverIcon!.style.background = 'white'
        hoverIcon!.style.borderColor = '#e2e8f0'
        hoverIcon!.style.transform = 'scale(1)'
        
        // Hide tooltip
        hideAnnotationTooltipSoon()
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
          
          // Clean up tooltip
          cleanupTooltip()
        }
      }
    }
  })
}
```

## 2) components/canvas/annotation-tooltip.ts

```typescript
/**
 * Shared tooltip functionality extracted from the ORIGINAL AnnotationDecorations
 * This is the exact working tooltip from the backup repository
 */

let tooltipElement: HTMLElement | null = null
let tooltipHideTimeout: NodeJS.Timeout | null = null
let isOverTooltip = false

// Initialize tooltip element
export function initializeTooltip() {
  if (!tooltipElement) {
    tooltipElement = document.createElement('div')
    tooltipElement.className = 'annotation-tooltip'
    document.body.appendChild(tooltipElement)
    
    // Add event listeners to tooltip
    tooltipElement.addEventListener('mouseenter', () => {
      isOverTooltip = true
      if (tooltipHideTimeout) {
        clearTimeout(tooltipHideTimeout)
        tooltipHideTimeout = null
      }
    })
    
    tooltipElement.addEventListener('mouseleave', () => {
      isOverTooltip = false
      hideAnnotationTooltipSoon()
    })
  }
  
  return tooltipElement
}

// Helper function to get type icon
function getTypeIcon(type: string) {
  switch(type) {
    case 'note': return '📝'
    case 'explore': return '🔍'
    case 'promote': return '⭐'
    default: return '📝'
  }
}

// Helper function to extract text from ProseMirror JSON
function extractTextFromProseMirrorJSON(doc: any): string {
  let text = ''
  if (doc.content && Array.isArray(doc.content)) {
    doc.content.forEach((node: any) => {
      if (node.type === 'text') {
        text += node.text || ''
      } else if (node.content) {
        text += extractTextFromProseMirrorJSON(node)
      }
    })
  }
  return text.trim()
}

// Helper function to check if tooltip is scrollable
function checkTooltipScrollable() {
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

// Show annotation tooltip with branch content - EXACT COPY FROM ORIGINAL
export async function showAnnotationTooltip(branchId: string, type: string, element: HTMLElement) {
  console.log('[showAnnotationTooltip] Called with:', { branchId, type })
  
  // Normalize IDs: UI uses 'branch-<uuid>', DB uses raw '<uuid>'
  const uiId = branchId // This is what comes from the UI (e.g., 'branch-04742759...')
  const dbId = branchId.replace(/^branch-/, '') // Strip prefix for DB lookups
  
  console.log('[showAnnotationTooltip] ID normalization:', { 
    original: branchId, 
    uiId, 
    dbId,
    hasPrefix: branchId.startsWith('branch-')
  })
  
  // Clear any existing timeout
  if (tooltipHideTimeout) {
    clearTimeout(tooltipHideTimeout)
    tooltipHideTimeout = null
  }
  
  // Create or update tooltip
  if (!tooltipElement) {
    tooltipElement = initializeTooltip()
  }
  
  // Add branch ID for async guard
  tooltipElement.dataset.branchId = uiId
  
  // For plain mode, we skip providers and go straight to API
  // Extract noteId from the current page/context
  const noteIdFromPath = window.location.pathname.match(/note\/([^/]+)/)?.[1]
  const noteIdFromAttr = document.querySelector('[data-note-id]')?.getAttribute('data-note-id') ||
                         document.querySelector('[data-note]')?.getAttribute('data-note')
  const noteId = noteIdFromPath || noteIdFromAttr
  
  if (noteId && dbId && !dbId.startsWith('temp-')) {
    console.log('[showAnnotationTooltip] Fetching branches for noteId:', noteId)
    
    // Show loading state immediately
    tooltipElement.innerHTML = `
      <div class="tooltip-header">
        <span class="tooltip-icon">${getTypeIcon(type)}</span>
        <span class="tooltip-title">Loading...</span>
      </div>
      <div class="tooltip-content">Loading branch content...</div>
      <div class="tooltip-footer">Click icon to open panel</div>
    `
    
    // Position and show tooltip
    const rect = element.getBoundingClientRect()
    tooltipElement.style.left = `${rect.right + 10}px`
    tooltipElement.style.top = `${rect.top}px`
    tooltipElement.classList.add('visible')
    
    // First fetch branch metadata (API uses raw UUID)
    try {
      const branchesRes = await fetch(`/api/postgres-offline/branches?noteId=${noteId}`)
      const branches = await branchesRes.json()
      
      console.log('[showAnnotationTooltip] Branches from API:', branches)
      console.log('[showAnnotationTooltip] Looking for branch with id:', dbId)
      
      const branch = branches.find((b: any) => b.id === dbId) // Compare with DB format
      
      if (branch) {
        console.log('[showAnnotationTooltip] Found branch:', branch)
        
        // Now fetch the actual document content for this branch
        // Use UI format for panel ID (already has branch- prefix)
        const docUrl = `/api/postgres-offline/documents/${noteId}/${uiId}`
        console.log('[showAnnotationTooltip] Fetching document from:', docUrl)
        
        try {
          const docRes = await fetch(docUrl)
          const doc = await docRes.json()
          
          console.log('[showAnnotationTooltip] Document fetched:', doc)
          
          // Only update if tooltip is still visible
          if (tooltipElement && tooltipElement.classList.contains('visible')) {
            // Extract text content
            let content = ''
            if (doc && doc.content) {
              // If content is HTML, strip tags
              if (typeof doc.content === 'string') {
                content = doc.content.replace(/<[^>]*>/g, '').trim()
              } else if (doc.content.content) {
                // If it's ProseMirror JSON, extract text
                content = extractTextFromProseMirrorJSON(doc.content)
              }
            }
            console.log('[showAnnotationTooltip] Extracted content:', content)
            
            // Use doc content if available; do NOT fall back to original annotated text
            const preview = content || 'No notes added yet'
            
            tooltipElement.innerHTML = `
              <div class="tooltip-header">
                <span class="tooltip-icon">${getTypeIcon(branch.type || type)}</span>
                <span class="tooltip-title">${branch.title || `${(branch.type || type).charAt(0).toUpperCase() + (branch.type || type).slice(1)} annotation`}</span>
              </div>
              <div class="tooltip-content">${preview}</div>
              <div class="tooltip-footer">Click to open panel</div>
            `
            checkTooltipScrollable()
          }
        } catch (docErr) {
          console.error('[showAnnotationTooltip] Document fetch error:', docErr)
          // If document fetch fails, show placeholder
          if (tooltipElement && tooltipElement.classList.contains('visible')) {
            tooltipElement.innerHTML = `
              <div class="tooltip-header">
                <span class="tooltip-icon">${getTypeIcon(branch.type || type)}</span>
                <span class="tooltip-title">${branch.title || `${(branch.type || type).charAt(0).toUpperCase() + (branch.type || type).slice(1)} annotation`}</span>
              </div>
              <div class="tooltip-content">No notes added yet</div>
              <div class="tooltip-footer">Click to open panel</div>
            `
            checkTooltipScrollable()
          }
        }
      } else {
        console.log('[showAnnotationTooltip] Branch not found in API response')
        console.log('[showAnnotationTooltip] Available branch IDs:', branches.map((b: any) => b.id))
        
        // Show empty state
        if (tooltipElement && tooltipElement.classList.contains('visible')) {
          tooltipElement.innerHTML = `
            <div class="tooltip-header">
              <span class="tooltip-icon">${getTypeIcon(type)}</span>
              <span class="tooltip-title">${type.charAt(0).toUpperCase() + type.slice(1)} annotation</span>
            </div>
            <div class="tooltip-content">No notes added yet</div>
            <div class="tooltip-footer">Click to open panel</div>
          `
          checkTooltipScrollable()
        }
      }
    } catch (err) {
      console.error('[showAnnotationTooltip] API fetch error:', err)
      // Show error state
      if (tooltipElement && tooltipElement.classList.contains('visible')) {
        tooltipElement.innerHTML = `
          <div class="tooltip-header">
            <span class="tooltip-icon">${getTypeIcon(type)}</span>
            <span class="tooltip-title">${type.charAt(0).toUpperCase() + type.slice(1)} annotation</span>
          </div>
          <div class="tooltip-content">Error loading content</div>
          <div class="tooltip-footer">Click to open panel</div>
        `
      }
    }
  } else if (dbId.startsWith('temp-')) {
    // Temporary branch, no data available yet
    console.log('[showAnnotationTooltip] Temporary branch, no data available yet')
    return
  } else {
    // No noteId available, show empty state
    tooltipElement.innerHTML = `
      <div class="tooltip-header">
        <span class="tooltip-icon">${getTypeIcon(type)}</span>
        <span class="tooltip-title">${type.charAt(0).toUpperCase() + type.slice(1)} annotation</span>
      </div>
      <div class="tooltip-content">Click to open panel</div>
      <div class="tooltip-footer">Click icon to open panel</div>
    `
    
    // Position and show tooltip
    const rect = element.getBoundingClientRect()
    tooltipElement.style.left = `${rect.right + 10}px`
    tooltipElement.style.top = `${rect.top}px`
    tooltipElement.classList.add('visible')
    checkTooltipScrollable()
  }
}

// Hide annotation tooltip with delay
export function hideAnnotationTooltipSoon() {
  tooltipHideTimeout = setTimeout(() => {
    if (!isOverTooltip && tooltipElement) {
      tooltipElement.classList.remove('visible')
    }
  }, 300)
}

// Hide annotation tooltip immediately
export function hideAnnotationTooltip() {
  if (tooltipHideTimeout) {
    clearTimeout(tooltipHideTimeout)
    tooltipHideTimeout = null
  }
  
  if (tooltipElement) {
    tooltipElement.classList.remove('visible')
  }
}

// Cleanup function
export function cleanupTooltip() {
  if (tooltipHideTimeout) {
    clearTimeout(tooltipHideTimeout)
    tooltipHideTimeout = null
  }
  
  if (tooltipElement && tooltipElement.parentNode) {
    tooltipElement.parentNode.removeChild(tooltipElement)
    tooltipElement = null
  }
}
```

## 3) components/canvas/webkit-annotation-cursor-fix.ts

```typescript
import { Plugin, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

/**
 * WebKit Annotation Cursor Fix
 * 
 * Manually places cursor when clicking on annotations in Safari/Chrome
 * since these browsers have issues with cursor placement on styled inline elements
 */
export const WebKitAnnotationCursorFix = () => {
  console.log('[WebKitAnnotationCursorFix] Plugin function called')
  
  // Detect if we're in a WebKit browser (Safari or Chrome)
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isChrome = /chrome/i.test(userAgent)
  const isSafari = /safari/i.test(userAgent) && !isChrome
  const isFirefox = /firefox/i.test(userAgent)
  
  console.log('[WebKitAnnotationCursorFix] Browser detection:', {
    userAgent,
    isChrome,
    isSafari,
    isFirefox
  })
  
  // For now, apply to all browsers for testing
  console.log('[WebKitAnnotationCursorFix] Creating plugin for cursor fix')

  const plugin = new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          
          console.log('[WebKitAnnotationCursorFix] 🖱️ ANY Mousedown event detected')
          
          // Try to find annotation with different selectors
          const hasAnnotationClass = target.classList.contains('annotation')
          const closestAnnotation = target.closest('.annotation')
          const closestSpanAnnotation = target.closest('span.annotation')
          const parentElement = target.parentElement
          
          console.log('[WebKitAnnotationCursorFix] Mousedown details:', {
            target: target.tagName,
            classList: target.classList.toString(),
            hasAnnotationClass,
            closestAnnotation: (closestAnnotation as any)?.tagName,
            closestSpanAnnotation: (closestSpanAnnotation as any)?.tagName,
            parentTag: parentElement?.tagName,
            parentClasses: parentElement?.className,
            textContent: target.textContent?.substring(0, 50)
          })
          
          // Check if we clicked on an annotation
          if (!hasAnnotationClass && !closestAnnotation) {
            console.log('[WebKitAnnotationCursorFix] Not an annotation click, skipping')
            return false // Let normal handling continue
          }

          // Get the annotation element
          const annotationEl = target.classList.contains('annotation') 
            ? target 
            : (target.closest('.annotation') as HTMLElement)

          if (!annotationEl) {
            console.log('[WebKitAnnotationCursorFix] Could not find annotation element')
            return false
          }

          console.log('[WebKitAnnotationCursorFix] Found annotation:', {
            text: annotationEl.textContent,
            branchId: annotationEl.getAttribute('data-branch'),
            type: annotationEl.getAttribute('data-type')
          })

          // Find the position in the document
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
          
          if (!pos) {
            console.log('[WebKitAnnotationCursorFix] Could not find position at coordinates')
            return false
          }

          console.log('[WebKitAnnotationCursorFix] Document position:', pos.pos)

          // Create a text selection at that position
          const selection = TextSelection.create(view.state.doc, pos.pos)
          
          // Apply the selection
          const tr = view.state.tr.setSelection(selection)
          view.dispatch(tr)
          
          // Focus the editor
          view.focus()
          
          // Prevent default only for WebKit browsers on annotations (currently applied globally)
          event.preventDefault()
          
          console.log('[WebKitAnnotationCursorFix] ✅ Successfully placed cursor at position:', pos.pos)
          
          return true // We handled it
        }
      }
    }
  })
  
  console.log('[WebKitAnnotationCursorFix] Plugin created:', plugin)
  return plugin
}
```

