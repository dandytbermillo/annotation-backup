import React from 'react'
import { X, Folder, FileText, Eye, Home, ChevronRight, Pencil, Hand } from 'lucide-react'
import type { PopupChildNode, PopupData } from '../types'
import { getFolderColorTheme, parseBreadcrumb } from '../helpers'
import { debugLog as baseDebugLog } from '@/lib/utils/debug-logger'

type DebugLogFn = typeof baseDebugLog

export interface PopupCardHeaderProps {
  popup: PopupData
  isEditMode: boolean
  isMoveCascadeParent: boolean
  cascadeChildCount: number
  renamingTitleId: string | null
  renameTitleInputRef: React.MutableRefObject<HTMLInputElement | null>
  renamingTitleName: string
  onRenameTitleNameChange: (value: string) => void
  onSaveRenameTitle: () => void
  onCancelRenameTitle: () => void
  renameLoading: boolean
  renameError: string | null
  onStartRenameTitle: (popupId: string, currentName: string) => void
  onHeaderMouseDown: (popupId: string, event: React.MouseEvent<HTMLDivElement>) => void
  debugLog: DebugLogFn
  breadcrumbDropdownOpen: string | null
  onToggleBreadcrumbDropdown: (popup: PopupData) => void
  ancestorCache: Map<string, PopupChildNode[]>
  loadingAncestors: Set<string>
  onBreadcrumbFolderHover: (ancestor: PopupChildNode, event: React.MouseEvent) => void
  onBreadcrumbFolderHoverLeave: () => void
  onToggleEditMode: (popupId: string) => void
  onConfirmClose?: (popupId: string) => void
  onCancelClose?: (popupId: string) => void
  onInitiateClose?: (popupId: string) => void
  onToggleMoveCascade?: (popupId: string) => void
}

