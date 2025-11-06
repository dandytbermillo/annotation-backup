'use client'

import React from 'react'
import { Folder, FileText, Eye } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { HOVER_HIGHLIGHT_DURATION_MS } from '@/lib/constants/ui-timings'
import type { LayerContextValue } from '@/components/canvas/layer-provider'
import type { PopupChildNode, PopupData, PreviewEntry } from './types'
import { formatRelativeTime, isFolderNode, isNoteLikeNode } from './helpers'
import { debugLog, isDebugEnabled } from '@/lib/utils/debug-logger'

export interface PopupChildRowOptions {
  previewEntry?: PreviewEntry
  isPanning: boolean
  onHoverFolder?: (
    folder: PopupChildNode,
    event: React.MouseEvent,
    parentPopupId: string,
    isPersistent?: boolean
  ) => void
  onLeaveFolder?: (folderId?: string, parentPopoverId?: string) => void
}

export interface PopupChildRowDeps {
  popupSelections: Map<string, Set<string>>
  draggedItems: Set<string>
  dropTargetId: string | null
  invalidDropTargetId: string | null
  requestPreview: (popupId: string, child: PopupChildNode | null) => void
  popups: Map<string, PopupData>
  hoverHighlightTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>
  setHoverHighlightedPopup: React.Dispatch<React.SetStateAction<string | null>>
  handleDragStart: (popupId: string, childId: string, event: React.DragEvent) => void
  handleDragEnd: () => void
  handleDragOver: (childId: string, isFolder: boolean, event: React.DragEvent) => void
  handleDragLeave: (event: React.DragEvent) => void
  handleDrop: (targetFolderId: string, event: React.DragEvent) => Promise<void>
  handlePreviewTooltipHover: (noteId: string, event: React.MouseEvent) => void | Promise<void>
  handlePreviewTooltipLeave: () => void
  handleItemSelect: (
    popupId: string,
    childId: string,
    siblings: PopupChildNode[],
    event: React.MouseEvent
  ) => void
  popupEditMode: Map<string, boolean>
  handleStartRenameListFolder: (popupId: string, folderId: string, currentName: string) => void
  handleSaveRenameListFolder: () => void
  handleCancelRenameListFolder: () => void
  renamingListFolder: { popupId: string; folderId: string } | null
  renamingListFolderName: string
  setRenamingListFolderName: React.Dispatch<React.SetStateAction<string>>
  renameLoading: boolean
  renameError: string | null
  renameListInputRef: React.RefObject<HTMLInputElement>
  onSelectNote?: (noteId: string) => void
  layerCtx: LayerContextValue | null
}

