import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { UnifiedProvider } from '@/lib/provider-switcher'
import { trackTooltipShown } from './performance-decorations'
import { getPlainProvider } from '@/lib/provider-switcher'

export const annotationDecorationsKey = new PluginKey('annotationDecorations')

interface HoverState {
  pos: number
  node: any
  branchId: string
}

// Hover icon state management
let hoverIcon: HTMLDivElement | null = null
let isOverIcon = false
let isOverTarget = false
let isOverTooltip = false
let hoverIconHideTimeout: NodeJS.Timeout | null = null
let tooltipHideTimeout: NodeJS.Timeout | null = null

export const AnnotationDecorations = () => {
  return new Plugin({
    key: annotationDecorationsKey,
    
    view(editorView) {
      
      // Tooltip element management
      let tooltipElement: HTMLDivElement | null = null
      let tooltipTimeout: NodeJS.Timeout | null = null
      
      // Tooltip functions (moved inside view scope)
      function showAnnotationTooltip(element: HTMLElement, branchId: string, type: string) {
        
        // Check if branchId is valid
        if (!branchId || branchId === '') {
          console.error('[showAnnotationTooltip] ERROR: No branchId provided!')
          return
        }
        
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
        if (tooltipTimeout) {
          clearTimeout(tooltipTimeout)
        }
        
        // Create or update tooltip
        if (!tooltipElement) {
          tooltipElement = document.createElement('div')
          tooltipElement.className = 'annotation-tooltip'
          document.body.appendChild(tooltipElement)
          
          // Add event listeners to tooltip
          tooltipElement.addEventListener('mouseenter', () => {
            isOverTooltip = true
          })
          
          tooltipElement.addEventListener('mouseleave', () => {
            isOverTooltip = false
            hideAnnotationTooltipSoon()
          })
        }
        
        // Add branch ID for async guard
        tooltipElement.dataset.branchId = uiId
        
        // Get branch data - try both providers
        let branchData = null
        
        // Try collaboration provider first (has getBranchesMap)
        // Yjs uses the UI format (branch-<uuid>)
        try {
          const provider = UnifiedProvider.getInstance()
          if (provider && provider.getBranchesMap) {
            const branchesMap = provider.getBranchesMap()
            branchData = branchesMap.get(uiId) // Use UI format for Yjs
          }
        } catch (e) {
          // CollaborationProvider not available
        }
        
        // Fall back to plain provider (has getBranch)
        // Plain provider uses raw UUID format
        if (!branchData) {
          const plainProvider = getPlainProvider()
          if (plainProvider && plainProvider.getBranch) {
            branchData = plainProvider.getBranch(dbId) // Use DB format for plain provider
          }
        }
        
        // Don't create fake branch data from DOM text - that's not the branch content!
        // Branch content is what the user writes IN the annotation panel, not the selected text
        
        // If still no data, fetch from API and also fetch the document content
        if (!branchData && dbId && !dbId.startsWith('temp-')) {
          
          // Extract noteId from the current page/context
          // Try multiple sources for better reliability
          const noteIdFromPath = window.location.pathname.match(/note\/([^/]+)/)?.[1]
          const noteIdFromAttr = document.querySelector('[data-note-id]')?.getAttribute('data-note-id') ||
                                 document.querySelector('[data-note]')?.getAttribute('data-note')
          const noteId = noteIdFromPath || noteIdFromAttr
          
          if (noteId) {
            console.log('[showAnnotationTooltip] Fetching branches for noteId:', noteId)
            // First fetch branch metadata (API uses raw UUID)
            fetch(`/api/postgres-offline/branches?noteId=${noteId}`)
              .then(res => res.json())
              .then(branches => {
                console.log('[showAnnotationTooltip] Branches from API:', branches)
                console.log('[showAnnotationTooltip] Looking for branch with id:', dbId)
                const branch = branches.find((b: any) => b.id === dbId) // Compare with DB format
                if (branch) {
                  console.log('[showAnnotationTooltip] Found branch:', branch)
                  // Now fetch the actual document content for this branch
                  // Use UI format for panel ID (already has branch- prefix)
                  const docUrl = `/api/postgres-offline/documents/${noteId}/${uiId}`
                  console.log('[showAnnotationTooltip] Fetching document from:', docUrl)
                  fetch(docUrl)
                    .then(res => res.json())
                    .then(doc => {
                      console.log('[showAnnotationTooltip] Document fetched:', doc)
                      if (tooltipElement && tooltipElement.classList.contains('visible')) {
                        // Extract text content from HTML
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
                        const displayText = preview.substring(0, 150) + (preview.length > 150 ? '...' : '')
                        
                        tooltipElement.innerHTML = `
                          <div class="tooltip-header">
                            <span class="tooltip-icon">${getTypeIcon(branch.type || type)}</span>
                            <span class="tooltip-title">${branch.title || `${(branch.type || type).charAt(0).toUpperCase() + (branch.type || type).slice(1)} annotation`}</span>
                          </div>
                          <div class="tooltip-content">${displayText}</div>
                          <div class="tooltip-footer">Click to open panel</div>
                        `
                      }
                    })
                    .catch(() => {
                      // If document fetch fails, show placeholder
                      if (tooltipElement && tooltipElement.classList.contains('visible')) {
                        const preview = 'No notes added yet'
                        tooltipElement.innerHTML = `
                          <div class="tooltip-header">
                            <span class="tooltip-icon">${getTypeIcon(branch.type || type)}</span>
                            <span class="tooltip-title">${branch.title || `${(branch.type || type).charAt(0).toUpperCase() + (branch.type || type).slice(1)} annotation`}</span>
                          </div>
                          <div class="tooltip-content">${preview}</div>
                          <div class="tooltip-footer">Click to open panel</div>
                        `
                      }
                    })
                } else {
                  console.log('[showAnnotationTooltip] Branch not found in API response')
                  console.log('[showAnnotationTooltip] Available branch IDs:', branches.map((b: any) => b.id))
                }
              })
              .catch(err => {
                console.error('[showAnnotationTooltip] API fetch error:', err)
              })
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
        
        // Compact helper for ProseMirror text extraction (used in branch-first rendering)
        function extractTextFromPM(node: any): string {
          let text = ''
          if (node && Array.isArray(node.content)) {
            node.content.forEach((n: any) => {
              if (n.type === 'text') text += n.text || ''
              else if (n.content) text += extractTextFromPM(n)
            })
          }
          return text.trim()
        }
        
        // If still no data, it might be a temporary/unsaved branch
        if (!branchData && dbId.startsWith('temp-')) {
          console.log('[showAnnotationTooltip] Temporary branch, no data available yet')
          return
        }
        
        if (!branchData) {
          // Show that we're loading the actual branch content
          // Use the UI format for DOM queries
          const annotatedElement = document.querySelector(`[data-branch-id="${uiId}"]`) ||
                                   document.querySelector(`[data-branch="${uiId}"]`) ||
                                   document.querySelector(`[data-branch-id="${dbId}"]`) ||
                                   document.querySelector(`[data-branch="${dbId}"]`)
          const selectedText = annotatedElement?.textContent || ''
          
          // Show immediate empty state (no loading copy)
          tooltipElement.innerHTML = `
            <div class="tooltip-header">
              <span class="tooltip-icon">${getTypeIcon(type)}</span>
              <span class="tooltip-title">${type.charAt(0).toUpperCase() + type.slice(1)} annotation</span>
            </div>
            <div class="tooltip-content">No notes added yet</div>
            <div class="tooltip-footer">Click to open panel</div>
          `
          
          // Position and show the fallback tooltip
          const rect = element.getBoundingClientRect()
          const tooltipRect = tooltipElement.getBoundingClientRect()
          
          let top = rect.top - tooltipRect.height - 10
          let left = rect.left + (rect.width - tooltipRect.width) / 2
          
          // Adjust if tooltip goes off screen
          if (top < 10) {
            top = rect.bottom + 10
          }
          if (left < 10) {
            left = 10
          }
          if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10
          }
          
          tooltipElement.style.top = `${top}px`
          tooltipElement.style.left = `${left}px`
          tooltipElement.classList.add('visible')
          return
        }
        
        if (branchData) {
          // Convert YJS proxy to plain object (if needed)
          const branch = typeof branchData.toJSON === 'function' 
            ? branchData.toJSON() 
            : JSON.parse(JSON.stringify(branchData))
          
          const title = branch.title || 
                       `${(branch.type || type).charAt(0).toUpperCase() + (branch.type || type).slice(1)} annotation`
          
          // Branch-first rendering: use branch content directly
          const branchPreview = branch.content 
            ? String(branch.content).replace(/<[^>]*>/g, '').trim() 
            : ''
          
          if (branchPreview) {
            // We have branch content - show it immediately
            const preview = branchPreview.substring(0, 150) + (branchPreview.length > 150 ? '...' : '')
            tooltipElement.innerHTML = `
              <div class="tooltip-header">
                <span class="tooltip-icon">${getTypeIcon(branch.type || type)}</span>
                <span class="tooltip-title">${title}</span>
              </div>
              <div class="tooltip-content">${preview}</div>
              <div class="tooltip-footer">Click to open panel</div>
            `
          } else {
            // No branch preview; show placeholder immediately and then try provider/doc
            tooltipElement.innerHTML = `
              <div class="tooltip-header">
                <span class="tooltip-icon">${getTypeIcon(branch.type || type)}</span>
                <span class="tooltip-title">${title}</span>
              </div>
              <div class="tooltip-content">No notes added yet</div>
              <div class="tooltip-footer">Click to open panel</div>
            `
            
            const noteIdFromPath = window.location.pathname.match(/note\/([^/]+)/)?.[1]
            const noteIdFromAttr = document.querySelector('[data-note-id]')?.getAttribute('data-note-id') ||
                                  document.querySelector('[data-note]')?.getAttribute('data-note')
            const noteId = noteIdFromPath || noteIdFromAttr
            
            if (noteId && branch.id) {
              const panelId = branch.id.startsWith('branch-') ? branch.id : `branch-${branch.id}`
              const currentKey = uiId
              fetch(`/api/postgres-offline/documents/${noteId}/${panelId}`)
                .then(res => res.ok ? res.json() : null)
                .then(doc => {
                  if (!doc || !tooltipElement || tooltipElement.dataset.branchId !== currentKey || !tooltipElement.classList.contains('visible')) return
                  let txt = ''
                  if (typeof doc.content === 'string') {
                    const s = doc.content.trim()
                    if (s.startsWith('{') || s.startsWith('[')) {
                      try { 
                        const parsed = JSON.parse(s)
                        txt = extractTextFromPM(parsed)
                      } catch { 
                        txt = s.replace(/<[^>]*>/g, '') 
                      }
                    } else { 
                      txt = s.replace(/<[^>]*>/g, '') 
                    }
                  } else if (doc.content && typeof doc.content === 'object') {
                    txt = extractTextFromPM(doc.content)
                  }
                  let base = txt || 'No notes added yet'
                  const preview = base.substring(0, 150) + ((base && base.length > 150) ? '...' : '')
                  tooltipElement.innerHTML = `
                    <div class="tooltip-header">
                      <span class="tooltip-icon">${getTypeIcon(branch.type || type)}</span>
                      <span class="tooltip-title">${title}</span>
                    </div>
                    <div class="tooltip-content">${preview}</div>
                    <div class="tooltip-footer">Click to open panel</div>
                  `
                })
                .catch(() => {})
            }
          }
          
          // Position tooltip
          const rect = element.getBoundingClientRect()
          const tooltipRect = tooltipElement.getBoundingClientRect()
          
          let top = rect.top - tooltipRect.height - 10
          let left = rect.left + (rect.width - tooltipRect.width) / 2
          
          // Adjust if tooltip goes off screen
          if (top < 10) {
            top = rect.bottom + 10
          }
          if (left < 10) {
            left = 10
          }
          if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10
          }
          
          tooltipElement.style.top = `${top}px`
          tooltipElement.style.left = `${left}px`
          tooltipElement.classList.add('visible')
          
          // Track tooltip shown for performance monitoring
          trackTooltipShown()
        } else {
          console.log('[showAnnotationTooltip] No branch data found for:', branchId)
        }
      }
      
      function hideAnnotationTooltip() {
        if (tooltipTimeout) {
          clearTimeout(tooltipTimeout)
        }
        
        tooltipTimeout = setTimeout(() => {
          if (tooltipElement) {
            tooltipElement.classList.remove('visible')
          }
        }, 300)
      }
      
      function hideAnnotationTooltipSoon() {
        if (tooltipHideTimeout) clearTimeout(tooltipHideTimeout)
        
        tooltipHideTimeout = setTimeout(() => {
          if (!isOverTooltip && !isOverIcon && tooltipElement) {
            tooltipElement.classList.remove('visible')
          }
        }, 300) // Increased delay for smoother transitions
      }
      
      function getTypeIcon(type: string) {
        const icons = { note: '📝', explore: '🔍', promote: '⭐' }
        return icons[type as keyof typeof icons] || '📝'
      }
      
      function createRippleEffect(element: HTMLElement, event: MouseEvent) {
        const ripple = document.createElement('span')
        ripple.className = 'annotation-ripple'
        
        const rect = element.getBoundingClientRect()
        const size = Math.max(rect.width, rect.height)
        const x = event.clientX - rect.left - size / 2
        const y = event.clientY - rect.top - size / 2
        
        ripple.style.width = ripple.style.height = size + 'px'
        ripple.style.left = x + 'px'
        ripple.style.top = y + 'px'
        
        element.appendChild(ripple)
        
        setTimeout(() => {
          ripple.remove()
        }, 600)
      }
      
      // Hover icon management functions
      function ensureHoverIcon() {
        if (hoverIcon) return
        hoverIcon = document.createElement('div')
        hoverIcon.className = 'annotation-hover-icon'
        hoverIcon.innerHTML = '🔎'
        hoverIcon.style.cssText = 'position:fixed;display:none;z-index:10000;pointer-events:auto;'
        document.body.appendChild(hoverIcon)
        
        hoverIcon.addEventListener('mouseenter', () => {
          isOverIcon = true
          // Clear any pending hide timeouts to prevent race conditions
          if (hoverIconHideTimeout) { 
            clearTimeout(hoverIconHideTimeout)
            hoverIconHideTimeout = null
          }
          if (tooltipHideTimeout) { 
            clearTimeout(tooltipHideTimeout)
            tooltipHideTimeout = null
          }
          const branchId = hoverIcon!.getAttribute('data-branch-id') || ''
          const type = hoverIcon!.getAttribute('data-annotation-type') || 'note'
          
          if (branchId) {
            showAnnotationTooltip(hoverIcon!, branchId, type)
          }
        })
        
        hoverIcon.addEventListener('mouseleave', () => {
          isOverIcon = false
          hideHoverIconSoon()
          hideAnnotationTooltipSoon()
        })
      }
      
      function positionHoverIcon(x: number, y: number) {
        const OFFSET = 8
        const iconWidth = 22
        const iconHeight = 22
        
        let left = Math.min(x + OFFSET, window.innerWidth - iconWidth - 10)
        let top = Math.max(y - OFFSET - iconHeight/2, 10)
        
        if (hoverIcon) {
          hoverIcon.style.left = `${left}px`
          hoverIcon.style.top = `${top}px`
        }
      }
      
      function showHoverIcon(targetEl: HTMLElement, branchId: string, type: string, evt: MouseEvent) {
        ensureHoverIcon()
        
        if (hoverIcon) {
          hoverIcon.setAttribute('data-branch-id', branchId)
          hoverIcon.setAttribute('data-annotation-type', type)
          positionHoverIcon(evt.clientX, evt.clientY)
          hoverIcon.style.display = 'block'
        }
        
        if (hoverIconHideTimeout) {
          clearTimeout(hoverIconHideTimeout)
          hoverIconHideTimeout = null
        }
      }
      
      function hideHoverIconSoon() {
        if (hoverIconHideTimeout) clearTimeout(hoverIconHideTimeout)
        
        hoverIconHideTimeout = setTimeout(() => {
          if (!isOverIcon && !isOverTarget && hoverIcon) {
            hoverIcon.style.display = 'none'
          }
        }, 300) // Increased delay to allow time to move to icon
      }
      
      function hideAnnotationTooltipSoon() {
        if (tooltipHideTimeout) clearTimeout(tooltipHideTimeout)
        
        tooltipHideTimeout = setTimeout(() => {
          if (!isOverTooltip && !isOverIcon && tooltipElement) {
            tooltipElement.classList.remove('visible')
          }
        }, 300) // Increased delay for smoother transitions
      }
      
      // Set up event listeners on the editor's DOM element
      const handleMouseOver = (event: MouseEvent) => {
        const target = event.target as HTMLElement
        
        // Check for both annotation spans AND decoration-added hover targets
        let annotationEl = target.closest('.annotation-hover-target') as HTMLElement
        if (!annotationEl) {
          annotationEl = target.closest('.annotation') as HTMLElement
        }
        
        if (annotationEl && !annotationEl.hasAttribute('data-hover-processed')) {
          annotationEl.setAttribute('data-hover-processed', 'true')
          
          
          const branchId = annotationEl.getAttribute('data-branch-id') ||
                         annotationEl.getAttribute('data-branch') ||
                         'temp-' + Date.now()
          const type = annotationEl.getAttribute('data-annotation-type') ||
                      annotationEl.getAttribute('data-type') ||
                      (annotationEl.className.match(/annotation-(\w+)/)?.[1]) ||
                      'note'
          
          
          isOverTarget = true
          showHoverIcon(annotationEl, branchId, type, event)
          annotationEl.classList.add('annotation-hovered')
        }
      }
      
      const handleMouseOut = (event: MouseEvent) => {
        const target = event.target as HTMLElement
        
        let annotationEl = target.closest('.annotation-hover-target') as HTMLElement
        if (!annotationEl) {
          annotationEl = target.closest('.annotation') as HTMLElement
        }
        
        if (annotationEl && annotationEl.hasAttribute('data-hover-processed')) {
          annotationEl.removeAttribute('data-hover-processed')
          isOverTarget = false
          annotationEl.classList.remove('annotation-hovered')
          hideHoverIconSoon()
          hideAnnotationTooltipSoon()
        }
      }
      
      // Attach listeners to the editor DOM
      editorView.dom.addEventListener('mouseover', handleMouseOver)
      editorView.dom.addEventListener('mouseout', handleMouseOut)
      
      
      return {
        destroy() {
          // Clean up event listeners when plugin is destroyed
          editorView.dom.removeEventListener('mouseover', handleMouseOver)
          editorView.dom.removeEventListener('mouseout', handleMouseOut)
          
          // Clean up hover icon if it exists
          if (hoverIcon && hoverIcon.parentNode) {
            hoverIcon.parentNode.removeChild(hoverIcon)
            hoverIcon = null
          }
          
          // Clean up tooltip if it exists
          if (tooltipElement && tooltipElement.parentNode) {
            tooltipElement.parentNode.removeChild(tooltipElement)
            tooltipElement = null
          }
        }
      }
    },
    
    state: {
      init() {
        return {
          decorations: DecorationSet.empty,
          hoveredAnnotation: null as HoverState | null,
          tooltipVisible: false,
        }
      },
      
      apply(tr, value, oldState, newState) {
        // Keep decorations in sync with document changes
        const decorations = value.decorations.map(tr.mapping, tr.doc)
        
        // Find all annotation marks in the document
        const annotationDecorations: Decoration[] = []
        
        tr.doc.descendants((node, pos) => {
          if (!node.isText) return
          
          node.marks.forEach(mark => {
            if (mark.type.name === 'annotation') {
              const from = pos
              const to = pos + node.nodeSize
              const branchId = mark.attrs.branchId || mark.attrs['data-branch']
              
              // Add decoration for hover effects
              const decoration = Decoration.inline(from, to, {
                class: 'annotation-hover-target',
                'data-branch-id': branchId,
                'data-annotation-type': mark.attrs.type,
              })
              
              annotationDecorations.push(decoration)
            }
          })
        })
        
        return {
          decorations: DecorationSet.create(newState.doc, annotationDecorations),
          hoveredAnnotation: value.hoveredAnnotation,
          tooltipVisible: value.tooltipVisible,
        }
      }
    },
    
    props: {
      decorations(state) {
        return this.getState(state)?.decorations
      },
      
      handleDOMEvents: {
        // We're handling events in the view() method with direct DOM listeners
        // These handlers are kept minimal to avoid conflicts
        click(view, event) {
          // Let the existing annotation click handlers work
          return false
        }
      }
    }
  })
}

 
