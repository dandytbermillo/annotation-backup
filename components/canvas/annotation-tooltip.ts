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
    
    // Position and show tooltip - offset more to the right to not cover the icon
    const rect = element.getBoundingClientRect()
    
    // Position tooltip to the right of the icon with more spacing
    let left = rect.right + 15
    let top = rect.top
    
    // Check if tooltip would go off the right edge of the screen
    const tooltipWidth = 300 // approximate width
    if (left + tooltipWidth > window.innerWidth - 10) {
      // Position to the left of the icon instead
      left = rect.left - tooltipWidth - 15
    }
    
    // Check if tooltip would go off the bottom of the screen
    const tooltipHeight = 200 // approximate max height
    if (top + tooltipHeight > window.innerHeight - 10) {
      // Adjust top position
      top = window.innerHeight - tooltipHeight - 10
    }
    
    tooltipElement.style.left = `${left}px`
    tooltipElement.style.top = `${top}px`
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
    
    // Position and show tooltip - offset more to the right to not cover the icon
    const rect = element.getBoundingClientRect()
    
    // Position tooltip to the right of the icon with more spacing
    let left = rect.right + 15
    let top = rect.top
    
    // Check if tooltip would go off the right edge of the screen
    const tooltipWidth = 300 // approximate width
    if (left + tooltipWidth > window.innerWidth - 10) {
      // Position to the left of the icon instead
      left = rect.left - tooltipWidth - 15
    }
    
    // Check if tooltip would go off the bottom of the screen
    const tooltipHeight = 200 // approximate max height
    if (top + tooltipHeight > window.innerHeight - 10) {
      // Adjust top position
      top = window.innerHeight - tooltipHeight - 10
    }
    
    tooltipElement.style.left = `${left}px`
    tooltipElement.style.top = `${top}px`
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