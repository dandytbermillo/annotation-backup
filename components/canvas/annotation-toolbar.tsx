"use client"

import React from "react"
import { useCanvas } from "./canvas-context"
import { v4 as uuidv4 } from "uuid"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { getPlainProvider } from "@/lib/provider-switcher"
import { createAnnotationBranch } from "@/lib/models/annotation"
import { buildBranchPreview } from "@/lib/utils/branch-preview"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { debugLog } from "@/lib/utils/debug-logger"

export function AnnotationToolbar() {
  const { dispatch, state, dataStore, noteId } = useCanvas()
  const [overridePanelInfo, setOverridePanelInfo] = React.useState<{ panelId: string; noteId: string } | null>(null)

  // ✅ FIX 1: Store timeout handle in ref (persists across renders)
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null)

  // Listen for panel-specific annotation creation requests from Tools button
  React.useEffect(() => {
    const handleSetAnnotationPanel = (event: Event) => {
      // ✅ FIX 4: Guard detail BEFORE destructuring to prevent crashes
      const detail = (event as CustomEvent)?.detail ?? {}
      const { panelId, noteId } = detail as Partial<{
        panelId: string
        noteId: string
      }>

      // ✅ FIX 3: Guard against empty/null values
      if (!panelId || !noteId) {
        console.log('[AnnotationToolbar] Clearing override (empty/null event)')
        setOverridePanelInfo(null)
        // Clear timeout if exists
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        return
      }

      console.log('[AnnotationToolbar] Received set-annotation-panel event:', { panelId, noteId })
      setOverridePanelInfo({ panelId, noteId })

      // ✅ FIX 1: Cancel previous timeout
      if (timeoutRef.current) {
        console.log('[AnnotationToolbar] Cancelling previous timeout')
        clearTimeout(timeoutRef.current)
      }

      // ✅ FIX 1: Store new timeout handle
      timeoutRef.current = setTimeout(() => {
        console.log('[AnnotationToolbar] Timeout expired, clearing override')
        setOverridePanelInfo(null)
        timeoutRef.current = null
      }, 5000)
    }

    window.addEventListener('set-annotation-panel', handleSetAnnotationPanel)

    return () => {
      console.log('[AnnotationToolbar] Cleanup - removing listener and clearing timeout')
      window.removeEventListener('set-annotation-panel', handleSetAnnotationPanel)

      // ✅ FIX 2: Clear timeout on unmount
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [])

  const createAnnotation = (type: 'note' | 'explore' | 'promote') => {
    const text = state.selectedText
    const panel = overridePanelInfo?.panelId || state.currentPanel

    if (!text || !panel) {
      console.warn('No text selected or no panel available')
      return
    }

    // Use override noteId if available (from Tools button), otherwise extract from dataStore
    let panelNoteId = overridePanelInfo?.noteId || noteId

    // If no override, try to get noteId from dataStore
    if (!overridePanelInfo) {
      dataStore.forEach((value: any, key: string) => {
        if (value && typeof value === 'object' && 'id' in value) {
          // Check if this is the current panel by comparing panel IDs
          if (value.id === panel) {
            // Extract noteId from composite key (format: "noteId::panelId")
            if (key.includes('::')) {
              panelNoteId = key.split('::')[0]
              console.log('[AnnotationToolbar] Found panel noteId from composite key:', panelNoteId, 'for panel:', panel)
            } else if ('noteId' in value && typeof value.noteId === 'string') {
              // Or get it from panel data if stored directly
              panelNoteId = value.noteId
              console.log('[AnnotationToolbar] Found panel noteId from panel data:', panelNoteId, 'for panel:', panel)
            }
          }
        }
      })
    }

    console.log('[AnnotationToolbar] Creating annotation with noteId:', panelNoteId, 'for panel:', panel, 'global noteId:', noteId, 'override:', overridePanelInfo)

    // Clear the override after using it
    if (overridePanelInfo) {
      setOverridePanelInfo(null)
    }

    // Generate unique IDs
    const annotationId = uuidv4()
    const branchId = `branch-${annotationId}`

    // Check if we're in plain mode
    const plainProvider = getPlainProvider()
    const isPlainMode = !!plainProvider

    // Calculate smart position FIRST before creating branch data
    const calculateSmartPosition = () => {
      // Use composite key to find the EXACT panel (noteId::panelId) instead of just panelId
      // This prevents selecting the wrong panel when multiple notes have panels with the same ID
      const parentStoreKey = ensurePanelKey(panelNoteId || '', panel)
      const currentPanel = document.querySelector(`[data-store-key="${parentStoreKey}"]`) as HTMLElement
      let parentPosition = { x: 2000, y: 1500 }

      // Debug: Check if panel was found
      if (!currentPanel) {
        debugLog({
          component: 'AnnotationToolbar',
          action: 'panel_not_found',
          metadata: {
            parentPanel: panel,
            parentNoteId: panelNoteId,
            parentStoreKey,
            selector: `[data-store-key="${parentStoreKey}"]`,
            availableStoreKeys: Array.from(document.querySelectorAll('[data-store-key]')).map(el => el.getAttribute('data-store-key'))
          },
          content_preview: `Parent panel ${parentStoreKey} not found in DOM`,
          note_id: panelNoteId
        }).catch(console.error)
      }
      
      if (currentPanel) {
        const rect = currentPanel.getBoundingClientRect()
        const panelWidth = rect.width || 800
        const gap = 50
        
        const style = window.getComputedStyle(currentPanel)
        
        // Panels use absolute positioning with left/top, not transforms
        const leftStr = style.left
        const topStr = style.top
        const currentX = parseFloat(leftStr) || 0
        const currentY = parseFloat(topStr) || 0
        
        // Debug: Log position
        debugLog({
          component: 'AnnotationToolbar',
          action: 'panel_position',
          metadata: {
            parentPanel: panel,
            parentNoteId: panelNoteId,
            parentStoreKey,
            left: leftStr,
            top: topStr,
            currentX: currentX,
            currentY: currentY,
            rect: { width: rect.width, height: rect.height }
          },
          content_preview: `Panel ${parentStoreKey} at x=${currentX}, y=${currentY}`,
          note_id: panelNoteId
        }).catch(console.error)
        
        if (currentX || currentY) {
          // Always place on the right side of parent panel
          parentPosition = {
            x: currentX + panelWidth + gap,
            y: currentY
          }
        }
      }
      
      return parentPosition
    }
    
    const smartPosition = calculateSmartPosition()
    
    // Log to debug_logs table
    debugLog({
      component: 'AnnotationToolbar',
      action: 'calculate_smart_position',
      metadata: {
        parentPanel: panel,
        calculatedPosition: smartPosition,
        branchId: branchId,
        annotationType: type
      },
      content_preview: `Position for ${type} annotation: x=${smartPosition.x}, y=${smartPosition.y}`,
      note_id: panelNoteId
    }).catch(console.error)

    // Create the branch data with proper quoted content AND position
    const draftBranch = createAnnotationBranch(type, panel, panelNoteId || '', text, smartPosition)
    const initialPreview = buildBranchPreview(draftBranch.content, text)

    const branchData = {
      id: branchId,
      ...draftBranch,
      position: smartPosition, // Include position in branch data
      preview: initialPreview,
      branches: [],
      isEditable: true,
      metadata: {
        ...draftBranch.metadata,
        preview: initialPreview,
      },
    }

    // Add the branch to data store with position already set
    const branchStoreKey = ensurePanelKey(panelNoteId || '', branchId)
    const panelStoreKey = ensurePanelKey(panelNoteId || '', panel)
    dataStore.set(branchStoreKey, branchData)

    if (isPlainMode && plainProvider && panelNoteId) {
      // Plain mode: Create annotation in database
      // Use raw UUID for database ID, but keep branch-xxx format for UI
      plainProvider.createBranch({
        id: annotationId, // Use raw UUID for database
        noteId: panelNoteId,
        parentId: panel,  // Keep as-is: 'main', 'branch-xxx', or UUID
        type: type,
        title: draftBranch.title, // Persist title to database immediately
        originalText: text,
        metadata: {
          annotationType: type,
          annotationId: annotationId,
          displayId: branchId, // Store the UI ID in metadata
          preview: initialPreview,
        },
        anchors: state.selectedRange ? {
          start: state.selectedRange.startOffset,
          end: state.selectedRange.endOffset,
          context: text
        } : undefined
      }).then(() => {
        return plainProvider.saveDocument(panelNoteId!, branchId, branchData.content, false, { skipBatching: true })
      }).catch(error => {
        console.error('[AnnotationToolbar] Failed to create branch or persist initial content:', error)
      })

     // Update parent's branches list
     const parentPanel = dataStore.get(panelStoreKey)
     if (parentPanel) {
        const branches = parentPanel.branches || []
        const newBranches = [...branches, branchId]
        dataStore.update(panelStoreKey, { branches: newBranches })
      }
    } else {
      // Yjs mode: Use UnifiedProvider (collab)
      const provider = UnifiedProvider.getInstance()
      if (panelNoteId) {
        provider.setCurrentNote(panelNoteId)
      }

      // Use the new addBranch method that handles YJS native types properly
      provider.addBranch(panel, branchId, branchData)

      // Update DataStore for backward compatibility
      const parentPanel = dataStore.get(panelStoreKey)
      if (parentPanel) {
        // Get current branches using the new YJS method (this will be consistent)
        const currentBranches = provider.getBranches(panel)
        dataStore.update(panelStoreKey, { branches: currentBranches })
      } else {
        // If parent doesn't exist in dataStore, create minimal entry
        dataStore.set(panelStoreKey, {
          branches: provider.getBranches(panel),
          position: { x: 2000, y: 1500 } // Default position
        })
      }
    }

    // Position is already set in branchData, no need to calculate again

    // Dispatch both panel-specific and global events for annotation insertion
    const eventDetail = {
      type,
      annotationId,
      branchId,
      panelId: panel,
      text,
    }

    // Try panel-specific event first
    const panelElements = document.querySelectorAll('.panel')
    panelElements.forEach(element => {
      // Check if this is the correct panel by looking for the panel ID in the content
      const panelContent = element.querySelector(`[data-panel="${panel}"]`)
      if (panelContent || element.textContent?.includes(panel)) {
        element.dispatchEvent(new CustomEvent('insert-annotation', { 
          detail: eventDetail,
          bubbles: true 
        }))
      }
    })

    // Also dispatch global event as fallback
    window.dispatchEvent(new CustomEvent('insert-annotation-global', { 
      detail: eventDetail 
    }))

    // Create the panel for the new branch with smart position
    // NOTE: smartPosition is already in world-space (read from style.left/top which are world coords)
    window.dispatchEvent(new CustomEvent('create-panel', {
      detail: {
        panelId: branchId,
        parentPanelId: panel,
        parentPosition: smartPosition,
        noteId: panelNoteId,
        coordinateSpace: 'world' // Flag to prevent double conversion in handleCreatePanel
      }
    }))

    // Force a re-render by triggering branch updated action
    dispatch({ type: "BRANCH_UPDATED" })

    // Hide the toolbar after creating annotation
    const toolbar = document.getElementById("annotation-toolbar")
    if (toolbar) {
      toolbar.classList.remove("visible")
    }

    // Clear selection
    dispatch({ type: "SET_SELECTION", payload: { text: "", range: null, panel: null } })
    
    // Clear browser text selection
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div
      id="annotation-toolbar"
      className="annotation-toolbar"
      onMouseEnter={() => {
        const toolbar = document.getElementById("annotation-toolbar")
        if (toolbar) {
          toolbar.style.opacity = "1"
          toolbar.style.pointerEvents = "auto"
          toolbar.classList.add("visible")
        }
      }}
      onMouseLeave={() => {
        setTimeout(() => {
          const toolbar = document.getElementById("annotation-toolbar")
          if (toolbar && !toolbar.matches(':hover')) {
            toolbar.style.opacity = "0"
            toolbar.style.pointerEvents = "none"
            toolbar.classList.remove("visible")
          }
        }, 300)
      }}
      style={{
        position: "fixed",
        background: "white",
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        padding: "8px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        display: "flex",
        gap: "8px",
        zIndex: 1000,
        opacity: 0,
        pointerEvents: "none",
        transform: "translateX(-50%) translateY(0)",
        transition: "opacity 0.2s ease, transform 0.2s ease",
      }}
    >
      <button
        onClick={() => createAnnotation('note')}
        className="annotation-btn note"
        title="Create Note"
        style={{
          background: "linear-gradient(135deg, #3498db 0%, #2980b9 100%)",
          color: "white",
          border: "none",
          borderRadius: "6px",
          padding: "8px 16px",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          transition: "transform 0.2s ease",
        }}
        onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
        onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
      >
        📝 Note
      </button>

      <button
        onClick={() => createAnnotation('explore')}
        className="annotation-btn explore"
        title="Create Exploration"
        style={{
          background: "linear-gradient(135deg, #f39c12 0%, #e67e22 100%)",
          color: "white",
          border: "none",
          borderRadius: "6px",
          padding: "8px 16px",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          transition: "transform 0.2s ease",
        }}
        onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
        onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
      >
        🔍 Explore
      </button>

      <button
        onClick={() => createAnnotation('promote')}
        className="annotation-btn promote"
        title="Create Promotion"
        style={{
          background: "linear-gradient(135deg, #27ae60 0%, #229954 100%)",
          color: "white",
          border: "none",
          borderRadius: "6px",
          padding: "8px 16px",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          transition: "transform 0.2s ease",
        }}
        onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
        onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
      >
        ⭐ Promote
      </button>

      <style jsx>{`
        .annotation-toolbar.visible {
          opacity: 1 !important;
          pointer-events: auto !important;
          transform: translateX(-50%) translateY(-10px) !important;
        }
      `}</style>
    </div>
  )
}
