"use client"

import { useState, useRef } from "react"
import { useCanvas } from "./canvas-context"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { getPlainProvider } from "@/lib/provider-switcher"
import { buildBranchPreview } from "@/lib/utils/branch-preview"
import type { CanvasState } from "@/types/canvas"
import type { DataStore } from "@/lib/data-store"
import { ensurePanelKey } from "@/lib/canvas/composite-id"

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

  // State for preview functionality
  const [isPreview, setIsPreview] = useState(false)
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

  const handleClick = () => {
    console.log(`BranchItem clicked: ${branchId}`)

    // Require dispatch and state for panel operations
    if (!dispatch || !state) {
      console.warn('Cannot handle click: dispatch or state not available')
      return
    }

    // Check if panel already exists
    if (state.panels.has(branchId)) {
      console.log(`Panel ${branchId} already exists, focusing it`)
      // Panel exists, just focus it
      const panel = state.panels.get(branchId)
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

    // Calculate position for new panel
    const parentStoreKey = ensurePanelKey(noteId, parentId)
    const parentBranch = branchesMap.get(parentStoreKey) || dataStore.get(parentStoreKey)
    if (!parentBranch) {
      console.error(`Parent branch ${parentId} not found`)
      return
    }

    // Get sibling count based on mode
    let siblingCount
    if (isPlainMode) {
      const parent = dataStore.get(parentStoreKey)
      const siblings = parent?.branches || []
      siblingCount = siblings.length
    } else {
      // Use provider API to get the accurate sibling count
      const provider = UnifiedProvider.getInstance()
      const allSiblings = provider.getBranches(parentId)
      siblingCount = allSiblings.length
    }

    const targetX = parentBranch.position.x + 900 // PANEL_SPACING_X
    const targetY = parentBranch.position.y + siblingCount * 650 // PANEL_SPACING_Y

    // Update position in both stores
    dataStore.update(branchStoreKey, {
      position: { x: targetX, y: targetY },
    })

    const branchData = branchesMap.get(branchStoreKey)
    if (branchData) {
      branchData.position = { x: targetX, y: targetY }
      branchesMap.set(branchStoreKey, branchData)
    }

    // Add panel
    dispatch({
      type: "ADD_PANEL",
      payload: {
        id: branchId,
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
    // Clear preview state since we're opening permanently
    setIsPreview(false)
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
      // Show preview after short delay
      previewTimeoutRef.current = setTimeout(() => {
        setIsPreview(true)

        // Dispatch event to create temporary preview panel
        window.dispatchEvent(new CustomEvent('preview-panel', {
          detail: {
            panelId: branchId,
            parentPanelId: parentId,
            isPreview: true
          },
          bubbles: true
        }))
      }, 300) // 300ms delay
    }
  }

  const handleEyeMouseLeave = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Clear timeout
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
    }
    // Only remove preview if it's actually a preview (not permanent)
    if (isPreview) {
      setIsPreview(false)
      // Dispatch event to remove preview panel
      window.dispatchEvent(new CustomEvent('remove-preview-panel', {
        detail: { panelId: branchId },
        bubbles: true
      }))
    }
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
    </div>
  )
}
