"use client"

import { useState, useRef } from "react"
import { createPortal } from "react-dom"
import { useCanvas } from "./canvas-context"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { getPlainProvider } from "@/lib/provider-switcher"
import { buildBranchPreview, buildMultilinePreview } from "@/lib/utils/branch-preview"
import type { CanvasState } from "@/types/canvas"
import type { DataStore } from "@/lib/data-store"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { debugLog } from "@/lib/utils/debug-logger"
import { PreviewPopover } from "@/components/shared/preview-popover"

interface BranchItemProps {
  branchId: string
  parentId: string
  // Optional props for standalone usage (outside canvas context)
  dataStore?: DataStore
  state?: CanvasState
  dispatch?: React.Dispatch<any>
  editMode?: boolean
  noteId?: string
}

export function BranchItem({ branchId, parentId, dataStore: propDataStore, state: propState, dispatch: propDispatch, editMode, noteId: propNoteId }: BranchItemProps) {
  // Try to use canvas context if available, otherwise use props
  const canvasContext = useCanvas ? (() => { try { return useCanvas() } catch { return null } })() : null
  const dataStore = propDataStore || canvasContext?.dataStore
  const dispatch = propDispatch || canvasContext?.dispatch
  const state = propState || canvasContext?.state
  const noteId = propNoteId || canvasContext?.noteId || ''

  // State for preview popover
  const [previewPopover, setPreviewPopover] = useState<{
    position: { x: number; y: number }
    content: string
    status: 'loading' | 'ready' | 'error'
  } | null>(null)
  const previewTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  // State for rename functionality
  const [isRenaming, setIsRenaming] = useState(false)
  const [renamingValue, setRenamingValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Early return if dataStore is not available
  if (!dataStore) return null

  // Check if we're in plain mode
  const plainProvider = getPlainProvider()
  const isPlainMode = !!plainProvider

  // Get branch data based on mode
  let branch
  let branchesMap
  const branchStoreKey = ensurePanelKey(noteId, branchId)

  if (isPlainMode) {
    // Plain mode: Get from dataStore
    branch = dataStore.get(branchStoreKey)
    branchesMap = dataStore
  } else {
    // Yjs mode: Get from UnifiedProvider
    const provider = UnifiedProvider.getInstance()
    branchesMap = provider.getBranchesMap()
    branch = branchesMap.get(branchStoreKey) || dataStore.get(branchStoreKey)
  }

  if (!branch) return null

  const getTypeIcon = (type: string) => {
    const icons = { note: "📝", explore: "🔍", promote: "⭐", main: "📄" }
    return icons[type as keyof typeof icons] || "📝"
  }

  const handleClick = async () => {
    console.log(`BranchItem clicked: ${branchId}`)

    // Require dispatch and state for panel operations
    if (!dispatch || !state) {
      console.warn('Cannot handle click: dispatch or state not available')
      return
    }

    // Check if panel already exists
    // CRITICAL FIX: Check using composite key (branchStoreKey) not just branchId
    if (state.panels.has(branchStoreKey)) {
      console.log(`Panel ${branchStoreKey} already exists, focusing it`)
      // Panel exists, just focus it
      const panel = state.panels.get(branchStoreKey)
      if (panel?.element) {
        panel.element.style.zIndex = String(state.panelZIndex + 1)
        dispatch({
          type: "UPDATE_PANEL_Z_INDEX",
          payload: state.panelZIndex + 1,
        })
      }
      return
    }

    console.log(`Creating new panel for branch ${branchId}`)

    // Ensure branch data exists in dataStore (load from DB if needed)
    const existingBranchData = dataStore.get(branchStoreKey)
    if (!existingBranchData) {
      debugLog({
        component: 'BranchItem',
        action: 'loading_missing_branch_data',
        metadata: {
          branchId,
          noteId,
          branchStoreKey
        },
        content_preview: `Branch data not in dataStore, loading from database`
      })

      try {
        // Fetch branch data from database
        const response = await fetch(`/api/postgres-offline/branches?noteId=${noteId}`)
        if (response.ok) {
          const branches = await response.json()
          // Find our branch in the array
          if (Array.isArray(branches)) {
            const branchData = branches.find((b: any) => b.id === branchId)
            if (branchData) {
              // Add to dataStore with composite key
              dataStore.set(branchStoreKey, branchData)
              debugLog({
                component: 'BranchItem',
                action: 'branch_data_loaded',
                metadata: {
                  branchId,
                  noteId,
                  branchStoreKey,
                  parentId: branchData.parentId,
                  type: branchData.type
                },
                content_preview: `Loaded branch data from database`
              })
            } else {
              debugLog({
                component: 'BranchItem',
                action: 'branch_not_found_in_api',
                metadata: {
                  branchId,
                  noteId,
                  branchesCount: branches.length,
                  branchIds: branches.map((b: any) => b.id)
                },
                content_preview: `Branch ${branchId} not found in API response`
              })
            }
          }
        }
      } catch (error) {
        console.error('[BranchItem] Failed to load branch data:', error)
        debugLog({
          component: 'BranchItem',
          action: 'branch_data_load_failed',
          metadata: {
            branchId,
            noteId,
            error: String(error)
          },
          content_preview: `Failed to load branch data`
        })
      }
    }

    // Calculate smart position based on parent panel's actual DOM position
    const calculateSmartPosition = () => {
      // Panels use data-store-key attribute with composite key format: "noteId::panelId"
      const parentStoreKey = ensurePanelKey(noteId, parentId)
      const currentPanel = document.querySelector(`[data-store-key="${parentStoreKey}"]`) as HTMLElement
      let targetPosition = { x: 2000, y: 1500 } // Default fallback

      debugLog({
        component: 'BranchItem',
        action: 'smart_position_start',
        metadata: {
          branchId,
          parentId,
          noteId,
          parentStoreKey,
          panelFound: !!currentPanel,
          availablePanels: Array.from(document.querySelectorAll('[data-store-key]')).map(el => el.getAttribute('data-store-key'))
        },
        content_preview: `Looking for parent panel: ${parentStoreKey}`
      })

      if (!currentPanel) {
        console.warn(`[BranchItem] Parent panel ${parentId} not found in DOM`)
        debugLog({
          component: 'BranchItem',
          action: 'smart_position_fallback',
          metadata: {
            branchId,
            parentId,
            noteId,
            fallbackPosition: targetPosition
          },
          content_preview: `Parent panel not found, using fallback`
        })
        return targetPosition
      }

      const style = window.getComputedStyle(currentPanel)
      const rect = currentPanel.getBoundingClientRect()

      // Panels use absolute positioning with left/top
      const currentX = parseFloat(style.left) || 0
      const currentY = parseFloat(style.top) || 0
      const panelWidth = rect.width || 800
      const gap = 50

      debugLog({
        component: 'BranchItem',
        action: 'smart_position_parent_found',
        metadata: {
          branchId,
          parentId,
          noteId,
          left: style.left,
          top: style.top,
          currentX,
          currentY,
          panelWidth,
          rectWidth: rect.width,
          rectHeight: rect.height
        },
        content_preview: `Parent panel at x=${currentX}, y=${currentY}`
      })

      if (currentX || currentY) {
        // Check for occupied space on left and right
        const allPanels = document.querySelectorAll('[data-store-key]')
        let rightOccupied = false
        let leftOccupied = false

        allPanels.forEach((panel) => {
          if (panel === currentPanel) return

          const panelStyle = window.getComputedStyle(panel)
          const panelX = parseFloat(panelStyle.left) || 0

          // Check if space on right is occupied
          if (panelX > currentX + panelWidth &&
              panelX < currentX + panelWidth + gap + 100) {
            rightOccupied = true
          }

          // Check if space on left is occupied
          if (panelX < currentX - gap &&
              panelX > currentX - panelWidth - gap - 100) {
            leftOccupied = true
          }
        })

        let placeOnLeft = false

        if (!rightOccupied && !leftOccupied) {
          // Prefer right side by default
          // Only use left if panel is already far to the right
          placeOnLeft = currentX > 2500
        } else if (rightOccupied && !leftOccupied) {
          placeOnLeft = true
        } else if (!rightOccupied && leftOccupied) {
          placeOnLeft = false
        } else {
          // Both sides occupied, place below
          placeOnLeft = false
          targetPosition.y = currentY + 100
        }

        targetPosition = {
          x: placeOnLeft
            ? currentX - panelWidth - gap
            : currentX + panelWidth + gap,
          y: targetPosition.y || currentY
        }
      }

      debugLog({
        component: 'BranchItem',
        action: 'smart_position_result',
        metadata: {
          branchId,
          parentId,
          noteId,
          calculatedPosition: targetPosition
        },
        content_preview: `Calculated position: x=${targetPosition.x}, y=${targetPosition.y}`
      })

      return targetPosition
    }

    const smartScreenPosition = calculateSmartPosition()

    // CRITICAL FIX: Convert screen-space position to world-space before storing!
    // calculateSmartPosition() returns screen coordinates (from DOM), but dataStore
    // must hold world-space coordinates for proper persistence and hydration.
    const camera = { x: state.canvasState.translateX, y: state.canvasState.translateY }
    const zoom = state.canvasState.zoom
    const smartWorldPosition = {
      x: (smartScreenPosition.x / zoom) - camera.x,
      y: (smartScreenPosition.y / zoom) - camera.y
    }

    debugLog({
      component: 'BranchItem',
      action: 'smart_position_final',
      metadata: {
        branchId,
        parentId,
        noteId,
        screenPosition: smartScreenPosition,
        worldPosition: smartWorldPosition,
        camera,
        zoom
      },
      content_preview: `Screen(${smartScreenPosition.x}, ${smartScreenPosition.y}) → World(${smartWorldPosition.x}, ${smartWorldPosition.y})`
    })

    // Update position in both stores (using WORLD-SPACE coordinates)
    dataStore.update(branchStoreKey, {
      position: smartWorldPosition,
      worldPosition: smartWorldPosition  // Explicit world-space marker
    })

    const branchData = branchesMap.get(branchStoreKey)
    if (branchData) {
      branchData.position = smartWorldPosition
      branchData.worldPosition = smartWorldPosition
      branchesMap.set(branchStoreKey, branchData)
    }

    // Add panel
    // CRITICAL FIX: Use composite key (branchStoreKey) not just branchId
    dispatch({
      type: "ADD_PANEL",
      payload: {
        id: branchStoreKey,  // Use composite key "noteId::panelId" not just "branchId"
        panel: { element: null, branchId },
      },
    })

    // Also dispatch create-panel event for modern canvas
    window.dispatchEvent(new CustomEvent('create-panel', {
      detail: { panelId: branchId, noteId },
      bubbles: true
    }))
  }

  // Display the original annotated text that was selected when creating the annotation
  const preview = branch.originalText && branch.originalText.trim()
    ? branch.originalText
    : (branch.preview && branch.preview.trim()
      ? branch.preview
      : buildBranchPreview(branch.content, branch.originalText))

  const borderColors = {
    note: "border-l-blue-400",
    explore: "border-l-orange-400",
    promote: "border-l-green-400",
  }

  // Eye icon handlers
  const handleEyeClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Clear any preview timeout
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
    }
    // Clear preview popover since we're opening permanently
    setPreviewPopover(null)
    // Click opens the panel permanently
    handleClick()
  }

  const handleEyeMouseEnter = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Clear any existing timeout
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
    }
    // Only show preview if panel doesn't already exist
    const panelExists = document.querySelector(`[data-panel-id="${branchId}"]`)
    if (!panelExists) {
      // Capture the target element before setTimeout (React reuses events)
      const target = e.currentTarget as HTMLElement

      // Show preview after short delay
      previewTimeoutRef.current = setTimeout(async () => {
        let previewPosition = { x: 150, y: 150 } // Default fallback

        // Find the branches panel container (the purple gradient panel)
        const branchItemContainer = target.closest('[style*="background"]') as HTMLElement
        const branchesPanel = branchItemContainer?.closest('[data-branches-panel="true"]') as HTMLElement

        if (branchesPanel) {
          const panelRect = branchesPanel.getBoundingClientRect()
          const itemRect = branchItemContainer?.getBoundingClientRect()
          const viewportWidth = window.innerWidth
          const popoverWidth = 360 // PreviewPopover width
          const gap = 15

          // Use the branch item's vertical position for better alignment
          const yPosition = itemRect ? itemRect.top : panelRect.top

          // Check available space on both sides
          const spaceOnRight = viewportWidth - (panelRect.right + gap + popoverWidth)
          const spaceOnLeft = panelRect.left - popoverWidth - gap

          // Choose position: prefer right, but ensure it's on-screen
          if (spaceOnRight > 0) {
            previewPosition = { x: panelRect.right + gap, y: yPosition }
          } else if (spaceOnLeft > 0) {
            previewPosition = { x: panelRect.left - popoverWidth - gap, y: yPosition }
          } else {
            previewPosition = { x: (viewportWidth - popoverWidth) / 2, y: yPosition }
          }
        }

        // Show loading state
        setPreviewPopover({
          position: previewPosition,
          content: 'Loading...',
          status: 'loading'
        })

        // Fetch actual branch content from document_saves
        try {
          const response = await fetch(`/api/postgres-offline/documents/${noteId}/${branchId}`)

          debugLog({
            component: 'BranchItem',
            action: 'preview_fetch_response',
            metadata: {
              branchId,
              noteId,
              status: response.status,
              ok: response.ok
            },
            content_preview: `API response: ${response.status} ${response.ok ? 'OK' : 'ERROR'}`
          })

          if (!response.ok) {
            // If not found, extract text from branch.content (don't use originalText as fallback!)
            if (response.status === 404) {
              debugLog({
                component: 'BranchItem',
                action: 'preview_using_branch_content',
                metadata: {
                  branchId,
                  noteId,
                  hasBranchContent: !!branch.content,
                  branchContentType: typeof branch.content,
                  branchContentSample: JSON.stringify(branch.content)?.substring(0, 200) || 'undefined'
                },
                content_preview: `404 - Using branch.content`
              })

              const fallbackContent = buildMultilinePreview(branch.content, '', Number.MAX_SAFE_INTEGER)

              debugLog({
                component: 'BranchItem',
                action: 'preview_extracted_fallback',
                metadata: {
                  branchId,
                  noteId,
                  extractedLength: fallbackContent?.length || 0,
                  extractedSample: fallbackContent?.substring(0, 200)
                },
                content_preview: `Extracted: ${fallbackContent?.substring(0, 100) || 'EMPTY'}`
              })

              setPreviewPopover({
                position: previewPosition,
                content: fallbackContent || 'No content yet',
                status: 'ready'
              })
              return
            }
            throw new Error('Failed to fetch content')
          }

          const data = await response.json()
          let content = data?.content

          debugLog({
            component: 'BranchItem',
            action: 'preview_api_content',
            metadata: {
              branchId,
              noteId,
              hasContent: !!content,
              contentType: typeof content,
              contentSample: JSON.stringify(content)?.substring(0, 200) || 'undefined'
            },
            content_preview: `API content type: ${typeof content}`
          })

          // Extract text from content - always use buildMultilinePreview to handle all formats
          const previewText = buildMultilinePreview(content, '', Number.MAX_SAFE_INTEGER)

          debugLog({
            component: 'BranchItem',
            action: 'preview_extracted_text',
            metadata: {
              branchId,
              noteId,
              extractedLength: previewText?.length || 0,
              extractedSample: previewText?.substring(0, 200)
            },
            content_preview: `Extracted: ${previewText?.substring(0, 100) || 'EMPTY'}`
          })

          setPreviewPopover({
            position: previewPosition,
            content: previewText || 'No content yet',
            status: 'ready'
          })
        } catch (error) {
          console.error('[BranchItem] Failed to fetch preview:', error)
          // Fallback to extracting from branch.content (don't use originalText!)
          const fallbackContent = buildMultilinePreview(branch.content, '', Number.MAX_SAFE_INTEGER)
          setPreviewPopover({
            position: previewPosition,
            content: fallbackContent || 'Failed to load preview',
            status: 'error'
          })
        }
      }, 300) // 300ms delay
    }
  }

  const handleEyeMouseLeave = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Clear timeout
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
    }
    // Hide preview popover after short delay
    previewTimeoutRef.current = setTimeout(() => {
      setPreviewPopover(null)
    }, 300)
  }

  const handlePreviewMouseEnter = () => {
    // Cancel hide timeout when hovering preview
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
    }
  }

  const handlePreviewMouseLeave = () => {
    // Hide preview when leaving
    setPreviewPopover(null)
  }

  const borderColor = branch.type === 'note' ? '#3498db' :
                      branch.type === 'explore' ? '#f39c12' : '#27ae60'

  // Rename handlers
  const handleStartRename = () => {
    setIsRenaming(true)
    setRenamingValue(branch.title || '')
    setTimeout(() => renameInputRef.current?.select(), 0)
  }

  const handleSaveRename = () => {
    const trimmed = renamingValue.trim()
    if (trimmed && trimmed !== branch.title && dataStore) {
      dataStore.update(branchStoreKey, { title: trimmed })
    }
    setIsRenaming(false)
  }

  const handleCancelRename = () => {
    setIsRenaming(false)
    setRenamingValue('')
  }

  const handleDoubleClick = () => {
    if (editMode) {
      handleStartRename()
    }
  }

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.95)',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '12px',
        transition: 'all 0.3s ease',
        borderLeft: `4px solid ${borderColor}`,
        userSelect: 'none',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateX(4px)'
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateX(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Branch content - clickable area */}
      <div
        style={{
          flex: 1,
          cursor: editMode && !isRenaming ? 'pointer' : 'default',
        }}
        onClick={isRenaming ? undefined : handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renamingValue}
            onChange={(e) => setRenamingValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSaveRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                handleCancelRename()
              }
            }}
            onBlur={handleSaveRename}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              fontSize: '14px',
              fontWeight: 600,
              color: '#2c3e50',
              padding: '4px 8px',
              border: '2px solid #3498db',
              borderRadius: '4px',
              outline: 'none',
              background: 'white',
            }}
          />
        ) : (
          <>
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#2c3e50',
              marginBottom: '4px',
            }}>
              {getTypeIcon(branch.type)} {branch.title}
            </div>
            <div style={{
              fontSize: '12px',
              color: '#7f8c8d',
              lineHeight: 1.4,
            }}>
              {preview || 'Click to open'}
            </div>
          </>
        )}
      </div>

      {/* Eye/View button */}
      <button
        onClick={handleEyeClick}
        onMouseEnter={handleEyeMouseEnter}
        onMouseLeave={handleEyeMouseLeave}
        style={{
          background: 'transparent',
          border: '1px solid #ddd',
          borderRadius: '50%',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          color: '#7f8c8d',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = 'rgba(0,0,0,0.05)'
          e.currentTarget.style.borderColor = '#999'
          e.currentTarget.style.color = '#2c3e50'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.borderColor = '#ddd'
          e.currentTarget.style.color = '#7f8c8d'
        }}
      >
        <span style={{ fontSize: '16px' }}>👁</span>
      </button>

      {/* Preview Popover - rendered as portal */}
      {previewPopover && typeof window !== 'undefined' && createPortal(
        <PreviewPopover
          content={previewPopover.content}
          status={previewPopover.status}
          position={previewPopover.position}
          noteId={branchId}
          onOpenNote={() => handleClick()}
          onMouseEnter={handlePreviewMouseEnter}
          onMouseLeave={handlePreviewMouseLeave}
        />,
        document.body
      )}
    </div>
  )
}