export const PopupCardHeader: React.FC<PopupCardHeaderProps> = ({
  popup,
  isEditMode,
  isMoveCascadeParent,
  cascadeChildCount,
  renamingTitleId,
  renameTitleInputRef,
  renamingTitleName,
  onRenameTitleNameChange,
  onSaveRenameTitle,
  onCancelRenameTitle,
  renameLoading,
  renameError,
  onStartRenameTitle,
  onHeaderMouseDown,
  debugLog,
  breadcrumbDropdownOpen,
  onToggleBreadcrumbDropdown,
  ancestorCache,
  loadingAncestors,
  onBreadcrumbFolderHover,
  onBreadcrumbFolderHoverLeave,
  onToggleEditMode,
  onConfirmClose,
  onCancelClose,
  onInitiateClose,
  onToggleMoveCascade,
}) => {
  const isEditActive = isEditMode
  const isRenaming = renamingTitleId === popup.id
  const isDropdownOpen = breadcrumbDropdownOpen === popup.id
  const colorTheme = getFolderColorTheme(popup.folder?.color)
  const folderPath = (popup.folder as any)?.path || (popup as any).folder?.path
  const folderName = popup.folder?.name || (popup.folderName && popup.folderName.trim()) || 'Loading...'
  const isChildPopup = (popup.level && popup.level > 0) || (popup as any).parentPopupId

  if (isChildPopup && folderName === 'sample') {
    void debugLog({
      component: 'PopupOverlay',
      action: 'sample_popup_color_debug',
      metadata: {
        folderColor: popup.folder?.color,
        colorTheme,
        folderData: popup.folder,
      },
    })
  }

  const renderRenameInput = () => (
    <div className="flex-1 min-w-0 flex flex-col gap-1">
      <input
        ref={renameTitleInputRef}
        type="text"
        value={renamingTitleName}
        onChange={event => onRenameTitleNameChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSaveRenameTitle()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onCancelRenameTitle()
          }
        }}
        onMouseDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        className="px-1.5 py-0.5 text-sm bg-gray-700 border border-blue-500 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
        disabled={renameLoading}
      />
      {renameError && <span className="text-xs text-red-400">{renameError}</span>}
    </div>
  )

  const renderRenameableLabel = (label: string) => (
    <>
      <span className="text-sm font-medium text-white truncate">{label}</span>
      <button
        onClick={event => {
          event.stopPropagation()
          onStartRenameTitle(popup.id, label)
        }}
        onMouseDown={event => event.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-gray-700 rounded pointer-events-auto flex-shrink-0"
        aria-label="Rename folder"
      >
        <Pencil className="w-3 h-3 text-gray-400" />
      </button>
    </>
  )

  const renderBreadcrumbDropdown = () => {
    if (!isDropdownOpen || !popup.folder?.id) {
      return null
    }

    const ancestors = ancestorCache.get(popup.folder.id) || []
    const isLoadingAncestors = loadingAncestors.has(popup.id)

    return (
      <div
        className="absolute top-0 right-full mr-2 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-2 px-3 min-w-[200px]"
        style={{ zIndex: 9999 }}
        data-breadcrumb-dropdown
      >
        <button
          className="absolute -top-2 -right-2 bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-700 rounded-full w-5 h-5 flex items-center justify-center text-xs shadow"
          onClick={event => {
            event.stopPropagation()
            onToggleBreadcrumbDropdown(popup)
          }}
          aria-label="Close path dropdown"
        >
          ×
        </button>
        <div className="text-xs text-gray-400 mb-2">Full path:</div>
        {isLoadingAncestors ? (
          <div className="text-sm text-gray-500">Loading...</div>
        ) : ancestors.length === 0 ? (
          <div className="text-sm text-gray-500">No path available</div>
        ) : (
          <div className="space-y-1">
            {ancestors.map((ancestor, index) => {
              const isLast = index === ancestors.length - 1
              return (
                <div
                  key={ancestor.id}
                  className={`group flex items-center justify-between gap-2 text-sm ${
                    isLast ? 'text-white font-medium' : 'text-gray-300 hover:bg-gray-700/50'
                  } rounded px-1 py-0.5 transition-colors`}
                  style={{ paddingLeft: `${index * 12}px` }}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {isLast && colorTheme ? (
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colorTheme.bg }} />
                    ) : (
                      <span className="flex-shrink-0">{ancestor.icon || '📁'}</span>
                    )}
                    <span className="truncate">{ancestor.name}</span>
                    {isLast && <span className="text-gray-500 ml-1 flex-shrink-0">✓</span>}
                  </div>
                  {!isLast && ancestor.type === 'folder' && ancestor.name !== 'Knowledge Base' && (
                    <button
                      className="flex-shrink-0 p-0.5 opacity-0 group-hover:opacity-100 hover:bg-gray-600 rounded transition-all"
                      onMouseEnter={event => {
                        event.stopPropagation()
                        onBreadcrumbFolderHover(ancestor, event)
                      }}
                      onMouseLeave={() => onBreadcrumbFolderHoverLeave()}
                      aria-label={`Preview ${ancestor.name}`}
                    >
                      <Eye className="w-3 h-3 text-gray-400" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const breadcrumbs = parseBreadcrumb(folderPath, folderName)
  const canLinkCascade = Boolean(onToggleMoveCascade && cascadeChildCount > 0)

  return (
    <div
      className="flex flex-col gap-1 p-3 rounded-t-2xl bg-gradient-to-br from-gray-900 via-gray-900 to-gray-950 border-b border-white/5"
      onMouseDown={event => onHeaderMouseDown(popup.id, event)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isRenaming ? (
            renderRenameInput()
          ) : (
            <>
              <button
                className="px-2 py-1 rounded-full text-xs font-medium text-gray-200 border border-white/10 hover:border-white/30 transition-colors flex items-center gap-2"
                onClick={event => {
                  event.stopPropagation()
                  onToggleBreadcrumbDropdown(popup)
                }}
                data-breadcrumb-toggle
              >
                {colorTheme ? (
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colorTheme.bg }}
                  />
                ) : (
                  <Folder className="w-3 h-3 text-gray-400 flex-shrink-0" />
                )}
                <span className="truncate">{folderName}</span>
              </button>
              <button
                onClick={event => {
                  event.stopPropagation()
                  onStartRenameTitle(popup.id, folderName)
                }}
                onMouseDown={event => event.stopPropagation()}
                className="opacity-70 hover:opacity-100 transition-opacity p-0.5 hover:bg-gray-700 rounded pointer-events-auto flex-shrink-0"
                aria-label="Rename folder"
              >
                <Pencil className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </>
          )}
          <div className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
            <Home className="w-3 h-3 text-gray-500" />
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={`${crumb}-${index}`}>
                <ChevronRight className="w-3 h-3 text-gray-600" />
                <span
                  className={`${
                    index === breadcrumbs.length - 1 ? 'text-white font-medium' : 'text-gray-400'
                  }`}
                >
                  {crumb}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={event => {
              event.stopPropagation()
              onToggleEditMode(popup.id)
            }}
            className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
              isEditActive ? 'bg-blue-500/20 text-blue-200 border border-blue-500/40' : 'text-gray-300 border border-white/10 hover:border-white/30'
            }`}
          >
            Edit
          </button>
          {canLinkCascade && (
            <button
              onClick={event => {
                event.stopPropagation()
                onToggleMoveCascade?.(popup.id)
              }}
              className={`px-2 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
                isMoveCascadeParent
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                  : 'text-gray-300 border border-white/10 hover:border-white/30'
              }`}
            >
              <Hand className="w-3 h-3" />
            {isMoveCascadeParent ? `Linked (${cascadeChildCount})` : 'Link'}
          </button>
          )}
          {onConfirmClose && onCancelClose && onInitiateClose && (
            <button
              onClick={event => {
                event.stopPropagation()
                onInitiateClose?.(popup.id)
              }}
              className="p-1 rounded-full text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
              aria-label="Close popup"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {isDropdownOpen && renderBreadcrumbDropdown()}
    </div>
  )
}
