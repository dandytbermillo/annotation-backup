import React from 'react'
import type { PopupData } from '../types'

export interface PopupCardFooterProps {
  popup: PopupData
  isEditMode: boolean
  hasClosingAncestor: boolean
  isMoveCascadeChild: boolean
  popupSelections: Map<string, Set<string>>
  onDeleteSelected: (popupId: string) => void
  onClearSelection: (popupId: string) => void
  creatingFolderInPopup: string | null
  newFolderName: string
  onChangeNewFolderName: (value: string) => void
  onCancelCreateFolder: () => void
  onSubmitCreateFolder: (popupId: string, folderId: string) => void
  onStartCreateFolder: (popupId: string) => void
  folderCreationLoading: string | null
  folderCreationError: string | null
  onTogglePin?: (popupId: string) => void
}

export const PopupCardFooter: React.FC<PopupCardFooterProps> = ({
  popup,
  isEditMode,
  hasClosingAncestor,
  isMoveCascadeChild,
  popupSelections,
  onDeleteSelected,
  onClearSelection,
  creatingFolderInPopup,
  newFolderName,
  onChangeNewFolderName,
  onCancelCreateFolder,
  onSubmitCreateFolder,
  onStartCreateFolder,
  folderCreationLoading,
  folderCreationError,
  onTogglePin,
}) => {
  const selectedIds = popupSelections.get(popup.id)
  const selectionCount = selectedIds?.size ?? 0
  const folderId = (popup as any).folderId
  const isCreatingHere = creatingFolderInPopup === popup.id
  const isLoading = folderCreationLoading === popup.id

  return (
    <>
      {isEditMode && (
        <div className="px-3 py-2 bg-blue-900/20 border-t border-blue-600/50 flex items-center justify-center">
          <div className="px-3 py-1.5 text-sm font-semibold rounded bg-blue-600 text-white flex items-center gap-2 pointer-events-none">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
            Edit Mode
          </div>
        </div>
      )}
      {!isEditMode && (popup.isHighlighted && hasClosingAncestor || isMoveCascadeChild) && (
        <div className="px-3 py-2 bg-yellow-900/20 border-t border-yellow-600/50 flex items-center justify-center">
          <button
            onClick={event => {
              event.stopPropagation()
              onTogglePin?.(popup.id)
            }}
            onMouseDown={event => event.stopPropagation()}
            className={`px-3 py-1.5 text-sm font-medium rounded transition-all pointer-events-auto ${
              popup.isPinned ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
            }`}
            aria-label={
              popup.isPinned
                ? 'Pinned - will stay open'
                : isMoveCascadeChild
                ? 'Pin this popup to keep it in place while dragging parent'
                : 'Pin to keep open'
            }
          >
            {popup.isPinned ? '📍 Pinned' : isMoveCascadeChild ? '✋ Pin to Stay' : '📌 Pin to Keep Open'}
          </button>
        </div>
      )}
      {selectionCount > 0 && (
        <div className="px-3 py-2 bg-gray-800 border-t border-gray-700 flex items-center justify-between">
          <span className="text-sm text-gray-300">
            {selectionCount} {selectionCount === 1 ? 'item' : 'items'} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={event => {
                event.stopPropagation()
                onDeleteSelected(popup.id)
              }}
              className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 rounded transition-colors"
            >
              Delete
            </button>
            <button
              onClick={event => {
                event.stopPropagation()
                onClearSelection(popup.id)
              }}
              className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}
      <div className="border-t border-gray-700">
        {isCreatingHere ? (
          <div className="px-3 py-2 bg-gray-800">
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={newFolderName}
                onChange={event => onChangeNewFolderName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (folderId) {
                      onSubmitCreateFolder(popup.id, folderId)
                    }
                  } else if (event.key === 'Escape') {
                    onCancelCreateFolder()
                  }
                }}
                placeholder="New folder name"
                className="w-full px-2 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
                disabled={isLoading}
              />
              {folderCreationError && <p className="text-xs text-red-400">{folderCreationError}</p>}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={event => {
                    event.stopPropagation()
                    onCancelCreateFolder()
                  }}
                  className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={event => {
                    event.stopPropagation()
                    if (folderId) {
                      onSubmitCreateFolder(popup.id, folderId)
                    }
                  }}
                  className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isLoading || !newFolderName.trim()}
                >
                  {isLoading ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={event => {
              event.stopPropagation()
              onStartCreateFolder(popup.id)
            }}
            className="w-full px-3 py-2 text-left text-sm text-gray-400 hover:text-white hover:bg-gray-750 transition-colors"
          >
            + New Folder
          </button>
        )}
      </div>
    </>
  )
}
