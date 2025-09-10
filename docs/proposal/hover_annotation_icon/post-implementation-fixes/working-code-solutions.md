# Working Code Solutions - Complete Implementation

Note: For canonical, exact code mirrors synced with the codebase, see:
- post-implementation-fixes/exact-code-mirrors.md

## 1. Square Hover Icon (annotation-decorations-hover-only.ts)

This plugin shows the square icon without interfering with cursor placement:

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

      // Initialize tooltip on startup
      initializeTooltip()
      
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
          // Open panel
          window.dispatchEvent(new CustomEvent('create-panel', { 
            detail: { panelId: branchId } 
          }))
        }
      })

      // Hover effects for the icon - THIS IS WHERE TOOLTIP CONNECTS
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

## 2. Working Tooltip with Branch Data (annotation-tooltip.ts)

This is the exact tooltip implementation that fetches and displays branch data correctly:

```typescript
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

// Show annotation tooltip with branch content - THE KEY FUNCTION
export async function showAnnotationTooltip(branchId: string, type: string, element: HTMLElement) {
  console.log('[showAnnotationTooltip] Called with:', { branchId, type })
  
  // Normalize IDs: UI uses 'branch-<uuid>', DB uses raw '<uuid>'
  const uiId = branchId // This is what comes from the UI (e.g., 'branch-04742759...')
  const dbId = branchId.replace(/^branch-/, '') // Strip prefix for DB lookups
  
  // Clear any existing timeout
  if (tooltipHideTimeout) {
    clearTimeout(tooltipHideTimeout)
    tooltipHideTimeout = null
  }
  
  // Create or update tooltip
  if (!tooltipElement) {
    tooltipElement = initializeTooltip()
  }
  
  // Extract noteId from the current page/context
  const noteIdFromPath = window.location.pathname.match(/note\/([^/]+)/)?.[1]
  const noteIdFromAttr = document.querySelector('[data-note-id]')?.getAttribute('data-note-id')
  const noteId = noteIdFromPath || noteIdFromAttr
  
  if (noteId && dbId && !dbId.startsWith('temp-')) {
    // Show loading state immediately
    tooltipElement.innerHTML = `
      <div class="tooltip-header">
        <span class="tooltip-icon">${type === 'explore' ? '🔍' : type === 'promote' ? '⭐' : '📝'}</span>
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
    
    try {
      // STEP 1: Fetch branch metadata (API uses raw UUID)
      const branchesRes = await fetch(`/api/postgres-offline/branches?noteId=${noteId}`)
      const branches = await branchesRes.json()
      
      console.log('[showAnnotationTooltip] Looking for branch with id:', dbId)
      const branch = branches.find((b: any) => b.id === dbId)
      
      if (branch) {
        // STEP 2: Fetch the actual document content for this branch
        const docUrl = `/api/postgres-offline/documents/${noteId}/${uiId}`
        console.log('[showAnnotationTooltip] Fetching document from:', docUrl)
        
        try {
          const docRes = await fetch(docUrl)
          const doc = await docRes.json()
          
          // Extract text content
          let content = ''
          if (doc && doc.content) {
            if (typeof doc.content === 'string') {
              // HTML content - strip tags
              content = doc.content.replace(/<[^>]*>/g, '').trim()
            } else if (doc.content.content) {
              // ProseMirror JSON - extract text
              content = extractTextFromProseMirrorJSON(doc.content)
            }
          }
          
          const preview = content || 'No notes added yet'
          const title = branch.title || `${(branch.type || type).charAt(0).toUpperCase() + (branch.type || type).slice(1)} annotation`
          
          // Update tooltip with actual content
          tooltipElement.innerHTML = `
            <div class="tooltip-header">
              <span class="tooltip-icon">${branch.type === 'explore' ? '🔍' : branch.type === 'promote' ? '⭐' : '📝'}</span>
              <span class="tooltip-title">${title}</span>
            </div>
            <div class="tooltip-content">${preview}</div>
            <div class="tooltip-footer">Click to open panel</div>
          `
          checkTooltipScrollable() // Enable scrollbar if needed
          
        } catch (docErr) {
          // Document fetch failed - show empty state
          tooltipElement.innerHTML = `
            <div class="tooltip-header">
              <span class="tooltip-icon">${type === 'explore' ? '🔍' : type === 'promote' ? '⭐' : '📝'}</span>
              <span class="tooltip-title">${branch.title || `${type.charAt(0).toUpperCase() + type.slice(1)} annotation`}</span>
            </div>
            <div class="tooltip-content">No notes added yet</div>
            <div class="tooltip-footer">Click to open panel</div>
          `
          checkTooltipScrollable()
        }
      }
    } catch (err) {
      console.error('[showAnnotationTooltip] API fetch error:', err)
    }
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
```

## 3. WebKit Cursor Fix (webkit-annotation-cursor-fix.ts)

This plugin fixes the cursor placement issue in Safari/Chrome:

```typescript
import { Plugin } from 'prosemirror-state'
import { TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

export const WebKitAnnotationCursorFix = () => {
  // Detect WebKit browsers
  const userAgent = navigator.userAgent.toLowerCase()
  const isChrome = /chrome/i.test(userAgent)
  const isSafari = /safari/i.test(userAgent) && !isChrome
  const isWebKit = isSafari || isChrome
  
  // Only apply fix for WebKit browsers
  if (!isWebKit) {
    return new Plugin({})
  }
  
  console.log('[WebKitAnnotationCursorFix] Activated for WebKit browser')
  
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          
          // Check if clicking on an annotation
          const annotation = target.classList.contains('annotation') 
            ? target 
            : target.closest('.annotation') as HTMLElement
          
          if (annotation) {
            console.log('[WebKitAnnotationCursorFix] Annotation clicked, manually placing cursor')
            
            // Get the position in the document
            const pos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY
            })
            
            if (pos) {
              // Manually set the selection/cursor
              const tr = view.state.tr
              const selection = TextSelection.create(view.state.doc, pos.pos)
              view.dispatch(tr.setSelection(selection))
              
              // Focus the editor
              view.focus()
              
              // Allow default behavior to continue
              return false
            }
          }
          
          return false // Let other handlers process
        }
      }
    }
  })
}
```

## 4. CSS Fixes in tiptap-editor-plain.tsx

Removed problematic CSS that was causing the Safari cursor bug:

```css
/* BEFORE - Problematic CSS */
.tiptap-editor .annotation {
  position: relative;  /* CAUSES SAFARI CURSOR BUG */
  display: inline-block;
  padding: 2px 4px;
  border-radius: 4px;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;
  cursor: text;
  transform: translateY(-1px);  /* CREATES STACKING CONTEXT */
  z-index: 1;  /* AFFECTS CURSOR VISIBILITY */
}

/* AFTER - Fixed CSS */
.tiptap-editor .annotation {
  /* position: relative; REMOVED - causes Safari cursor bug */
  display: inline-block;
  padding: 2px 4px;
  border-radius: 4px;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;
  cursor: text;
  /* transform and z-index REMOVED */
}
```

## 5. Plugin Registration Order (Critical!)

In tiptap-editor-plain.tsx, the order matters:

```typescript
// WebKit-specific fix FIRST to handle clicks before other plugins
editor.registerPlugin(WebKitAnnotationCursorFix())

// Then register hover UI that doesn't block clicks
editor.registerPlugin(AnnotationDecorationsHoverOnly())
```

## Key Success Factors

1. **Square Icon SVG**: Simple rect element that's clearly visible
2. **No Click Blocking**: Removed mousedown/mouseup handlers
3. **Two-Step API Flow**: Fetch branches first, then documents
4. **ID Normalization**: Handle branch- prefix correctly
5. **CSS Simplification**: Remove position: relative and transforms
6. **Plugin Order**: Cursor fix before UI plugins