export const createPopupChildRowRenderer = (
  deps: PopupChildRowDeps
) => (popupId: string, options: PopupChildRowOptions) => (child: PopupChildNode, siblings: PopupChildNode[]) => {
  const {
    popupSelections,
    draggedItems,
    dropTargetId,
    invalidDropTargetId,
    requestPreview,
    popups,
    hoverHighlightTimeoutRef,
    setHoverHighlightedPopup,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePreviewTooltipHover,
    handlePreviewTooltipLeave,
    handleItemSelect,
    popupEditMode,
    handleStartRenameListFolder,
    handleSaveRenameListFolder,
    handleCancelRenameListFolder,
    renamingListFolder,
    renamingListFolderName,
    setRenamingListFolderName,
    renameLoading,
    renameError,
    renameListInputRef,
    onSelectNote,
    layerCtx,
  } = deps

  const { previewEntry, isPanning: rowIsPanning, onHoverFolder, onLeaveFolder } = options

  const noteLike = isNoteLikeNode(child)
  const folderLike = isFolderNode(child)
  const isActivePreview = noteLike && previewEntry?.activeChildId === child.id
  const isSelected = popupSelections.get(popupId)?.has(child.id) ?? false

  const isDragging = draggedItems.has(child.id)
  const isDropTarget = dropTargetId === child.id && folderLike
  const isInvalidDropTarget = invalidDropTargetId === child.id && folderLike

  const triggerPreview = () => {
    if (rowIsPanning || !noteLike) return
    requestPreview(popupId, child)
  }

  const logEyeEvent = (action: string, metadata: Record<string, unknown>) => {
    if (!isDebugEnabled()) return
    void debugLog({
      component: 'PopupOverlayEye',
      action,
      metadata: {
        popupId,
        childId: child.id,
        ...metadata,
      },
    })
  }

  const handleFolderHover = (
    event: React.MouseEvent | React.FocusEvent,
    persistent = false
  ) => {
    if (rowIsPanning || !folderLike) {
      return
    }

    logEyeEvent('hover_start', {
      persistent,
      source: event.type,
      popupCount: popups.size,
    })

    onHoverFolder?.(child, event as React.MouseEvent, popupId, persistent)

    const allPopups = Array.from(popups.values())
    const childPopup = allPopups.find(
      (popup) => popup.folder?.id === child.id || (popup as any).folderId === child.id
    )

    if (childPopup) {
      logEyeEvent('hover_existing_popup', {
        matchedPopupId: childPopup.id,
      })
      if (hoverHighlightTimeoutRef.current) {
        clearTimeout(hoverHighlightTimeoutRef.current)
      }

      setHoverHighlightedPopup(childPopup.id)

      hoverHighlightTimeoutRef.current = setTimeout(() => {
        setHoverHighlightedPopup(null)
        hoverHighlightTimeoutRef.current = null
      }, HOVER_HIGHLIGHT_DURATION_MS)
    } else {
      logEyeEvent('hover_no_popup_found', {
        persistent,
        trackedPopups: popups.size,
      })
    }
  }

  const iconVisibilityClass = isSelected || isActivePreview
    ? 'opacity-100'
    : 'opacity-0 group-hover:opacity-100'

  const conditionalClasses = isInvalidDropTarget
    ? 'bg-red-600 bg-opacity-50 ring-2 ring-red-500 text-white cursor-not-allowed'
    : isDropTarget
      ? 'bg-green-600 bg-opacity-50 ring-2 ring-green-500 text-white'
      : isDragging
        ? 'opacity-50'
        : isSelected
          ? 'bg-indigo-500 bg-opacity-50 text-white'
          : isActivePreview
            ? 'bg-gray-700/70 text-white'
            : 'text-gray-200 hover:bg-gray-700/30'

  const rowClasses = `group px-3 py-2 cursor-pointer flex items-center justify-between text-sm transition-colors ${conditionalClasses}`

  return (
    <div
      key={child.id}
      draggable
      className={rowClasses}
      style={{ transition: rowIsPanning ? 'none' : 'background-color 0.2s' }}
      data-drop-zone={folderLike ? 'true' : undefined}
      onDragStart={(event) => handleDragStart(popupId, child.id, event)}
      onDragEnd={handleDragEnd}
      onDragOver={(event) => {
        if (folderLike) {
          handleDragOver(child.id, folderLike, event)
          event.stopPropagation()
        }
      }}
      onDragLeave={handleDragLeave}
      onDrop={(event) => folderLike && handleDrop(child.id, event)}
      onMouseEnter={(event) => {
        if (noteLike) {
          triggerPreview()
        } else if (folderLike) {
          requestPreview(popupId, null)
        }
      }}
      onFocus={() => {
        if (noteLike) {
          triggerPreview()
        }
      }}
      onClick={(event) => {
        event.stopPropagation()

        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          event.preventDefault()
        }

        handleItemSelect(popupId, child.id, siblings, event)
      }}
      onDoubleClick={() => {
        if (popupEditMode.get(popupId)) {
          if (folderLike || noteLike) {
            handleStartRenameListFolder(popupId, child.id, child.name || '')
            return
          }
        }
        if (noteLike && onSelectNote) {
          if (layerCtx && layerCtx.activeLayer === 'popups') {
            layerCtx.setActiveLayer('notes')
          }
          onSelectNote(child.id)
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()

        if (event.ctrlKey) {
          handleItemSelect(popupId, child.id, siblings, event)
        }
      }}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {folderLike ? (
          <Folder className="w-4 h-4 text-blue-400 flex-shrink-0 fill-blue-400" />
        ) : (
          <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
        {renamingListFolder?.popupId === popupId && renamingListFolder?.folderId === child.id ? (
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <input
              ref={renameListInputRef}
              type="text"
              value={renamingListFolderName}
              onChange={(event) => setRenamingListFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleSaveRenameListFolder()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  handleCancelRenameListFolder()
                }
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              className="px-1.5 py-0.5 text-sm bg-gray-700 border border-blue-500 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={renameLoading}
            />
            {renameError && (
              <span className="text-xs text-red-400">{renameError}</span>
            )}
          </div>
        ) : (
          <span className={`truncate ${folderLike ? 'font-semibold text-blue-100' : ''}`}>{child.name}</span>
        )}
      </div>
      {(child.updatedAt || child.createdAt) && (
        <div className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0 transition-opacity opacity-100 group-hover:opacity-0">
          <span>·</span>
          <span>{formatRelativeTime(child.updatedAt || child.createdAt)}</span>
        </div>
      )}
      <div className={`flex items-center gap-1 transition-opacity ${iconVisibilityClass}`}>
        {noteLike && (
          <button
            type="button"
            aria-label="Preview note"
            className="p-1 rounded hover:bg-gray-700 text-gray-300"
      onMouseEnter={(event) => handlePreviewTooltipHover(child.id, event)}
      onMouseLeave={handlePreviewTooltipLeave}
      onClick={(event) => {
        event.stopPropagation()
        logEyeEvent('note_eye_click', { hasModifier: event.metaKey || event.ctrlKey || event.shiftKey })
        onSelectNote?.(child.id)
      }}
    >
      <Eye className="w-4 h-4 text-white" />
    </button>
        )}
        {folderLike && (
          <div
            onMouseEnter={(event) => handleFolderHover(event, false)}
            onMouseLeave={() => {
              logEyeEvent('hover_leave', {})
              onLeaveFolder?.(child.id, popupId)
            }}
            className="inline-block"
          >
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open folder"
                    className="p-1 rounded hover:bg-gray-700 text-gray-300"
                    onFocus={(event) => handleFolderHover(event, false)}
                    onClick={(event) => {
                      event.stopPropagation()
                      logEyeEvent('click_open_folder', {
                        hasModifier: event.ctrlKey || event.metaKey || event.shiftKey,
                      })
                      handleFolderHover(event, true)
                    }}
                    onBlur={() => {
                      logEyeEvent('hover_blur', {})
                      onLeaveFolder?.(child.id, popupId)
                    }}
                  >
                    <Eye className="w-4 h-4 text-blue-400" />
                  </button>
                </TooltipTrigger>
                <TooltipPortal>
                  <TooltipContent side="right">Open folder</TooltipContent>
                </TooltipPortal>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
    </div>
  )
}
