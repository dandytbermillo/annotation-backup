'use client';

import React, { useEffect, useRef, useMemo, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { CoordinateBridge } from '@/lib/utils/coordinate-bridge';
import { ConnectionLineAdapter } from '@/lib/rendering/connection-line-adapter';
import { Z_INDEX, getPopupZIndex } from '@/lib/constants/z-index';
import { useLayer } from '@/components/canvas/layer-provider';
import { OverlayMinimap } from '@/components/canvas/overlay-minimap';
import { X, Folder, FileText, Eye, Home, ChevronRight, Pencil } from 'lucide-react';
import { VirtualList } from '@/components/canvas/VirtualList';
import { buildMultilinePreview } from '@/lib/utils/branch-preview';
import { debugLog as baseDebugLog, isDebugEnabled } from '@/lib/utils/debug-logger';
import { getUIResourceManager } from '@/lib/ui/resource-manager';
import '@/styles/popup-overlay.css';
import { ensureFloatingOverlayHost, FLOATING_OVERLAY_HOST_ID } from '@/lib/utils/overlay-host';
import { PreviewPopover } from '@/components/shared/preview-popover';
import {
  PREVIEW_HOVER_DELAY_MS,
  FOLDER_PREVIEW_DELAY_MS,
  HOVER_HIGHLIGHT_DURATION_MS,
} from '@/lib/constants/ui-timings';
import {
  AUTO_SCROLL_CONFIG,
  DEFAULT_POPUP_HEIGHT,
  DEFAULT_POPUP_WIDTH,
  IDENTITY_TRANSFORM,
  MAX_POPUP_HEIGHT,
  MAX_POPUP_WIDTH,
  MIN_POPUP_HEIGHT,
  MIN_POPUP_WIDTH,
} from './popupOverlay/constants';
import { clamp, getFolderColorTheme, parseBreadcrumb, isFolderNode, isNoteLikeNode } from './popupOverlay/helpers';
import { createPopupChildRowRenderer, type PopupChildRowOptions } from './popupOverlay/renderPopupChildRow';
import type { PreviewChildEntry, PreviewEntry, PreviewStatus, PopupChildNode, PopupData } from './popupOverlay/types';
export type { PreviewChildEntry, PreviewEntry, PreviewStatus, PopupChildNode, PopupData };

interface PopupCardHeaderProps {
  popup: PopupData;
  isEditMode: boolean;
  renamingTitleId: string | null;
  renameTitleInputRef: React.RefObject<HTMLInputElement>;
  renamingTitleName: string;
  onRenameTitleNameChange: (value: string) => void;
  onSaveRenameTitle: () => void;
  onCancelRenameTitle: () => void;
  renameLoading: boolean;
  renameError: string | null;
  onStartRenameTitle: (popupId: string, currentName: string) => void;
  onHeaderMouseDown: (popupId: string, event: React.MouseEvent<HTMLDivElement>) => void;
  debugLog: typeof baseDebugLog;
  breadcrumbDropdownOpen: string | null;
  onToggleBreadcrumbDropdown: (popup: PopupData) => void;
  ancestorCache: Map<string, PopupChildNode[]>;
  loadingAncestors: Set<string>;
  onBreadcrumbFolderHover: (ancestor: PopupChildNode, event: React.MouseEvent) => void;
  onBreadcrumbFolderHoverLeave: () => void;
  onToggleEditMode: (popupId: string) => void;
  onConfirmClose?: (popupId: string) => void;
  onCancelClose?: (popupId: string) => void;
  onInitiateClose?: (popupId: string) => void;
}

const PopupCardHeader: React.FC<PopupCardHeaderProps> = ({
  popup,
  isEditMode,
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
}) => {
  const isEditActive = isEditMode;
  const isRenaming = renamingTitleId === popup.id;
  const isDropdownOpen = breadcrumbDropdownOpen === popup.id;
  const colorTheme = getFolderColorTheme(popup.folder?.color);
  const folderPath = (popup.folder as any)?.path || (popup as any).folder?.path;
  const folderName = popup.folder?.name || (popup.folderName && popup.folderName.trim()) || 'Loading...';
  const isChildPopup = (popup.level && popup.level > 0) || (popup as any).parentPopupId;

  if (isChildPopup && folderName === 'sample') {
    void debugLog('[PopupOverlay] sample popup color debug', {
      folderColor: popup.folder?.color,
      colorTheme,
      folderData: popup.folder,
    });
  }

  const renderRenameInput = () => (
    <div className="flex-1 min-w-0 flex flex-col gap-1">
      <input
        ref={renameTitleInputRef}
        type="text"
        value={renamingTitleName}
        onChange={(event) => onRenameTitleNameChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSaveRenameTitle();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancelRenameTitle();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        className="px-1.5 py-0.5 text-sm bg-gray-700 border border-blue-500 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
        disabled={renameLoading}
      />
      {renameError && <span className="text-xs text-red-400">{renameError}</span>}
    </div>
  );

  const renderRenameableLabel = (label: string) => (
    <>
      <span className="text-sm font-medium text-white truncate">{label}</span>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onStartRenameTitle(popup.id, label);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-gray-700 rounded pointer-events-auto flex-shrink-0"
        aria-label="Rename folder"
      >
        <Pencil className="w-3 h-3 text-gray-400" />
      </button>
    </>
  );

  const renderBreadcrumbDropdown = () => {
    if (!isDropdownOpen || !popup.folder?.id) {
      return null;
    }

    const ancestors = ancestorCache.get(popup.folder.id) || [];
    const isLoadingAncestors = loadingAncestors.has(popup.id);

    return (
      <div
        className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-2 px-3 min-w-[200px]"
        style={{ zIndex: 9999 }}
        data-breadcrumb-dropdown
      >
        <div className="text-xs text-gray-400 mb-2">Full path:</div>
        {isLoadingAncestors ? (
          <div className="text-sm text-gray-500">Loading...</div>
        ) : ancestors.length === 0 ? (
          <div className="text-sm text-gray-500">No path available</div>
        ) : (
          <div className="space-y-1">
            {ancestors.map((ancestor, index) => {
              const isLast = index === ancestors.length - 1;
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
                      onMouseEnter={(event) => {
                        let inheritedColor = ancestor.color;
                        if (!inheritedColor) {
                          for (let i = index - 1; i >= 0; i -= 1) {
                            if (ancestors[i].color) {
                              inheritedColor = ancestors[i].color;
                              break;
                            }
                          }
                        }
                        const ancestorWithColor = { ...ancestor, color: inheritedColor };
                        onBreadcrumbFolderHover(ancestorWithColor, event);
                      }}
                      onMouseLeave={onBreadcrumbFolderHoverLeave}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Eye className="w-3.5 h-3.5 text-blue-400" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderChildHeader = () => (
    <div className="flex items-center gap-1.5 min-w-0 group">
      {colorTheme ? (
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorTheme.bg }} />
      ) : (
        <Folder className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      )}
      {isRenaming ? renderRenameInput() : renderRenameableLabel(folderName)}
    </div>
  );

  const renderRootHeader = () => {
    const breadcrumbs = parseBreadcrumb(folderPath, folderName);
    return (
      <div className="relative flex items-center gap-1.5 flex-1 min-w-0">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggleBreadcrumbDropdown(popup);
          }}
          className="flex items-center gap-0.5 hover:bg-gray-700 rounded px-1 py-0.5 transition-colors"
          title="Show full path"
          data-breadcrumb-toggle
        >
          <Home className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <ChevronRight className={`w-3 h-3 text-gray-500 transition-transform ${isDropdownOpen ? 'rotate-90' : ''}`} />
        </button>
        {breadcrumbs.map((crumb, index) => (
          <React.Fragment key={index}>
            {index > 0 && <ChevronRight className="w-3 h-3 text-gray-500 flex-shrink-0" />}
            {index === breadcrumbs.length - 1 ? (
              <div className="flex items-center gap-1.5 min-w-0 group">
                {colorTheme ? (
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorTheme.bg }} />
                ) : (
                  <Folder className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                )}
                {isRenaming ? renderRenameInput() : renderRenameableLabel(crumb)}
              </div>
            ) : breadcrumbs.length > 2 && index === 0 ? (
              <span className="text-xs text-gray-500 flex-shrink-0">...</span>
            ) : index >= breadcrumbs.length - 2 ? (
              <span className="text-xs text-gray-400 flex-shrink-0">{crumb}</span>
            ) : null}
          </React.Fragment>
        ))}
        {renderBreadcrumbDropdown()}
      </div>
    );
  };

  return (
    <div
      className={`px-3 py-2 border-b flex items-center justify-between cursor-grab active:cursor-grabbing ${
        isEditActive ? 'border-blue-600 bg-blue-600/20' : 'border-gray-700'
      }`}
      onMouseDown={(event) => onHeaderMouseDown(popup.id, event)}
      style={{
        backgroundColor: popup.isDragging
          ? '#374151'
          : isEditActive
          ? 'rgba(37, 99, 235, 0.15)'
          : 'transparent',
      }}
    >
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {isChildPopup ? renderChildHeader() : renderRootHeader()}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggleEditMode(popup.id);
          }}
          onMouseDown={(event) => event.stopPropagation()}
          className="px-2 py-0.5 text-xs font-medium rounded transition-colors pointer-events-auto"
          style={{
            backgroundColor: isEditActive ? '#3b82f6' : 'transparent',
            color: isEditActive ? '#fff' : '#9ca3af',
            border: `1px solid ${isEditActive ? '#3b82f6' : '#4b5563'}`,
          }}
          aria-label={isEditActive ? 'Exit edit mode' : 'Enter edit mode'}
        >
          {isEditActive ? 'Done' : 'Edit'}
        </button>
        {popup.closeMode === 'closing' ? (
          <>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onConfirmClose?.(popup.id);
              }}
              onMouseDown={(event) => event.stopPropagation()}
              className="px-2 py-0.5 text-xs font-medium rounded transition-colors pointer-events-auto bg-green-600 hover:bg-green-500 text-white"
              aria-label="Confirm close"
            >
              ✓ Done
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onCancelClose?.(popup.id);
              }}
              onMouseDown={(event) => event.stopPropagation()}
              className="px-2 py-0.5 text-xs font-medium rounded transition-colors pointer-events-auto hover:bg-gray-700 text-gray-400"
              aria-label="Cancel close"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onInitiateClose?.(popup.id);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            className="p-0.5 hover:bg-gray-700 rounded pointer-events-auto"
            aria-label="Close popup"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>
    </div>
  );
};

interface PopupCardFooterProps {
  popup: PopupData;
  isEditMode: boolean;
  hasClosingAncestor: boolean;
  popupSelections: Map<string, Set<string>>;
  onDeleteSelected: (popupId: string) => void;
  onClearSelection: (popupId: string) => void;
  creatingFolderInPopup: string | null;
  newFolderName: string;
  onChangeNewFolderName: (value: string) => void;
  onCancelCreateFolder: () => void;
  onSubmitCreateFolder: (popupId: string, folderId: string) => void;
  onStartCreateFolder: (popupId: string) => void;
  folderCreationLoading: string | null;
  folderCreationError: string | null;
  onTogglePin?: (popupId: string) => void;
}

const PopupCardFooter: React.FC<PopupCardFooterProps> = ({
  popup,
  isEditMode,
  hasClosingAncestor,
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
  const selectedIds = popupSelections.get(popup.id);
  const selectionCount = selectedIds?.size ?? 0;
  const folderId = (popup as any).folderId;
  const isCreatingHere = creatingFolderInPopup === popup.id;
  const isLoading = folderCreationLoading === popup.id;

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
      {!isEditMode && popup.isHighlighted && hasClosingAncestor && (
        <div className="px-3 py-2 bg-yellow-900/20 border-t border-yellow-600/50 flex items-center justify-center">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin?.(popup.id);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            className={`px-3 py-1.5 text-sm font-medium rounded transition-all pointer-events-auto ${
              popup.isPinned ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
            }`}
            aria-label={popup.isPinned ? 'Pinned - will stay open' : 'Pin to keep open'}
          >
            {popup.isPinned ? '📍 Pinned' : '📌 Pin to Keep Open'}
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
              onClick={(event) => {
                event.stopPropagation();
                onDeleteSelected(popup.id);
              }}
              className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 rounded transition-colors"
            >
              Delete
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onClearSelection(popup.id);
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
                onChange={(event) => onChangeNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (folderId) {
                      onSubmitCreateFolder(popup.id, folderId);
                    }
                  } else if (event.key === 'Escape') {
                    onCancelCreateFolder();
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
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelCreateFolder();
                  }}
                  className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    if (folderId) {
                      onSubmitCreateFolder(popup.id, folderId);
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
            onClick={(event) => {
              event.stopPropagation();
              onStartCreateFolder(popup.id);
            }}
            className="w-full px-3 py-2 text-left text-sm text-gray-400 hover:text-white hover:bg-gray-750 transition-colors"
          >
            + New Folder
          </button>
        )}
      </div>
    </>
  );
};

interface AutoScrollState {
  isActive: boolean;
  velocity: { x: number; y: number };
  threshold: number;
  minSpeed: number;
  maxSpeed: number;
}

interface PopupOverlayProps {
  popups: Map<string, PopupData>;
  draggingPopup: string | null;
  onClosePopup: (id: string) => void;
  onInitiateClose?: (popupId: string) => void; // NEW: Enter interactive close mode
  onConfirmClose?: (parentId: string) => void; // NEW: Confirm close and remove unpinned children
  onCancelClose?: (parentId: string) => void; // NEW: Cancel close mode
  onTogglePin?: (popupId: string) => void; // NEW: Toggle pin state
  onDragStart?: (id: string, event: React.MouseEvent) => void;
  onHoverFolder?: (folder: any, event: React.MouseEvent, parentPopupId: string, isPersistent?: boolean) => void;
  onLeaveFolder?: (folderId?: string, parentPopoverId?: string) => void;
  onPopupHover?: (folderId: string, parentPopupId?: string) => void; // Cancel close timeout when hovering popup
  onSelectNote?: (noteId: string) => void; // Open note on canvas when eye icon clicked or double-clicked
  onDeleteSelected?: (popupId: string, selectedIds: Set<string>) => void; // Delete multiple selected items
  onBulkMove?: (itemIds: string[], targetFolderId: string, sourcePopupId: string) => Promise<void>; // Move multiple items to target folder
  onFolderCreated?: (popupId: string, newFolder: PopupChildNode) => void; // Called after folder created - parent should update popup children
  onFolderRenamed?: (folderId: string, newName: string) => void; // Called after folder renamed - parent should sync state
  onPopupCardClick?: () => void; // Called when clicking on popup card - used to close floating toolbar
  onContextMenu?: (event: React.MouseEvent) => void; // Handle right-click to show floating toolbar
  onPopupPositionChange?: (
    popupId: string,
    positions: {
      screenPosition?: { x: number; y: number };
      canvasPosition?: { x: number; y: number };
      size?: { width: number; height: number };
    }
  ) => void;
  onResizePopup?: (
    popupId: string,
    size: { width: number; height: number },
    options?: { source: 'auto' | 'user' }
  ) => void;
  isLocked?: boolean;
  sidebarOpen?: boolean; // Track sidebar state to recalculate bounds
  backdropStyle?: string; // Backdrop style preference (from Display Settings panel)
  workspaceId?: string | null;
}

// Format relative time (e.g., "2h ago", "3d ago")
const TOOLTIP_PREVIEW_MAX_LENGTH = Number.MAX_SAFE_INTEGER; // allow full content inside scrollable tooltip

/**
 * PopupOverlay - React component for the popup layer
 * Renders popups and connection lines in a separate layer above the notes canvas
 */
export const PopupOverlay: React.FC<PopupOverlayProps> = ({
  popups,
  draggingPopup,
  onClosePopup,
  onInitiateClose,
  onConfirmClose,
  onCancelClose,
  onTogglePin,
  onDragStart,
  onHoverFolder,
  onLeaveFolder,
  onPopupHover,
  onSelectNote,
  onDeleteSelected,
  onBulkMove,
  onFolderCreated,
  onFolderRenamed,
  onPopupCardClick,
  onContextMenu,
  onPopupPositionChange,
  onResizePopup,
  isLocked = false,
  sidebarOpen, // Accept sidebar state
  backdropStyle = 'opaque', // Backdrop style preference (default to fully opaque)
  workspaceId = null,
}) => {
  const multiLayerEnabled = true;
  const debugLoggingEnabled = isDebugEnabled();
  const overlayFullSpanEnabled =
    (process.env.NEXT_PUBLIC_POPUP_OVERLAY_FULLSPAN ?? 'true').toLowerCase() !== 'false';
  const overlayMinimapEnabled =
    (process.env.NEXT_PUBLIC_OVERLAY_MINIMAP ?? 'false').toLowerCase() === 'true';
  const debugDragTracingEnabled =
    debugLoggingEnabled &&
    ['true', '1', 'on', 'yes'].includes(
      (process.env.NEXT_PUBLIC_DEBUG_POPUP_DRAG_TRACE ?? '').toLowerCase()
    );
  const debugLog = useCallback<typeof baseDebugLog>(
    (...args) => {
      if (!debugLoggingEnabled) {
        return Promise.resolve();
      }
      return baseDebugLog(...args);
    },
    [debugLoggingEnabled]
  );
  const tracePointerLog = useCallback<typeof baseDebugLog>(
    (...args) => {
      if (!debugDragTracingEnabled) {
        return Promise.resolve();
      }
      return baseDebugLog(...args);
    },
    [debugDragTracingEnabled]
  );

  const fetchWithWorkspace = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers ?? {});
      if (workspaceId) {
        headers.set('X-Overlay-Workspace-ID', workspaceId);
      }
      return fetch(input, { ...init, headers });
    },
    [workspaceId]
  );
  const [previewState, setPreviewState] = useState<Record<string, PreviewEntry>>({});
  const previewStateRef = useRef(previewState);
  const previewControllersRef = useRef<Map<string, AbortController>>(new Map());
  useEffect(() => {
    previewStateRef.current = previewState;
  }, [previewState]);

  // Listen for note rename events - delegate to parent for state updates
  const onFolderRenamedRef = useRef(onFolderRenamed);

  // Keep ref in sync with current callback
  useEffect(() => {
    onFolderRenamedRef.current = onFolderRenamed;
  }, [onFolderRenamed]);

  useEffect(() => {
    const handleNoteRenamed = (event: Event) => {
      try {
        const customEvent = event as CustomEvent<{ noteId: string; newTitle: string }>;
        const { noteId, newTitle } = customEvent.detail;

        if (!noteId || !newTitle) {
          console.warn('[PopupOverlay] Invalid rename event data:', { noteId, newTitle });
          return;
        }

        void debugLog('[PopupOverlay] Note renamed event received', { noteId, newTitle });

        // Delegate to parent - parent owns the state, parent updates it
        // This follows React's unidirectional data flow principle
        if (onFolderRenamedRef.current) {
          onFolderRenamedRef.current(noteId, newTitle);
          void debugLog('[PopupOverlay] Delegated rename to parent callback', { noteId });
        } else {
          console.warn('[PopupOverlay] No parent callback available for rename');
        }
      } catch (error) {
        console.error('[PopupOverlay] Error handling note rename event:', error);
        // Don't let event handler errors crash the app
      }
    };

    window.addEventListener('note-renamed', handleNoteRenamed);
    return () => {
      window.removeEventListener('note-renamed', handleNoteRenamed);
    };
  }, []); // Empty deps - listener stays stable, uses ref for callback

  const getBackdropStyle = (style: string) => {
    switch (style) {
      case 'none':
        return {};
      case 'opaque':
        return { backgroundColor: '#111827' };
      case 'subtle':
        return { backgroundColor: 'rgba(0, 0, 0, 0.2)', backdropFilter: 'blur(1px)', WebkitBackdropFilter: 'blur(1px)' };
      case 'moderate':
        return { backgroundColor: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' };
      case 'strong':
        return { backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' };
      case 'blur-only':
        return { backdropFilter: 'blur(4px) brightness(0.8)', WebkitBackdropFilter: 'blur(4px) brightness(0.8)' };
      case 'vignette':
        return { background: 'radial-gradient(circle at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 100%)' };
      case 'dark':
        return { backgroundColor: 'rgba(0, 0, 0, 0.7)' };
      case 'light':
        return { backgroundColor: 'rgba(0, 0, 0, 0.15)' };
      default:
        return {};
    }
  };

  // Note preview tooltip state (plain div like Recent Notes)
  const [activePreviewTooltip, setActivePreviewTooltip] = useState<{
    noteId: string;
    content: string;
    position: { x: number; y: number };
    status: 'loading' | 'ready' | 'error';
  } | null>(null);
  const previewTooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previewTooltipCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isHoveringPreviewTooltipRef = useRef(false);

  // Multi-select state (per popup)
  const [popupSelections, setPopupSelections] = useState<Map<string, Set<string>>>(new Map());

  // Hover-highlight state - temporarily glow child popup when parent folder eye icon is hovered
  const [hoverHighlightedPopup, setHoverHighlightedPopup] = useState<string | null>(null);
  const hoverHighlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup hover highlight timeout on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (hoverHighlightTimeoutRef.current) {
        clearTimeout(hoverHighlightTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = ensureFloatingOverlayHost();
    if (host) {
      setOverlayContainer(host);
    }
  }, []);

  const [lastSelectedIds, setLastSelectedIds] = useState<Map<string, string>>(new Map());

  // Drag and drop state
  const [draggedItems, setDraggedItems] = useState<Set<string>>(new Set());
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [invalidDropTargetId, setInvalidDropTargetId] = useState<string | null>(null); // For red visual feedback
  const [dragSourcePopupId, setDragSourcePopupId] = useState<string | null>(null);
  const [dragSourceFolderId, setDragSourceFolderId] = useState<string | null>(null); // Track source folder ID
  const [isPopupDropTarget, setIsPopupDropTarget] = useState<string | null>(null);

  // Create folder state
  const [creatingFolderInPopup, setCreatingFolderInPopup] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [folderCreationLoading, setFolderCreationLoading] = useState<string | null>(null);
  const [folderCreationError, setFolderCreationError] = useState<string | null>(null);

  // Inline rename state
  const [popupEditMode, setPopupEditMode] = useState<Map<string, boolean>>(new Map()); // Edit mode per popup
  const [renamingTitle, setRenamingTitle] = useState<string | null>(null); // Popup ID being renamed (title)
  const [renamingTitleName, setRenamingTitleName] = useState('');
  const [renamingListFolder, setRenamingListFolder] = useState<{popupId: string, folderId: string} | null>(null); // Folder in list being renamed
  const [renamingListFolderName, setRenamingListFolderName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const renameTitleInputRef = useRef<HTMLInputElement>(null);
  const renameListInputRef = useRef<HTMLInputElement>(null);

  // Breadcrumb dropdown state
  const [breadcrumbDropdownOpen, setBreadcrumbDropdownOpen] = useState<string | null>(null); // popup ID
  const [ancestorCache, setAncestorCache] = useState<Map<string, PopupChildNode[]>>(new Map());
  const [loadingAncestors, setLoadingAncestors] = useState<Set<string>>(new Set());

  // Breadcrumb folder preview tooltip state
  const [breadcrumbFolderPreview, setBreadcrumbFolderPreview] = useState<{
    folderId: string;
    folderName: string;
    folderColor?: string;
    position: { x: number; y: number };
    children: PopupChildNode[];
    isLoading: boolean;
  } | null>(null);
  const breadcrumbPreviewTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      previewControllersRef.current.forEach((controller) => {
        try { controller.abort(); } catch {}
      });
      previewControllersRef.current.clear();
    };
  }, []);

  const fetchPreview = useCallback(async (popupId: string, childId: string) => {
    const controllerKey = `${popupId}:${childId}`;
    const existingController = previewControllersRef.current.get(controllerKey);
    if (existingController) {
      try { existingController.abort(); } catch {}
    }

    const controller = new AbortController();
    previewControllersRef.current.set(controllerKey, controller);

    try {
      const response = await fetchWithWorkspace(`/api/items/${childId}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const data = await response.json();
      const content = data?.item?.content ?? null;
      const contentText = data?.item?.contentText ?? '';
      const previewText = buildMultilinePreview(content, contentText || '', TOOLTIP_PREVIEW_MAX_LENGTH);

    if (debugLoggingEnabled) {
      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'preview_fetch_success', {
          popupId,
          childId,
          hasContent: Boolean(content),
          hasContentText: Boolean(contentText && contentText.trim().length),
          contentType: typeof content,
          previewLength: previewText.length,
        });
      });
    }

      setPreviewState(prev => {
        const entry = prev[popupId] ?? { activeChildId: null, entries: {} };
        return {
          ...prev,
          [popupId]: {
            activeChildId: entry.activeChildId ?? childId,
            entries: {
              ...entry.entries,
              [childId]: {
                status: 'ready',
                content: content ?? contentText ?? null,
                previewText,
                requestedAt: undefined,
              },
            },
          },
        };
      });
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return;
      }
      if (debugLoggingEnabled) {
        getUIResourceManager().enqueueLowPriority(() => {
          debugLog('PopupOverlay', 'preview_fetch_error', {
            popupId,
            childId,
            message: error?.message ?? 'Unknown error',
          });
        });
      }
      setPreviewState(prev => {
        const entry = prev[popupId] ?? { activeChildId: null, entries: {} };
        return {
          ...prev,
          [popupId]: {
            activeChildId: entry.activeChildId ?? childId,
            entries: {
              ...entry.entries,
              [childId]: {
                status: 'error',
                error: error?.message ?? 'Failed to load preview',
                previewText: entry.entries[childId]?.previewText,
                requestedAt: undefined,
              },
            },
          },
        };
      });
    } finally {
      previewControllersRef.current.delete(controllerKey);
    }
  }, []);

  const requestPreview = useCallback((popupId: string, child: PopupChildNode | null) => {
    if (!child) {
      setPreviewState(prev => {
        const entry = prev[popupId];
        if (!entry || entry.activeChildId === null) {
          return prev;
        }
        return {
          ...prev,
          [popupId]: {
            ...entry,
            activeChildId: null,
          },
        };
      });
      return;
    }

    if (!isNoteLikeNode(child)) {
      setPreviewState(prev => {
        const entry = prev[popupId];
        if (!entry || entry.activeChildId === child.id) {
          return prev;
        }
        return {
          ...prev,
          [popupId]: {
            ...entry,
            activeChildId: child.id,
          },
        };
      });
      return;
    }

    const latestEntry = previewStateRef.current[popupId];
    const latestChildEntry = latestEntry?.entries?.[child.id];
    const now = Date.now();
    const loadingTooLong = latestChildEntry?.status === 'loading'
      && typeof latestChildEntry.requestedAt === 'number'
      && now - latestChildEntry.requestedAt > 1500;
    const shouldFetch = !latestChildEntry
      || latestChildEntry.status === 'error'
      || latestChildEntry.status === 'idle'
      || loadingTooLong;

    if (debugLoggingEnabled) {
      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'preview_request', {
          popupId,
          childId: child.id,
          shouldFetch,
          existingStatus: latestChildEntry?.status ?? 'none',
          loadingTooLong,
        });
      });
    }

    setPreviewState(prev => {
      const previousEntry: PreviewEntry =
        prev[popupId] ?? { activeChildId: null, entries: {} as Record<string, PreviewChildEntry> };
      const prevChild: PreviewChildEntry | undefined = previousEntry.entries[child.id];

      const nextChildEntry: PreviewChildEntry = shouldFetch
        ? {
            status: 'loading',
            content: prevChild?.content,
            previewText: prevChild?.previewText,
            error: undefined,
            requestedAt: now,
          }
        : prevChild ?? { status: 'loading', content: undefined, previewText: undefined };

      return {
        ...prev,
        [popupId]: {
          activeChildId: child.id,
          entries: {
            ...previousEntry.entries,
            [child.id]: nextChildEntry,
          },
        },
      };
    });

    if (shouldFetch) {
      fetchPreview(popupId, child.id);
    } else if (latestChildEntry?.previewText) {
      if (debugLoggingEnabled) {
        getUIResourceManager().enqueueLowPriority(() => {
          debugLog('PopupOverlay', 'preview_cache_hit', {
            popupId,
            childId: child.id,
            status: latestChildEntry.status,
          });
        });
      }
    }
  }, [fetchPreview]);

  // Handle item selection (notes/folders) with keyboard modifiers
  const handleItemSelect = useCallback((
    popupId: string,
    childId: string,
    children: PopupChildNode[],
    event: React.MouseEvent
  ) => {
    const isMultiSelect = event.metaKey || event.ctrlKey;
    const isShiftSelect = event.shiftKey;

    if (isMultiSelect) {
      // Ctrl/Cmd+Click: Toggle selection
      setPopupSelections(prev => {
        const next = new Map(prev);
        const currentSelection = new Set(prev.get(popupId) || []);

        if (currentSelection.has(childId)) {
          currentSelection.delete(childId);
        } else {
          currentSelection.add(childId);
        }

        next.set(popupId, currentSelection);
        return next;
      });

      setLastSelectedIds(prev => {
        const next = new Map(prev);
        next.set(popupId, childId);
        return next;
      });
    } else if (isShiftSelect) {
      // Shift+Click: Range selection
      const lastId = lastSelectedIds.get(popupId);
      if (!lastId) {
        // No previous selection, just select this item
        setPopupSelections(prev => {
          const next = new Map(prev);
          next.set(popupId, new Set([childId]));
          return next;
        });
        setLastSelectedIds(prev => {
          const next = new Map(prev);
          next.set(popupId, childId);
          return next;
        });
        return;
      }

      // Find indices
      const startIndex = children.findIndex(c => c.id === lastId);
      const endIndex = children.findIndex(c => c.id === childId);

      if (startIndex === -1 || endIndex === -1) {
        // Fallback to single selection
        setPopupSelections(prev => {
          const next = new Map(prev);
          next.set(popupId, new Set([childId]));
          return next;
        });
        return;
      }

      // Select range
      const minIndex = Math.min(startIndex, endIndex);
      const maxIndex = Math.max(startIndex, endIndex);
      const rangeIds = children
        .slice(minIndex, maxIndex + 1)
        .map(c => c.id);

      setPopupSelections(prev => {
        const next = new Map(prev);
        next.set(popupId, new Set(rangeIds));
        return next;
      });
    } else {
      // Regular click: Single selection
      setPopupSelections(prev => {
        const next = new Map(prev);
        next.set(popupId, new Set([childId]));
        return next;
      });

      setLastSelectedIds(prev => {
        const next = new Map(prev);
        next.set(popupId, childId);
        return next;
      });
    }
  }, [lastSelectedIds]);

  // Clear selection for a specific popup
  const handleClearSelection = useCallback((popupId: string) => {
    setPopupSelections(prev => {
      const next = new Map(prev);
      next.delete(popupId);
      return next;
    });
    setLastSelectedIds(prev => {
      const next = new Map(prev);
      next.delete(popupId);
      return next;
    });
  }, []);

  // Delete selected items
  const handleDeleteSelected = useCallback((popupId: string) => {
    const selectedIds = popupSelections.get(popupId);
    if (!selectedIds || selectedIds.size === 0) return;

    const count = selectedIds.size;
    const confirmMsg = `Delete ${count} ${count === 1 ? 'item' : 'items'}?`;

    if (confirm(confirmMsg)) {
      // Call parent callback if provided
      onDeleteSelected?.(popupId, selectedIds);

      // Clear selection after delete
      handleClearSelection(popupId);
    }
  }, [popupSelections, onDeleteSelected, handleClearSelection]);

  // Create new folder
  const handleCreateFolder = useCallback(async (popupId: string, parentFolderId: string) => {
    const trimmedName = newFolderName.trim();

    // Validation
    if (!trimmedName) {
      setFolderCreationError('Folder name cannot be empty');
      return;
    }

    if (trimmedName.length > 255) {
      setFolderCreationError('Folder name is too long (max 255 characters)');
      return;
    }

    // Check for duplicate names in current folder
    const popup = popups.get(popupId);
    const children = popup?.folder?.children || [];
    const duplicateName = children.some(
      (child: PopupChildNode) =>
        isFolderNode(child) &&
        child.name?.toLowerCase() === trimmedName.toLowerCase()
    );

    if (duplicateName) {
      setFolderCreationError('A folder with this name already exists');
      return;
    }

    setFolderCreationLoading(popupId);
    setFolderCreationError(null);

    try {
      const response = await fetchWithWorkspace('/api/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          type: 'folder',
          name: trimmedName,
          parentId: parentFolderId,
          ...(workspaceId ? { workspaceId } : {}),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to create folder: ${response.status}`);
      }

      const data = await response.json();

      // Success - clear form and close input
      setNewFolderName('');
      setCreatingFolderInPopup(null);
      setFolderCreationError(null);

      // Notify parent to update popup children with new folder
      if (onFolderCreated && data.item) {
        const newFolder: PopupChildNode = {
          id: data.item.id,
          type: data.item.type || 'folder',
          name: data.item.name || trimmedName,
          parentId: parentFolderId,
          hasChildren: false,
        };
        onFolderCreated(popupId, newFolder);

        // Highlight the newly created folder
        setPopupSelections(prev => {
          const next = new Map(prev);
          next.set(popupId, new Set([data.item.id]));
          return next;
        });

        // Set as last selected for shift-click range selection
        setLastSelectedIds(prev => {
          const next = new Map(prev);
          next.set(popupId, data.item.id);
          return next;
        });
      }

      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'folder_created', {
          popupId,
          parentFolderId,
          newFolderId: data.item?.id,
          name: trimmedName,
        });
      });

    } catch (error: any) {
      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'folder_creation_error', {
          popupId,
          parentFolderId,
          error: error?.message || 'Unknown error',
        });
      });
      setFolderCreationError(error?.message || 'Failed to create folder');
    } finally {
      setFolderCreationLoading(null);
    }
  }, [newFolderName, popups]);

  // Cancel folder creation
  const handleCancelCreateFolder = useCallback(() => {
    setCreatingFolderInPopup(null);
    setNewFolderName('');
    setFolderCreationError(null);
  }, []);

  // Start folder creation
  const handleStartCreateFolder = useCallback((popupId: string) => {
    setCreatingFolderInPopup(popupId);
    setNewFolderName('');
    setFolderCreationError(null);
  }, []);

  // === Inline Rename Handlers ===

  // Toggle edit mode for a popup
  const handleToggleEditMode = useCallback((popupId: string) => {
    setPopupEditMode(prev => {
      const newMap = new Map(prev);
      const wasInEditMode = prev.get(popupId);
      newMap.set(popupId, !wasInEditMode);

      // CRITICAL: When exiting edit mode (Done button clicked), cancel any active rename operations
      // This ensures input fields are unfocused and rename state is cleared
      if (wasInEditMode) {
        // Cancel popup title rename if active
        if (renamingTitle === popupId) {
          setRenamingTitle(null);
          setRenamingTitleName('');
          setRenameError(null);
        }

        // Cancel list folder/file rename if active in this popup
        if (renamingListFolder?.popupId === popupId) {
          setRenamingListFolder(null);
          setRenamingListFolderName('');
          setRenameError(null);
        }
      }

      return newMap;
    });
  }, [renamingTitle, renamingListFolder]);

  // Start renaming popup title
  const handleStartRenameTitle = useCallback((popupId: string, currentName: string) => {
    setRenamingTitle(popupId);
    setRenamingTitleName(currentName);
    setRenameError(null);
    setTimeout(() => renameTitleInputRef.current?.select(), 0);
  }, []);

  // Save renamed popup title
  const handleSaveRenameTitle = useCallback(async () => {
    if (!renamingTitle) return;

    const trimmedName = renamingTitleName.trim();

    // Empty check
    if (!trimmedName) {
      setRenameError('Folder name cannot be empty');
      return;
    }

    // Find current folder
    const popup = popups.get(renamingTitle);
    if (!popup?.folder) {
      setRenameError('Folder not found');
      return;
    }

    // No-change check
    if (popup.folder.name === trimmedName) {
      handleCancelRenameTitle();
      return;
    }

    // Duplicate check - check siblings
    const parentId = popup.folder.parent_id;
    const siblings = Array.from(popups.values())
      .map(p => p.folder)
      .filter(f => f && f.parent_id === parentId);

    const duplicate = siblings.find(f =>
      f && f.id !== popup.folder!.id &&
      f.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (duplicate) {
      setRenameError('A folder with this name already exists');
      return;
    }

    // Save to API
    setRenameLoading(true);
    setRenameError(null);

    try {
      const response = await fetchWithWorkspace(`/api/items/${popup.folder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          ...(workspaceId ? { workspaceId } : {}),
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to rename folder');
      }

      // Update local popup folder name immediately (optimistic update)
      popup.folder.name = trimmedName;

      // Notify parent of rename (for syncing with org panel and other popups)
      if (onFolderRenamed) {
        onFolderRenamed(popup.folder.id, trimmedName);
      }

      handleCancelRenameTitle();
    } catch (error) {
      console.error('Failed to rename folder:', error);
      setRenameError(error instanceof Error ? error.message : 'Failed to rename');
    } finally {
      setRenameLoading(false);
    }
  }, [renamingTitle, renamingTitleName, popups, onFolderRenamed]);

  // Cancel renaming popup title
  const handleCancelRenameTitle = useCallback(() => {
    setRenamingTitle(null);
    setRenamingTitleName('');
    setRenameError(null);
  }, []);

  // Start renaming folder in list
  const handleStartRenameListFolder = useCallback((popupId: string, folderId: string, currentName: string) => {
    setRenamingListFolder({ popupId, folderId });
    setRenamingListFolderName(currentName);
    setRenameError(null);
    setTimeout(() => renameListInputRef.current?.select(), 0);
  }, []);

  // Save renamed list folder
  const handleSaveRenameListFolder = useCallback(async () => {
    if (!renamingListFolder) return;

    const trimmedName = renamingListFolderName.trim();

    // Empty check
    if (!trimmedName) {
      setRenameError('Folder name cannot be empty');
      return;
    }

    // Find current folder
    const popup = popups.get(renamingListFolder.popupId);
    if (!popup?.folder?.children) {
      setRenameError('Folder not found');
      return;
    }

    const currentFolder = popup.folder.children.find((c: PopupChildNode) => c.id === renamingListFolder.folderId);
    if (!currentFolder) {
      setRenameError('Folder not found');
      return;
    }

    // No-change check
    if (currentFolder.name === trimmedName) {
      handleCancelRenameListFolder();
      return;
    }

    // Duplicate check - check siblings in same popup
    const duplicate = popup.folder.children.find((c: PopupChildNode) =>
      c.id !== renamingListFolder.folderId &&
      c.name?.toLowerCase() === trimmedName.toLowerCase()
    );

    if (duplicate) {
      setRenameError('A folder with this name already exists');
      return;
    }

    // Save to API
    setRenameLoading(true);
    setRenameError(null);

    try {
      const response = await fetchWithWorkspace(`/api/items/${renamingListFolder.folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          ...(workspaceId ? { workspaceId } : {}),
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to rename folder');
      }

      // Update local popup children immediately (optimistic update)
      popup.folder.children = popup.folder.children.map((child: PopupChildNode) =>
        child.id === renamingListFolder.folderId
          ? { ...child, name: trimmedName }
          : child
      );

      // Notify parent of rename (for syncing with org panel and other popups)
      if (onFolderRenamed) {
        onFolderRenamed(renamingListFolder.folderId, trimmedName);
      }

      // Emit event for canvas panels to update in real-time
      // CRITICAL: Wrapped in try/catch to prevent rare dispatch failures from breaking rename flow
      // Database is already committed at this point, so event dispatch is non-critical
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('note-renamed', {
            detail: { noteId: renamingListFolder.folderId, newTitle: trimmedName }
          }));
          void debugLog('[PopupOverlay] Emitted note-renamed event', {
            noteId: renamingListFolder.folderId,
            newTitle: trimmedName,
          });
        } catch (dispatchError) {
          // Non-critical: Event dispatch failed, but database update succeeded
          // Canvas panels will get the correct title on next load/reload
          console.error('[PopupOverlay] Failed to dispatch note-renamed event:', dispatchError);
        }
      }

      handleCancelRenameListFolder();
    } catch (error) {
      console.error('Failed to rename folder:', error);
      setRenameError(error instanceof Error ? error.message : 'Failed to rename');
    } finally {
      setRenameLoading(false);
    }
  }, [renamingListFolder, renamingListFolderName, popups, onFolderRenamed]);

  // Cancel renaming list folder
  const handleCancelRenameListFolder = useCallback(() => {
    setRenamingListFolder(null);
    setRenamingListFolderName('');
    setRenameError(null);
  }, []);

  // Fetch ancestor chain for breadcrumb dropdown
  const fetchAncestors = useCallback(async (folderId: string, popupId: string): Promise<PopupChildNode[]> => {
    // Check cache first
    const cached = ancestorCache.get(folderId);
    if (cached) {
      void debugLog('[PopupOverlay] Using cached ancestors', { folderId });
      return cached;
    }

    void debugLog('[PopupOverlay] Fetching ancestors for folder', { folderId });
    setLoadingAncestors(prev => new Set(prev).add(popupId));

    try {
      const ancestors: PopupChildNode[] = [];
      let currentId = folderId;
      let depth = 0;
      const maxDepth = 10;

      while (currentId && depth < maxDepth) {
        const response = await fetchWithWorkspace(`/api/items/${currentId}`);
        if (!response.ok) {
          console.error('[fetchAncestors] Failed to fetch folder:', currentId, response.status);
          break;
        }

        const data = await response.json();
        const folder = data.item || data;

        // Add to front (reverse order so root is first)
        ancestors.unshift({
          id: folder.id,
          name: folder.name,
          type: 'folder' as const,
          icon: folder.icon || '📁',
          color: folder.color,
          path: folder.path,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          hasChildren: true,
          level: depth,
          children: [],
          parentId: folder.parentId
        });

        void debugLog('[PopupOverlay] Added ancestor', {
          folderName: folder.name,
          path: folder.path,
          depth,
        });

        // Stop at Knowledge Base root
        if (!folder.parentId || folder.path === '/knowledge-base') {
          void debugLog('[PopupOverlay] Reached root ancestor', { folderId });
          break;
        }

        currentId = folder.parentId;
        depth++;
      }

      void debugLog('[PopupOverlay] Fetched ancestors', {
        folderId,
        ancestorCount: ancestors.length,
      });

      // Cache the result
      setAncestorCache(prev => new Map(prev).set(folderId, ancestors));

      return ancestors;
    } catch (error) {
      console.error('[fetchAncestors] Error fetching ancestors:', error);
      return [];
    } finally {
      setLoadingAncestors(prev => {
        const next = new Set(prev);
        next.delete(popupId);
        return next;
      });
    }
  }, [ancestorCache]);

  // Toggle breadcrumb dropdown
  const handleToggleBreadcrumbDropdown = useCallback(async (popup: PopupData) => {
    const isOpen = breadcrumbDropdownOpen === popup.id;

    if (isOpen) {
      // Close dropdown
      void debugLog('[PopupOverlay] Closing breadcrumb dropdown', { popupId: popup.id, folderName: popup.folderName });
      setBreadcrumbDropdownOpen(null);
    } else {
      // Open dropdown and fetch ancestors
      void debugLog('[PopupOverlay] Opening breadcrumb dropdown', { popupId: popup.id, folderName: popup.folderName });
      setBreadcrumbDropdownOpen(popup.id);

      if (popup.folder?.id) {
        await fetchAncestors(popup.folder.id, popup.id);
      }
    }
  }, [breadcrumbDropdownOpen, fetchAncestors]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!breadcrumbDropdownOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is outside dropdown and not on the toggle button
      if (!target.closest('[data-breadcrumb-dropdown]') && !target.closest('[data-breadcrumb-toggle]')) {
        setBreadcrumbDropdownOpen(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [breadcrumbDropdownOpen]);

  // Breadcrumb folder preview hover handler
  const handleBreadcrumbFolderHover = useCallback(async (ancestor: PopupChildNode, event: React.MouseEvent) => {
    event.stopPropagation();

    // Clear any pending timeout
    if (breadcrumbPreviewTimeoutRef.current) {
      clearTimeout(breadcrumbPreviewTimeoutRef.current);
      breadcrumbPreviewTimeoutRef.current = null;
    }

    // Get button position
    const rect = event.currentTarget.getBoundingClientRect();

    // Calculate popup position - prefer right side
    const spaceRight = window.innerWidth - rect.right;
    let position = { x: 0, y: 0 };

    if (spaceRight > 320) {
      position.x = rect.right + 10;
      position.y = rect.top;
    } else {
      position.x = rect.left;
      position.y = rect.bottom + 10;
    }

    // Create preview with loading state
    setBreadcrumbFolderPreview({
      folderId: ancestor.id,
      folderName: ancestor.name || 'Untitled',
      folderColor: ancestor.color || undefined,
      position,
      children: [],
      isLoading: true
    });

    // Fetch folder children
    try {
      const response = await fetchWithWorkspace(`/api/items?parentId=${ancestor.id}`);
      if (!response.ok) throw new Error('Failed to fetch folder contents');

      const data = await response.json();
      const children = data.items || [];

      const formattedChildren: PopupChildNode[] = children.map((item: any) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
        color: item.color || ancestor.color,
        hasChildren: item.type === 'folder'
      }));

      setBreadcrumbFolderPreview(prev => prev ? { ...prev, children: formattedChildren, isLoading: false } : null);
    } catch (error) {
      console.error('[BreadcrumbPreview] Error fetching folder contents:', error);
      setBreadcrumbFolderPreview(null);
    }
  }, []);

  // Breadcrumb folder preview hover leave handler
  const handleBreadcrumbFolderHoverLeave = useCallback(() => {
    breadcrumbPreviewTimeoutRef.current = setTimeout(() => {
      setBreadcrumbFolderPreview(null);
    }, FOLDER_PREVIEW_DELAY_MS);
  }, []);

  // Cancel close timeout when hovering preview
  const handleBreadcrumbPreviewHover = useCallback(() => {
    if (breadcrumbPreviewTimeoutRef.current) {
      clearTimeout(breadcrumbPreviewTimeoutRef.current);
      breadcrumbPreviewTimeoutRef.current = null;
    }
  }, []);

  // Preview tooltip handlers (plain div like Recent Notes)
  const handlePreviewTooltipHover = useCallback(async (noteId: string, event: React.MouseEvent) => {
    // Clear existing timeouts
    if (previewTooltipTimeoutRef.current) {
      clearTimeout(previewTooltipTimeoutRef.current);
    }
    if (previewTooltipCloseTimeoutRef.current) {
      clearTimeout(previewTooltipCloseTimeoutRef.current);
    }

    isHoveringPreviewTooltipRef.current = false;

    // Capture position immediately
    const rect = event.currentTarget.getBoundingClientRect();
    const position = {
      x: rect.right + 10, // 10px right of eye icon
      y: rect.top
    };

    // Show preview after 500ms (same as Recent Notes)
    previewTooltipTimeoutRef.current = setTimeout(async () => {
      setActivePreviewTooltip({
        noteId,
        content: '',
        position,
        status: 'loading'
      });

      try {
        const response = await fetchWithWorkspace(`/api/items/${noteId}`);
        if (!response.ok) throw new Error('Failed to fetch note');

        const data = await response.json();
        const content = data?.item?.content;
        const contentText = data?.item?.contentText;

        // Pass full content to PreviewPopover - no hardcoded limit
        // Component will handle truncation (initial 300 chars, expand to show all content)
        // Component's internal safety cap of 5000 chars applies when not using lazy loading
        const previewText = buildMultilinePreview(content, contentText || '', Number.MAX_SAFE_INTEGER);

        setActivePreviewTooltip({
          noteId,
          content: previewText || 'No content yet',
          position,
          status: 'ready'
        });
      } catch (error) {
        console.error('[PopupOverlay] Failed to fetch preview:', error);
        setActivePreviewTooltip({
          noteId,
          content: 'Failed to load preview',
          position,
          status: 'error'
        });
      }
    }, 500);
  }, []);

  const handlePreviewTooltipLeave = useCallback(() => {
    if (previewTooltipTimeoutRef.current) {
      clearTimeout(previewTooltipTimeoutRef.current);
    }

    // Delay closing to allow moving mouse to tooltip
    previewTooltipCloseTimeoutRef.current = setTimeout(() => {
      if (!isHoveringPreviewTooltipRef.current) {
        setActivePreviewTooltip(null);
      }
    }, PREVIEW_HOVER_DELAY_MS);
  }, []);

  const handlePreviewTooltipEnter = useCallback(() => {
    isHoveringPreviewTooltipRef.current = true;
    if (previewTooltipCloseTimeoutRef.current) {
      clearTimeout(previewTooltipCloseTimeoutRef.current);
    }
  }, []);

  const handlePreviewTooltipMouseLeave = useCallback(() => {
    isHoveringPreviewTooltipRef.current = false;

    // Delay closing to allow moving mouse back to preview
    previewTooltipCloseTimeoutRef.current = setTimeout(() => {
      setActivePreviewTooltip(null);
    }, PREVIEW_HOVER_DELAY_MS);
  }, []);

  // Drag and drop handlers

  const handleDragStart = useCallback((
    popupId: string,
    childId: string,
    event: React.DragEvent
  ) => {
    // Get items to drag (selected items if dragged item is selected, otherwise just this one)
    const selectedInPopup = popupSelections.get(popupId) || new Set();
    const itemsToDrag = selectedInPopup.has(childId) ? selectedInPopup : new Set([childId]);

    setDraggedItems(itemsToDrag);
    setDragSourcePopupId(popupId);

    // Track source folder ID to prevent dropping into same folder
    const sourcePopup = popups.get(popupId);
    const sourceFolderId = sourcePopup ? (sourcePopup as any).folderId : null;
    setDragSourceFolderId(sourceFolderId);

    // Set drag data
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', Array.from(itemsToDrag).join(','));

    // Custom drag preview for multiple items
    if (itemsToDrag.size > 1) {
      const dragPreview = document.createElement('div');
      dragPreview.className = 'bg-indigo-600 text-white px-2 py-1 rounded text-sm';
      dragPreview.textContent = `${itemsToDrag.size} items`;
      dragPreview.style.position = 'absolute';
      dragPreview.style.top = '-1000px';
      document.body.appendChild(dragPreview);
      event.dataTransfer.setDragImage(dragPreview, 0, 0);
      setTimeout(() => document.body.removeChild(dragPreview), 0);
    }
  }, [popupSelections, popups]);

  const handleDragOver = useCallback((
    childId: string,
    isFolder: boolean,
    event: React.DragEvent
  ) => {
    if (!isFolder) return; // Only folders are drop targets

    event.preventDefault();

    // Check if this is an invalid drop:
    // 1. Dropping folder into itself (childId in draggedItems)
    // 2. Dropping items back into their source folder (childId === dragSourceFolderId)
    const isInvalid = draggedItems.has(childId) || childId === dragSourceFolderId;

    if (isInvalid) {
      event.dataTransfer.dropEffect = 'none';
      setInvalidDropTargetId(childId);
      setDropTargetId(null);
    } else {
      event.dataTransfer.dropEffect = 'move';
      setDropTargetId(childId);
      setInvalidDropTargetId(null);
    }
  }, [draggedItems, dragSourceFolderId]);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    const related = event.relatedTarget as HTMLElement;
    if (!related || !related.closest('[data-drop-zone]')) {
      setDropTargetId(null);
      setInvalidDropTargetId(null);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedItems(new Set());
    setDropTargetId(null);
    setInvalidDropTargetId(null);
    setDragSourcePopupId(null);
    setDragSourceFolderId(null);
  }, []);

  const handleDrop = useCallback(async (
    targetFolderId: string,
    event: React.DragEvent
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const itemIds = Array.from(draggedItems);
    if (itemIds.length === 0) return;

    // Don't allow dropping on itself
    if (itemIds.includes(targetFolderId)) {
      setDropTargetId(null);
      return;
    }

    // Find target popup ID (popup that contains this folder)
    let targetPopupId: string | null = null;
    popups.forEach((popup, popupId) => {
      if ((popup as any).folderId === targetFolderId) {
        targetPopupId = popupId;
      }
    });

    // Call parent callback to handle move
    if (onBulkMove && dragSourcePopupId) {
      await onBulkMove(itemIds, targetFolderId, dragSourcePopupId);
    }

    // Clear selection from source popup and set in target popup
    setPopupSelections(prev => {
      const next = new Map(prev);
      // Clear source popup selection
      if (dragSourcePopupId) {
        next.delete(dragSourcePopupId);
      }
      // Set moved items as selected in target popup
      if (targetPopupId) {
        next.set(targetPopupId, new Set(itemIds));
      }
      return next;
    });

    // Clear drag state
    handleDragEnd();
  }, [draggedItems, dragSourcePopupId, onBulkMove, handleDragEnd, popups]);

  // Popup container drop handlers (for dropping on popup background/empty space)
  const handlePopupDragOver = useCallback((
    popupId: string,
    folderId: string,
    event: React.DragEvent
  ) => {
    // Only if dragging is active
    if (draggedItems.size === 0) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setIsPopupDropTarget(popupId);
  }, [draggedItems]);

  const handlePopupDragLeave = useCallback((
    popupId: string,
    event: React.DragEvent
  ) => {
    // Check if really leaving popup (not just entering child)
    const related = event.relatedTarget as HTMLElement;
    if (!related || !related.closest(`[data-popup-id="${popupId}"]`)) {
      setIsPopupDropTarget(null);
    }
  }, []);

  const handlePopupDrop = useCallback(async (
    folderId: string,
    popupId: string,
    event: React.DragEvent
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const itemIds = Array.from(draggedItems);
    if (itemIds.length === 0) return;

    // Don't allow dropping on itself (same guard as handleDrop)
    if (itemIds.includes(folderId)) {
      setIsPopupDropTarget(null);
      return;
    }

    // Use popup's folderId as target
    if (onBulkMove && dragSourcePopupId) {
      await onBulkMove(itemIds, folderId, dragSourcePopupId);
    }

    // Clear selection from source popup and set in target popup
    setPopupSelections(prev => {
      const next = new Map(prev);
      // Clear source popup selection
      if (dragSourcePopupId) {
        next.delete(dragSourcePopupId);
      }
      // Set moved items as selected in target popup
      next.set(popupId, new Set(itemIds));
      return next;
    });

    setIsPopupDropTarget(null);
    handleDragEnd();
  }, [draggedItems, dragSourcePopupId, onBulkMove, handleDragEnd]);

  useEffect(() => {
    const activeIds = new Set<string>();
    popups.forEach((_, id) => activeIds.add(id));
    setPreviewState(prev => {
      let mutated = false;
      const next: Record<string, PreviewEntry> = {};
      Object.entries(prev).forEach(([id, entry]) => {
        if (activeIds.has(id)) {
          next[id] = entry;
        } else {
          mutated = true;
        }
      });
      return mutated ? next : prev;
    });
  }, [popups]);

  // Cleanup selection state for closed popups
  useEffect(() => {
    const activeIds = new Set<string>();
    popups.forEach((_, id) => activeIds.add(id));

    setPopupSelections(prev => {
      let mutated = false;
      const next = new Map<string, Set<string>>();
      prev.forEach((selection, id) => {
        if (activeIds.has(id)) {
          next.set(id, selection);
        } else {
          mutated = true;
        }
      });
      return mutated ? next : prev;
    });

    setLastSelectedIds(prev => {
      let mutated = false;
      const next = new Map<string, string>();
      prev.forEach((lastId, popupId) => {
        if (activeIds.has(popupId)) {
          next.set(popupId, lastId);
        } else {
          mutated = true;
        }
      });
      return mutated ? next : prev;
    });

    // Clear drag state if source popup closed
    if (dragSourcePopupId && !activeIds.has(dragSourcePopupId)) {
      setDraggedItems(new Set());
      setDropTargetId(null);
      setInvalidDropTargetId(null);
      setDragSourcePopupId(null);
      setDragSourceFolderId(null);
      setIsPopupDropTarget(null);
    }
  }, [popups, dragSourcePopupId]);

  useEffect(() => {
    popups.forEach((popup, id) => {
      const entry = previewStateRef.current[id];
      const children = (popup.folder?.children ?? []) as PopupChildNode[];

      if (!entry) {
        // Removed auto-preview on mount - only highlight on hover
        return;
      }

      const activeChildId = entry.activeChildId;
      if (activeChildId && children.some(child => child.id === activeChildId && isNoteLikeNode(child))) {
        return;
      }

      // Clear any stale activeChildId if no longer valid
      if (activeChildId !== null) {
        setPreviewState(prev => {
          const current = prev[id];
          if (!current) return prev;
          return {
            ...prev,
            [id]: {
              ...current,
              activeChildId: null,
            },
          };
        });
      }
    });
  }, [popups, requestPreview]);

  
  // Debug log on mount
  useEffect(() => {
    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'component_mounted', {
        multiLayerEnabled,
        source: 'permanent_enable',
        popupCount: popups.size,
        timestamp: new Date().toISOString()
      });
    });

    return () => {
      getUIResourceManager().enqueueLowPriority(() => {
        debugLog('PopupOverlay', 'component_unmounted', {
          timestamp: new Date().toISOString()
        });
      });
    };
  }, [popups.size, multiLayerEnabled]);
  
  // Self-contained transform state (committed when pan ends)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const isPanningRef = useRef(false);
  // RAF-driven pan refs: avoid React renders on every move
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const rafIdRef = useRef<number | null>(null);
  const lastRafTsRef = useRef(0);
  const [engaged, setEngaged] = useState(false); // hysteresis engaged
  
  // Use LayerProvider to gate interactivity by active layer
  const layerCtx = useLayer();
  const hasSharedCamera = multiLayerEnabled && layerCtx?.layers instanceof Map && layerCtx.layers.size > 0;
  const sharedTransform = hasSharedCamera ? (layerCtx.transforms.popups || IDENTITY_TRANSFORM) : null;
  const activeTransform = sharedTransform ?? transform;
  const isActiveLayer = !!layerCtx && layerCtx.activeLayer === 'popups';
  const popupChildRowRenderer = useMemo(
    () =>
      createPopupChildRowRenderer({
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
      }),
    [
      popupSelections,
      draggedItems,
      dropTargetId,
      invalidDropTargetId,
      requestPreview,
      popups,
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
      renameLoading,
      renameError,
      onSelectNote,
      layerCtx,
    ]
  );

  const renderPopupChildRow = useCallback(
    (popupId: string, options: PopupChildRowOptions) => popupChildRowRenderer(popupId, options),
    [popupChildRowRenderer]
  );

  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Track the on-screen bounds of the canvas container to scope the overlay
  const [overlayBounds, setOverlayBounds] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [pointerGuardOffset, setPointerGuardOffset] = useState(0);
  const sidebarRectRef = useRef<DOMRect | null>(null);
  // Preferred: mount overlay inside the canvas container via React portal
  const [overlayContainer, setOverlayContainer] = useState<HTMLElement | null>(null);
  const [isOverlayHovered, setIsOverlayHovered] = useState(false);
  // LOD: Track which popups are visible in the viewport to limit connection lines
  const visibleIdSetRef = useRef<Set<string>>(new Set());
  const visibilityObserversRef = useRef<Map<string, IntersectionObserver>>(new Map());
  const panStartRef = useRef({ x: 0, y: 0 });
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const pointerIdRef = useRef<number | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Selection guard refs to prevent text highlighting during drag
  const selectionGuardsRef = useRef<{
    onSelectStart: (e: Event) => void;
    onDragStart: (e: Event) => void;
    prevUserSelect: string;
  } | null>(null);
  
  // Auto-scroll state and refs
  const [autoScroll, setAutoScroll] = useState<AutoScrollState>(() => ({
    isActive: false,
    velocity: { x: 0, y: 0 },
    threshold: AUTO_SCROLL_CONFIG.THRESHOLD,
    minSpeed: AUTO_SCROLL_CONFIG.MIN_SPEED,
    maxSpeed: AUTO_SCROLL_CONFIG.MAX_SPEED
  }));
  const autoScrollRef = useRef<AutoScrollState>(autoScroll);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (hasSharedCamera && sharedTransform) {
      transformRef.current = { ...sharedTransform };
    }
  }, [hasSharedCamera, sharedTransform]);

  // Inject global CSS once to hard-disable selection when dragging
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const STYLE_ID = 'dragging-no-select-style';
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        html.dragging-no-select, html.dragging-no-select * {
          -webkit-user-select: none !important;
          user-select: none !important;
          -ms-user-select: none !important;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const enableSelectionGuards = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (selectionGuardsRef.current) return; // already enabled
    const onSelectStart = (e: Event) => { e.preventDefault(); };
    const onDragStart = (e: Event) => { e.preventDefault(); };
    selectionGuardsRef.current = {
      onSelectStart,
      onDragStart,
      prevUserSelect: document.body.style.userSelect,
    };
    document.documentElement.classList.add('dragging-no-select');
    document.body.style.userSelect = 'none';
    document.addEventListener('selectstart', onSelectStart, true);
    document.addEventListener('dragstart', onDragStart, true);
    try { window.getSelection()?.removeAllRanges?.(); } catch {}
  }, []);

  const disableSelectionGuards = useCallback(() => {
    if (typeof document === 'undefined') return;
    const g = selectionGuardsRef.current;
    if (!g) return;
    document.removeEventListener('selectstart', g.onSelectStart, true);
    document.removeEventListener('dragstart', g.onDragStart, true);
    document.documentElement.classList.remove('dragging-no-select');
    document.body.style.userSelect = g.prevUserSelect || '';
    selectionGuardsRef.current = null;
  }, []);
  
  
  // Debug log initialization and state tracking
  useEffect(() => {
    if (!debugLoggingEnabled) return;
    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'initialized', {
        popupCount: popups.size,
        transform: activeTransform,
        multiLayerEnabled,
        isActiveLayer,
        layerCtx: layerCtx?.activeLayer || 'none'
      });
    });
  }, [debugLoggingEnabled, popups.size, activeTransform, multiLayerEnabled, isActiveLayer, layerCtx?.activeLayer]);
  
  // Avoid per-frame logging during pan to prevent jank/flicker
  // (transform updates every pointer move)
  // Intentionally disabled: 'transform_changed' spam
  // useEffect(() => {
  //   debugLog('PopupOverlay', 'transform_changed', {
  //     transform,
  //     isPanning,
  //     engaged
  //   });
  // }, [transform]);
  
  // Debug log layer changes
  useEffect(() => {
    if (!debugLoggingEnabled) return;
    getUIResourceManager().enqueueLowPriority(() => {
      debugLog('PopupOverlay', 'layer_state', {
          isActiveLayer,
          activeLayer: layerCtx?.activeLayer || 'none',
          popupCount: popups.size,
          canInteract: isActiveLayer && popups.size > 0
        });
    });
  }, [debugLoggingEnabled, isActiveLayer, layerCtx?.activeLayer, popups.size]);
  
  // Check if the pointer event is on empty space (not on interactive elements)
  const isOverlayEmptySpace = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    // Check if we're NOT clicking on a popup card or button
    // This allows clicking on any background element including transform containers
    const isOnPopup = !!target.closest('.popup-card');
    const isOnButton = !!target.closest('button');
    
    // Empty space = not on popup card and not on button
    return !isOnPopup && !isOnButton;
  }, []);

  const isPointerOverSidebar = useCallback(
    (clientX: number, clientY: number) => {
      if (!overlayFullSpanEnabled) {
        return false;
      }
      const rect = sidebarRectRef.current;
      if (!rect) {
        return false;
      }
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    },
    [overlayFullSpanEnabled]
  );
  
  // Handle pan start (simplified like notes canvas)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isPointerOverSidebar(e.clientX, e.clientY)) {
      tracePointerLog('PopupOverlay', 'pointer_blocked_over_sidebar', {
        clientX: e.clientX,
        clientY: e.clientY,
        sidebarRect: sidebarRectRef.current
          ? {
              left: sidebarRectRef.current.left,
              right: sidebarRectRef.current.right,
              top: sidebarRectRef.current.top,
              bottom: sidebarRectRef.current.bottom,
            }
          : null,
      });
      return;
    }

    if (isLocked) {
      tracePointerLog('PopupOverlay', 'pan_blocked_locked_state', {
        popupCount: popups.size,
        activeLayer: layerCtx?.activeLayer || 'none',
      });
      return;
    }

    // Always log that pointer down was received (debug only)
    void tracePointerLog('[PopupOverlay] pointer_down_event', {
      target: (e.target as HTMLElement).className,
      isEmptySpace: isOverlayEmptySpace(e),
      isActiveLayer,
      popupCount: popups.size,
      layerCtx: layerCtx?.activeLayer || 'none',
      clientX: e.clientX,
      clientY: e.clientY,
    });
    
    getUIResourceManager().enqueueLowPriority(() => {
      tracePointerLog('PopupOverlay', 'pointer_down_received', {
        target: (e.target as HTMLElement).className,
        isEmptySpace: isOverlayEmptySpace(e),
        isActiveLayer,
        popupCount: popups.size,
        layerCtx: layerCtx?.activeLayer || 'none'
      });
    });
    
    // Only start panning if clicking on empty space
    if (!isOverlayEmptySpace(e)) {
      getUIResourceManager().enqueueLowPriority(() => {
        tracePointerLog('PopupOverlay', 'pan_blocked_not_empty_space', {
          target: (e.target as HTMLElement).className
        });
      });
      return;
    }
    
    // Require at least one popup present
    const hasPopups = popups.size > 0;
    if (!hasPopups) {
      getUIResourceManager().enqueueLowPriority(() => {
        tracePointerLog('PopupOverlay', 'pan_blocked', { 
          isActiveLayer,
          hasPopups,
          layerCtx: layerCtx?.activeLayer || 'none',
          reason: 'no_popups'
        });
      });
      return;
    }
    // Also require correct active layer to avoid accidental interception
    if (!isActiveLayer) {
      getUIResourceManager().enqueueLowPriority(() => {
        tracePointerLog('PopupOverlay', 'pan_blocked_inactive_layer', {
          isActiveLayer,
          layerCtx: layerCtx?.activeLayer || 'none',
          reason: 'inactive_layer'
        });
      });
      return;
    }
    
    void tracePointerLog('[PopupOverlay] pan_start_event', {
      clientX: e.clientX,
      clientY: e.clientY,
      transform: activeTransform,
      pointerId: e.pointerId,
    });
    
    getUIResourceManager().enqueueLowPriority(() => {
      tracePointerLog('PopupOverlay', 'pan_start', { 
        clientX: e.clientX, 
        clientY: e.clientY,
        currentTransform: activeTransform,
        pointerId: e.pointerId,
        isActiveLayer,
        popupCount: popups.size
      });
    });
    
    // Use ref-driven panning to avoid render at t=0
    isPanningRef.current = true;
    setIsPanning(true);
    setEngaged(false); // reset hysteresis
    panStartRef.current = { x: e.clientX, y: e.clientY };
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    pointerIdRef.current = e.pointerId;
    
    // Capture pointer for robust dragging across children
    // Only capture if this is a real pointer event (not synthetic)
    try {
      if (e.pointerId !== undefined && overlayRef.current) {
        overlayRef.current.setPointerCapture(e.pointerId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // Fallback: pointer capture not available or synthetic event
      tracePointerLog('PopupOverlay', 'pointer_capture_failed', { 
        error: message,
        pointerId: e.pointerId 
      });
    }
    
    // Optimize for dragging
    // Prevent text selection while dragging
    enableSelectionGuards();
    document.body.style.userSelect = 'none';
    if (hasSharedCamera && layerCtx) {
      layerCtx.setGesture('overlay-pan');
      transformRef.current = { ...activeTransform };
    } else if (containerRef.current) {
      containerRef.current.style.willChange = 'transform';
      containerRef.current.style.backfaceVisibility = 'hidden';
      containerRef.current.style.perspective = '1000px';
      transformRef.current = { ...transform };
      const { x, y, scale } = transformRef.current;
      containerRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${scale})`;
    }
    // Immediate cursor feedback without render
    if (overlayRef.current) overlayRef.current.style.cursor = 'grabbing';
    
    // Only prevent default for actual drag operations
    e.preventDefault();
  }, [
    isOverlayEmptySpace,
    transform,
    sharedTransform,
    activeTransform,
    hasSharedCamera,
    isActiveLayer,
    popups.size,
    layerCtx,
    isLocked,
    isPointerOverSidebar,
    tracePointerLog
  ]);
  
  // Handle pan move (simplified like notes canvas)
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current || pointerIdRef.current === null) {
      tracePointerLog('PopupOverlay', 'pan_move_blocked', {
        isPanning: isPanningRef.current,
        pointerIdRef: pointerIdRef.current,
        reason: !isPanningRef.current ? 'not_panning' : 'no_pointer_id'
      });
      return;
    }
    
    // Don't block on capture - it may not be available for synthetic events
    
    const deltaX = e.clientX - lastMouseRef.current.x;
    const deltaY = e.clientY - lastMouseRef.current.y;
    
    // 3-5px hysteresis to distinguish click vs pan
    if (!engaged) {
      const dx0 = e.clientX - panStartRef.current.x;
      const dy0 = e.clientY - panStartRef.current.y;
      if (Math.hypot(dx0, dy0) < 1) return; // maintain minimal hysteresis to avoid accidental pans
      setEngaged(true);
      getUIResourceManager().enqueueLowPriority(() => {
        tracePointerLog('PopupOverlay', 'pan_engaged', { threshold: Math.hypot(dx0, dy0) });
      });
    }
    
    if (hasSharedCamera && layerCtx) {
      layerCtx.updateTransformByDelta('popups', { dx: deltaX, dy: deltaY });
    } else {
      transformRef.current = {
        ...transformRef.current,
        x: transformRef.current.x + deltaX,
        y: transformRef.current.y + deltaY,
      };
      if (containerRef.current) {
        const { x, y, scale } = transformRef.current;
        containerRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${scale})`;
      }
      if (rafIdRef.current == null) {
        rafIdRef.current = requestAnimationFrame((ts) => {
          rafIdRef.current = null;
          if (ts - lastRafTsRef.current < 16) return; // throttle ~60fps
          lastRafTsRef.current = ts;
          const { x, y, scale } = transformRef.current;
          if (containerRef.current) {
            containerRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${scale})`;
          }
        });
      }
    }
    
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, [isPanning, engaged, popups.size, hasSharedCamera, layerCtx, tracePointerLog]);
  
  // Handle pan end (simplified)
  const handlePointerEnd = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    
    getUIResourceManager().enqueueLowPriority(() => {
      tracePointerLog('PopupOverlay', 'pan_end', { 
        totalDelta: {
          x: activeTransform.x,
          y: activeTransform.y
        },
        pointerId: e.pointerId,
        wasEngaged: engaged
      });
    });
    
    // End ref-driven panning
    isPanningRef.current = false;
    setIsPanning(false);
    // Keep state false (we did not set it to true at start) but ensure UI resets
    setEngaged(false);
    
    // Release pointer capture
    if (pointerIdRef.current !== null && overlayRef.current) {
      try {
        overlayRef.current.releasePointerCapture(pointerIdRef.current);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        // Pointer was never captured or already released
        tracePointerLog('PopupOverlay', 'pointer_release_failed', { 
          error: message,
          pointerId: pointerIdRef.current 
        });
      }
      pointerIdRef.current = null;
    }
    
    // Reset styles
    document.body.style.userSelect = '';
    if (!hasSharedCamera && containerRef.current) {
      containerRef.current.style.willChange = 'auto';
      containerRef.current.style.backfaceVisibility = '';
      containerRef.current.style.perspective = '';
      containerRef.current.style.transform = '';
    }
    if (overlayRef.current) overlayRef.current.style.cursor = '';
    if (!hasSharedCamera) {
      setTransform(prev => ({ ...prev, ...transformRef.current }));
    }
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    // Re-enable selection
    disableSelectionGuards();
    if (hasSharedCamera && layerCtx) {
      layerCtx.setGesture('none');
    }
  }, [isPanning, hasSharedCamera, layerCtx, engaged, activeTransform, tracePointerLog]);
  
  // Note: With pointer capture, we don't need document-level listeners
  // The pointer events will continue to fire on the overlay even when
  // the pointer moves outside or over child elements
  
  // Note: Auto-switch is already handled by the explorer component
  // Removing duplicate auto-switch logic to prevent conflicts
  
  // Show toast notification
  const showToast = (message: string) => {
    // Clear existing timeout
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg animate-slide-in';
    toast.style.zIndex = String(Z_INDEX.TOAST);
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    
    document.body.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    
    // Remove after delay
    toastTimeoutRef.current = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  };
  
  // Generate connection lines (LOD: use visible popup ids if available)
  const connectionPaths = ConnectionLineAdapter.adaptConnectionLines(
    popups,
    draggingPopup !== null
  );
  
  // Container transform style with translate3d for GPU acceleration
  const containerStyle: React.CSSProperties = {
    // Round to nearest 0.5px to reduce jitter while maintaining smoothness
    transform: `translate3d(${Math.round(activeTransform.x * 2) / 2}px, ${Math.round(activeTransform.y * 2) / 2}px, 0) scale(${activeTransform.scale})`,
    transformOrigin: '0 0',
    // Only apply will-change during active panning to optimize GPU layers
    willChange: isPanning && !hasSharedCamera ? 'transform' : 'auto',
    // Force stable GPU layer to prevent text rasterization issues
    backfaceVisibility: 'hidden',
    transformStyle: 'preserve-3d',
    // Critical: NO transition during drag (main cause of blinking)
    transition: 'none',
    // Ensure we're on a separate compositing layer
    isolation: 'isolate',
    // Force GPU acceleration
    WebkitTransform: `translate3d(${Math.round(activeTransform.x * 2) / 2}px, ${Math.round(activeTransform.y * 2) / 2}px, 0) scale(${activeTransform.scale})`,
    // Prevent font antialiasing changes during transform
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    // Apply subtle opacity during pan to force simpler rendering
    opacity: isPanning && !hasSharedCamera ? 0.999 : 1,
  };

  // Recompute overlay bounds to match the canvas area (avoids hardcoded offsets)
  const recomputeOverlayBounds = useCallback(() => {
    if (typeof window === 'undefined') return;
    const canvasEl = document.getElementById('canvas-container');
    const sidebarEl = document.querySelector('[data-sidebar="sidebar"]') as HTMLElement | null;
    const sidebarRect = sidebarEl?.getBoundingClientRect() ?? null;
    sidebarRectRef.current = sidebarRect;

    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      let guardOffset = 0;

      if (sidebarRect) {
        const sidebarWidth = sidebarRect.width;
        const isSidebarVisible = sidebarWidth > 0 && sidebarRect.right > rect.left + 1;
        if (isSidebarVisible) {
          guardOffset = Math.max(0, sidebarRect.right - rect.left);
          if (guardOffset > 0) {
            debugLog('PopupOverlay', 'bounds_sidebar_detected', {
              sidebarWidth,
              sidebarRight: sidebarRect.right,
              canvasLeft: rect.left,
              guardOffset,
            });
          }
        }
      }

      const baseBounds = {
        top: Math.max(0, rect.top),
        left: Math.max(0, rect.left),
        width: Math.max(0, rect.width),
        height: Math.max(0, rect.height),
      };

      let resolvedBounds = baseBounds;
      if (!overlayFullSpanEnabled && guardOffset > 0) {
        const effectiveLeft = rect.left + guardOffset;
        resolvedBounds = {
          top: baseBounds.top,
          left: Math.max(0, effectiveLeft),
          width: Math.max(0, rect.right - effectiveLeft),
          height: baseBounds.height,
        };
      }

      setOverlayBounds(resolvedBounds);
      setPointerGuardOffset(guardOffset);
      debugLog(
        'PopupOverlay',
        overlayFullSpanEnabled ? 'overlay_bounds_full_span' : 'overlay_bounds_updated',
        {
          rect,
          guardOffset,
          sidebarPresent: !!sidebarRect,
          overlayBounds: resolvedBounds,
          overlayFullSpanEnabled,
        }
      );
    } else {
      const fallbackHost = ensureFloatingOverlayHost();
      if (fallbackHost) {
        const rect = fallbackHost.getBoundingClientRect();
        setOverlayBounds({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
        setPointerGuardOffset(0);
        debugLog('PopupOverlay', 'overlay_bounds_fallback', {
          hostId: fallbackHost.id,
          rect,
        });
      } else {
        setOverlayBounds({ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight });
        setPointerGuardOffset(0);
      }
    }
  }, [debugLog, overlayFullSpanEnabled]);

  useEffect(() => {
    // Initial compute and on resize
    recomputeOverlayBounds();
    const onResize = () => recomputeOverlayBounds();
    window.addEventListener('resize', onResize);
    const onScroll = () => recomputeOverlayBounds();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll as any);
    };
  }, [recomputeOverlayBounds, sidebarOpen]); // Add sidebarOpen dependency to recalculate when sidebar toggles

  // Recalculate bounds after sidebar animation completes
  useEffect(() => {
    const sidebarEl = document.querySelector('[data-sidebar="sidebar"]');
    if (!sidebarEl) return;

    const handleTransitionEnd = (event: Event) => {
      const transitionEvent = event as TransitionEvent
      // Recalculate bounds after sidebar animation completes
      if (transitionEvent.propertyName === 'transform') {
        // Small delay to ensure getBoundingClientRect returns final values
        setTimeout(() => {
          recomputeOverlayBounds();
          debugLog('PopupOverlay', 'bounds_recalc_after_transition', {
            sidebarOpen,
            timestamp: new Date().toISOString()
          });
        }, 10);
      }
    };

    sidebarEl.addEventListener('transitionend', handleTransitionEnd);
    return () => {
      sidebarEl.removeEventListener('transitionend', handleTransitionEnd);
    };
  }, [recomputeOverlayBounds, sidebarOpen]);

  useEffect(() => {
    debugLog('PopupOverlay', 'transform_applied', {
      x: activeTransform.x,
      y: activeTransform.y,
      scale: activeTransform.scale,
      hasSharedCamera,
      isPanning
    });
  }, [activeTransform.x, activeTransform.y, activeTransform.scale, hasSharedCamera, isPanning]);

  const measurementQueueRef = useRef<Map<
    string,
    {
      screen: { x: number; y: number };
      canvas: { x: number; y: number };
      size?: { width: number; height: number };
    }
  >>(new Map());
  const measurementRafIdRef = useRef<number | null>(null);
  const resizingStateRef = useRef<{
    popupId: string;
    pointerId: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    lastWidth: number;
    lastHeight: number;
  } | null>(null);
  const isMeasurementBlocked = isPanning || popups.size === 0 || draggingPopup !== null || isResizing || isLocked;
  const measurementRestartRef = useRef<number | null>(null);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, popup: PopupData) => {
      if (!onResizePopup || isLocked) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const startWidth = popup.width ?? DEFAULT_POPUP_WIDTH;
      const startHeight = popup.height ?? DEFAULT_POPUP_HEIGHT;

      resizingStateRef.current = {
        popupId: popup.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startWidth,
        startHeight,
        lastWidth: startWidth,
        lastHeight: startHeight,
      };

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (err) {
        // Pointer capture can fail in some browsers; best-effort only.
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[PopupOverlay] Pointer capture unavailable for resize handle', err);
        }
      }

      setIsResizing(true);
    },
    [onResizePopup, isLocked]
  );

  const handleResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isLocked) {
        return;
      }

      const state = resizingStateRef.current;
      if (!state || state.pointerId !== event.pointerId || !onResizePopup) {
        return;
      }

      event.preventDefault();

      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      const nextWidth = clamp(state.startWidth + deltaX, MIN_POPUP_WIDTH, MAX_POPUP_WIDTH);
      const nextHeight = clamp(state.startHeight + deltaY, MIN_POPUP_HEIGHT, MAX_POPUP_HEIGHT);

      if (nextWidth === state.lastWidth && nextHeight === state.lastHeight) {
        return;
      }

      state.lastWidth = nextWidth;
      state.lastHeight = nextHeight;
      onResizePopup(state.popupId, { width: nextWidth, height: nextHeight }, { source: 'user' });
    },
    [onResizePopup, isLocked]
  );

  const handleResizePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = resizingStateRef.current;
    if (state && state.pointerId === event.pointerId) {
      const target = event.currentTarget as HTMLElement;
      if (typeof target.releasePointerCapture === 'function') {
        try {
          target.releasePointerCapture(event.pointerId);
        } catch (err) {
          if (process.env.NODE_ENV !== 'production') {
            console.debug('[PopupOverlay] releasePointerCapture failed during resize cleanup', err);
          }
        }
      }

      if (!isLocked && onResizePopup) {
        const didChange =
          state.lastWidth !== state.startWidth ||
          state.lastHeight !== state.startHeight;
        if (didChange) {
          onResizePopup(state.popupId, { width: state.lastWidth, height: state.lastHeight }, { source: 'user' });
        }
      }
    }

    resizingStateRef.current = null;
    if (isResizing) {
      setIsResizing(false);
    }
  }, [isLocked, isResizing, onResizePopup]);

  const handlePopupHeaderMouseDown = useCallback(
    (popupId: string, event: React.MouseEvent) => {
      if (isLocked) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onDragStart?.(popupId, event);
    },
    [isLocked, onDragStart]
  );

  useLayoutEffect(() => {
    if (!onPopupPositionChange) return;
    if (isMeasurementBlocked) {
      if (measurementRafIdRef.current !== null) {
        cancelAnimationFrame(measurementRafIdRef.current);
        measurementRafIdRef.current = null;
      }
      measurementQueueRef.current.clear();
      if (measurementRestartRef.current !== null) {
        clearTimeout(measurementRestartRef.current);
      }
      measurementRestartRef.current = window.setTimeout(() => {
        measurementRestartRef.current = null;
        // Trigger effect by forcing a state update via a dummy ref; handled by dependency below
      }, 50);
      return;
    }
    const root = overlayRef.current;
    if (!root) return;
    const containerRect = root.getBoundingClientRect();
    const autoResizePayload: Array<{ id: string; width: number; height: number }> = [];

    popups.forEach((popupState, popupId) => {
      const element = root.querySelector<HTMLElement>(`[data-popup-id="${popupId}"]`);
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const viewportScreenPosition = { x: rect.left, y: rect.top };
      const localScreenPosition = containerRect
        ? {
            x: viewportScreenPosition.x - containerRect.left,
            y: viewportScreenPosition.y - containerRect.top,
          }
        : viewportScreenPosition;
      const canvasPosition = CoordinateBridge.screenToCanvas(localScreenPosition, activeTransform);

      const prevScreen = popupState.position;
      const prevCanvas = popupState.canvasPosition;
      const prevWidth = popupState.width ?? DEFAULT_POPUP_WIDTH;
      const prevHeight = popupState.height ?? DEFAULT_POPUP_HEIGHT;

      const screenChanged =
        !prevScreen ||
        Math.abs(prevScreen.x - viewportScreenPosition.x) > 0.5 ||
        Math.abs(prevScreen.y - viewportScreenPosition.y) > 0.5;

      const canvasChanged = false; // world position updates handled when popup moves/dragged

      const widthChanged = Math.abs(prevWidth - rect.width) > 0.5;
      const heightChanged = Math.abs(prevHeight - rect.height) > 0.5;

      if (screenChanged || widthChanged || heightChanged) {
        measurementQueueRef.current.set(popupId, {
          screen: viewportScreenPosition,
          canvas: popupState.canvasPosition || canvasPosition,
          size: widthChanged || heightChanged ? { width: rect.width, height: rect.height } : undefined,
        });
      }

      const shouldAutoResize =
        !!onResizePopup &&
        !popupState.isLoading &&
        popupState.sizeMode !== 'user';

      if (shouldAutoResize) {
        let intrinsicHeight = rect.height;
        const contentElement = element.querySelector<HTMLElement>('[data-popup-content]');
        if (contentElement) {
          const contentRect = contentElement.getBoundingClientRect();
          const chromeHeight = Math.max(0, rect.height - contentRect.height);
          const contentScrollHeight = contentElement.scrollHeight;
          intrinsicHeight = chromeHeight + contentScrollHeight;
        } else {
          intrinsicHeight = element.scrollHeight || rect.height;
        }
        const desiredHeight = clamp(intrinsicHeight, MIN_POPUP_HEIGHT, MAX_POPUP_HEIGHT);
        const previousHeight = popupState.height ?? DEFAULT_POPUP_HEIGHT;
        const heightDelta = Math.abs(previousHeight - desiredHeight);
        if (popupState.sizeMode !== 'auto' || heightDelta > 1) {
          const currentWidth = popupState.width ?? rect.width ?? DEFAULT_POPUP_WIDTH;
          if (process.env.NODE_ENV !== 'production') {
            console.debug('[PopupOverlay] auto_resize_request', {
              popupId,
              previousHeight,
              desiredHeight,
              sizeMode: popupState.sizeMode,
              heightDelta
            });
          }
          autoResizePayload.push({
            id: popupId,
            width: clamp(currentWidth, MIN_POPUP_WIDTH, MAX_POPUP_WIDTH),
            height: desiredHeight,
          });
        }
      }
    });

    if (measurementRafIdRef.current !== null) {
      cancelAnimationFrame(measurementRafIdRef.current);
      measurementRafIdRef.current = null;
    }

    if (measurementQueueRef.current.size > 0) {
      measurementRafIdRef.current = requestAnimationFrame(() => {
        measurementQueueRef.current.forEach((payload, popupId) => {
          const updatePayload: {
            screenPosition: { x: number; y: number };
            canvasPosition: { x: number; y: number };
            size?: { width: number; height: number };
          } = {
            screenPosition: payload.screen,
            canvasPosition: payload.canvas,
          };
          if (payload.size) {
            updatePayload.size = payload.size;
          }
          onPopupPositionChange(popupId, updatePayload);
        });
        measurementQueueRef.current.clear();
        measurementRafIdRef.current = null;
      });
    }

    if (autoResizePayload.length > 0 && onResizePopup) {
      autoResizePayload.forEach(({ id, width, height }) => {
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[PopupOverlay] auto_resize_commit', { id, width, height });
        }
        onResizePopup(id, { width, height }, { source: 'auto' });
      });
    }

    return () => {
      if (measurementRafIdRef.current !== null) {
        cancelAnimationFrame(measurementRafIdRef.current);
        measurementRafIdRef.current = null;
      }
      measurementQueueRef.current.clear();
    };
  }, [popups, activeTransform, onPopupPositionChange, isMeasurementBlocked, onResizePopup]);

  useEffect(() => {
    visibleIdSetRef.current.clear();
    popups.forEach((_, id) => visibleIdSetRef.current.add(id));
    visibilityObserversRef.current.forEach(obs => obs.disconnect());
    visibilityObserversRef.current.clear();
  }, [popups, overlayBounds]);

  // Debug log container style (only when verbose)
  useEffect(() => {
    if (!debugLoggingEnabled) return;
    debugLog('PopupOverlay', 'container_style', {
      containerStyle,
      hasContainer: !!containerRef.current,
      computedTransform: containerRef.current?.style?.transform || 'none'
    });
  }, [containerStyle, debugLoggingEnabled]);
  
  // Viewport culling - only render visible popups
  const visiblePopups = useMemo(() => {
    const margin = 200;
    const viewport = CoordinateBridge.getViewportBounds(margin);
    
    return Array.from(popups.values()).filter((popup) => {
      if (!popup.canvasPosition) return false
      
      const screenPos = CoordinateBridge.canvasToScreen(
        popup.canvasPosition || popup.position,
        activeTransform
      )
      
      const popupWidth = popup.width ?? DEFAULT_POPUP_WIDTH
      const popupHeight = popup.height ?? DEFAULT_POPUP_HEIGHT
      
      return (
        screenPos.x + popupWidth >= viewport.x &&
        screenPos.x <= viewport.x + viewport.width &&
        screenPos.y + popupHeight >= viewport.y &&
        screenPos.y <= viewport.y + viewport.height
      )
    })
  }, [popups, activeTransform])
  
  const viewportSize = useMemo(() => {
    if (overlayBounds) {
      return { width: overlayBounds.width, height: overlayBounds.height };
    }
    if (typeof window !== 'undefined') {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 1920, height: 1080 };
  }, [overlayBounds]);
  
  const handleMinimapNavigate = useCallback(
    ({ x, y }: { x: number; y: number }) => {
      const scale = activeTransform.scale || 1;
      const nextTransform = {
        scale,
        x: viewportSize.width / 2 - x * scale,
        y: viewportSize.height / 2 - y * scale,
      };
      if (hasSharedCamera && layerCtx) {
        layerCtx.updateTransform('popups', {
          x: nextTransform.x - activeTransform.x,
          y: nextTransform.y - activeTransform.y,
        });
      } else {
        transformRef.current = nextTransform;
        setTransform(nextTransform);
      }
    },
    [activeTransform, hasSharedCamera, layerCtx, setTransform, viewportSize]
  );
  
  const hasClosingPopup = (() => {
    for (const popupEntry of popups.values()) {
      if (popupEntry.closeMode === 'closing') {
        return true
      }
    }
    return false
  })()
  
  // Build overlay contents (absolute inside canvas container)
  const overlayBox = overlayBounds ?? { top: 0, left: 0, width: typeof window !== 'undefined' ? window.innerWidth : 0, height: typeof window !== 'undefined' ? window.innerHeight : 0 };
  const hasPopups = popups.size > 0;
  const overlayInteractive = hasPopups && !isLocked;

  const renderOverlayMinimap = () =>
    overlayMinimapEnabled ? (
      <OverlayMinimap
        key="overlay-minimap"
        popups={popups}
        transform={activeTransform}
        viewport={viewportSize}
        onNavigate={handleMinimapNavigate}
      />
    ) : null;

  const overlayInner = (
    <div
      ref={overlayRef}
      id="popup-overlay"
      className={`${isPanning ? 'popup-overlay-panning' : ''}`}
      data-panning={isPanning.toString()}
      data-locked={isLocked ? 'true' : 'false'}
      aria-busy={isLocked}
      style={{
        position: 'fixed',
        top: overlayBox.top,
        left: overlayBox.left,
        width: overlayBox.width,
        height: overlayBox.height,
        zIndex: Z_INDEX.POPUP_OVERLAY,
        overflow: 'hidden',
        pointerEvents: overlayInteractive ? 'auto' : 'none',
        touchAction: overlayInteractive ? 'none' : 'auto',
        cursor: isLocked ? 'wait' : isPanning ? 'grabbing' : (hasPopups ? 'grab' : 'default'),
        opacity: hasPopups ? 1 : 0,
        visibility: hasPopups ? 'visible' : 'hidden',
        contain: 'layout paint' as const,
        clipPath:
          !overlayFullSpanEnabled && pointerGuardOffset > 0
            ? `inset(0 0 0 ${pointerGuardOffset}px)`
            : 'none',
        ...getBackdropStyle(backdropStyle),
      }}
      data-layer="popups"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerEnter={() => setIsOverlayHovered(true)}
      onPointerLeave={() => setIsOverlayHovered(false)}
      onClick={(e) => {
        if (isOverlayEmptySpace(e as any)) {
          onPopupCardClick?.();
        }
      }}
      onContextMenu={onContextMenu}
    >
      {isLocked && (
        <div className="popup-overlay-lock-banner">
          <div className="popup-overlay-lock-pill">
            <span className="popup-overlay-lock-dot" />
            Workspace hydrating…
          </div>
        </div>
      )}
      {/* Transform container - applies pan/zoom to all children */}
      <div ref={containerRef} className="absolute inset-0" style={containerStyle}>
        {/* Removed full-viewport background inside transform to prevent repaint flicker */}
        {/* Connection lines (canvas coords) */}
        <svg className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
          <defs>
            {/* Arrow marker for connection lines */}
            <marker
              id="connection-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path
                d="M 0 0 L 8 4 L 0 8 z"
                fill="rgba(148, 163, 184, 0.8)"
                stroke="none"
              />
            </marker>
          </defs>
          {connectionPaths.map((path, index) => (
            <path
              key={index}
              d={path.d}
              stroke={path.stroke}
              strokeWidth={path.strokeWidth}
              opacity={path.opacity}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd="url(#connection-arrow)"
            />
          ))}
        </svg>
        {/* Popups (canvas coords) - only render visible ones */}
        {visiblePopups.map((popup) => {
          const previewEntry = previewState[popup.id];
          const renderChildRow = renderPopupChildRow(popup.id, {
            previewEntry,
            isPanning,
            onHoverFolder,
            onLeaveFolder,
          });

          const position = popup.canvasPosition || popup.position;
          if (!position) return null;
          const zIndex = getPopupZIndex(
            popup.level,
            popup.isDragging || popup.id === draggingPopup,
            true
          );
          const cappedZIndex = Math.min(zIndex, 20000);
          const popupWidth = popup.width ?? DEFAULT_POPUP_WIDTH;
          const popupHeight = popup.height ?? DEFAULT_POPUP_HEIGHT;
          const hasExplicitHeight = typeof popup.height === 'number';
          return (
            <div
              key={popup.id}
              id={`popup-${popup.id}`}
              className={`popup-card absolute bg-gray-800 rounded-lg shadow-xl pointer-events-auto flex flex-col ${
                popupEditMode.get(popup.id)
                  ? 'border-2 border-blue-500 ring-2 ring-blue-400/30'
                  : 'border border-gray-700'
              } ${
                isPopupDropTarget === popup.id ? 'drop-target-active ring-4 ring-blue-400 ring-offset-2 ring-offset-gray-900' : ''
              } ${popup.isHighlighted || hoverHighlightedPopup === popup.id ? 'highlighted' : ''}`}
              style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: `${popupWidth}px`,
                maxHeight: `${popupHeight}px`,
                height: hasExplicitHeight ? `${popupHeight}px` : 'auto',
                zIndex: cappedZIndex,
                cursor: popup.isDragging ? 'grabbing' : 'default',
                // Slightly reduce opacity during pan to prevent text rendering issues
                opacity: isPanning ? 0.99 : 1,
                // Add GPU optimization to individual popups
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden' as const,
                willChange: popup.isDragging || isPanning ? 'transform' : 'auto',
              }}
              data-popup-id={popup.id}
              onDragOver={(e) => {
                const folderId = (popup as any).folderId;
                folderId && handlePopupDragOver(popup.id, folderId, e);
              }}
              onDragLeave={(e) => handlePopupDragLeave(popup.id, e)}
              onDrop={(e) => {
                const folderId = (popup as any).folderId;
                folderId && handlePopupDrop(folderId, popup.id, e);
              }}
              onClick={(e) => {
                e.stopPropagation();
                onPopupCardClick?.(); // Close floating toolbar when clicking popup card
              }}
              onPointerEnter={() => {
                // Pass both the folder ID and the parent popup ID to cancel the close timeout
                if (popup.folder?.id) {
                  onPopupHover?.(popup.folder.id, popup.parentId)
                }
              }}
            >
              {/* Popup Header with Breadcrumb */}
              <PopupCardHeader
                popup={popup}
                isEditMode={Boolean(popupEditMode.get(popup.id))}
                renamingTitleId={renamingTitle}
                renameTitleInputRef={renameTitleInputRef}
                renamingTitleName={renamingTitleName}
                onRenameTitleNameChange={setRenamingTitleName}
                onSaveRenameTitle={handleSaveRenameTitle}
                onCancelRenameTitle={handleCancelRenameTitle}
                renameLoading={renameLoading}
                renameError={renameError}
                onStartRenameTitle={handleStartRenameTitle}
                onHeaderMouseDown={handlePopupHeaderMouseDown}
                debugLog={debugLog}
                breadcrumbDropdownOpen={breadcrumbDropdownOpen}
                onToggleBreadcrumbDropdown={handleToggleBreadcrumbDropdown}
                ancestorCache={ancestorCache}
                loadingAncestors={loadingAncestors}
                onBreadcrumbFolderHover={handleBreadcrumbFolderHover}
                onBreadcrumbFolderHoverLeave={handleBreadcrumbFolderHoverLeave}
                onToggleEditMode={handleToggleEditMode}
                onConfirmClose={onConfirmClose}
                onCancelClose={onCancelClose}
                onInitiateClose={onInitiateClose}
              />
              {/* Popup Content with virtualization for large lists */}
              <div
                className="overflow-y-auto flex-1"
                data-popup-content
                style={{
                  contain: 'content',
                  contentVisibility: 'auto' as const,
                  paddingBottom: '40px',
                  minHeight: 0  // Required for flex child to scroll properly
                }}
              >
                {popup.isLoading ? (
                  <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
                ) : popup.folder?.children && popup.folder.children.length > 0 ? (
                  popup.folder.children.length > 200 ? (
                    <VirtualList
                      items={popup.folder.children}
                      itemHeight={36}
                      height={300}
                      overscan={8}
                      renderItem={(child: PopupChildNode) =>
                        renderChildRow(child, popup.folder?.children ?? [])
                      }
                    />
                  ) : (
                    <div className="py-1">
                      {(popup.folder.children ?? []).map((child: PopupChildNode) =>
                        renderChildRow(child, popup.folder?.children ?? [])
                      )}
                    </div>
                  )
                ) : (
                  <div className="p-4 text-center text-gray-500 text-sm">Empty folder</div>
                )}
              </div>
              <PopupCardFooter
                popup={popup}
                isEditMode={Boolean(popupEditMode.get(popup.id))}
                hasClosingAncestor={hasClosingPopup}
                popupSelections={popupSelections}
                onDeleteSelected={handleDeleteSelected}
                onClearSelection={handleClearSelection}
                creatingFolderInPopup={creatingFolderInPopup}
                newFolderName={newFolderName}
                onChangeNewFolderName={setNewFolderName}
                onCancelCreateFolder={handleCancelCreateFolder}
                onSubmitCreateFolder={handleCreateFolder}
                onStartCreateFolder={handleStartCreateFolder}
                folderCreationLoading={folderCreationLoading}
                folderCreationError={folderCreationError}
                onTogglePin={onTogglePin}
              />
              <div
                className="px-3 py-1.5 border-t border-gray-700 text-xs text-gray-500 cursor-pointer"
                onDragOver={(e) => {
                  const folderId = (popup as any).folderId;
                  if (folderId && draggedItems.size > 0) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setIsPopupDropTarget(popup.id);
                  }
                }}
                onDrop={(e) => {
                  const folderId = (popup as any).folderId;
                  folderId && handlePopupDrop(folderId, popup.id, e);
                }}
              >
                Level {popup.level} • {popup.folder?.children?.length || 0} items
              </div>
              <div
                className="popup-resize-handle"
                aria-hidden="true"
                onPointerDown={(event) => handleResizePointerDown(event, popup)}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerEnd}
                onPointerCancel={handleResizePointerEnd}
              />
            </div>
          );
        })}
      </div>
    </div>
  );

  const overlayMinimapPortal =
    overlayMinimapEnabled && typeof document !== 'undefined'
      ? createPortal(renderOverlayMinimap(), document.body)
      : null;

  useEffect(() => {
    if (!overlayContainer) {
      return;
    }

    const host = overlayContainer;
    host.style.pointerEvents = 'none';
    host.style.zIndex = String(Z_INDEX.POPUP_OVERLAY);

    return () => {
      host.style.pointerEvents = 'none';
    };
  }, [overlayContainer]);

  // Preview tooltip using shared PreviewPopover component
  const tooltipPortal = activePreviewTooltip && createPortal(
    <PreviewPopover
      content={activePreviewTooltip.content}
      status={activePreviewTooltip.status}
      position={activePreviewTooltip.position}
      noteId={activePreviewTooltip.noteId}
      onOpenNote={(noteId) => {
        // Auto-switch to note canvas if currently on popups layer
        if (layerCtx && layerCtx.activeLayer === 'popups') {
          layerCtx.setActiveLayer('notes');
        }
        onSelectNote?.(noteId);
        setActivePreviewTooltip(null);
      }}
      onMouseEnter={handlePreviewTooltipEnter}
      onMouseLeave={handlePreviewTooltipMouseLeave}
    />,
    document.body
  );

  // Breadcrumb folder popup portal
  const breadcrumbFolderPopupPortal = breadcrumbFolderPreview && createPortal(
    <div
      key={breadcrumbFolderPreview.folderId}
      className="fixed w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl"
      style={{
        backgroundColor: 'rgba(17, 24, 39, 0.98)',
        left: `${breadcrumbFolderPreview.position.x}px`,
        top: `${breadcrumbFolderPreview.position.y}px`,
        zIndex: 10000
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={handleBreadcrumbPreviewHover}
      onMouseLeave={handleBreadcrumbFolderHoverLeave}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          {(() => {
            const colorTheme = breadcrumbFolderPreview.folderColor
              ? getFolderColorTheme(breadcrumbFolderPreview.folderColor)
              : null;
            return colorTheme ? (
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorTheme.bg }} />
            ) : (
              <span className="flex-shrink-0">📁</span>
            );
          })()}
          <span className="font-medium text-white text-sm truncate">{breadcrumbFolderPreview.folderName}</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 max-h-80 overflow-y-auto">
        {breadcrumbFolderPreview.isLoading ? (
          <div className="text-center text-gray-500 text-sm py-4">Loading...</div>
        ) : breadcrumbFolderPreview.children.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-4">Empty folder</div>
        ) : (
          <div className="space-y-1">
            {breadcrumbFolderPreview.children.map((child) => (
              <div
                key={child.id}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 rounded text-sm transition-colors"
              >
                <span className="flex-shrink-0">{child.icon || (child.type === 'folder' ? '📁' : '📄')}</span>
                <span className="truncate text-gray-200">{child.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );

  // Render strategy:
  // 1. If canvas-container exists, portal into it (scoped to canvas area)
  // 2. Otherwise, render as fixed overlay on document.body (for floating notes widget when no note is open)
  if (typeof window !== 'undefined') {
    if (overlayContainer) {
      // Preferred: portal into canvas container
      return (
        <>
          {createPortal(overlayInner, overlayContainer)}
          {overlayMinimapPortal}
          {tooltipPortal}
          {breadcrumbFolderPopupPortal}
        </>
      );
    } else if (popups.size > 0) {
      // Fallback: render as fixed overlay when canvas doesn't exist but popups do
      // This handles the case where floating notes widget is open but no note is selected
      const fallbackOverlay = (
        <div
          ref={overlayRef}
          id="popup-overlay"
          className={`fixed inset-0 ${isPanning ? 'popup-overlay-panning' : ''}`}
          data-panning={isPanning.toString()}
          style={{
            zIndex: Z_INDEX.POPUP_OVERLAY,
            overflow: 'hidden',
            pointerEvents: (popups.size > 0) ? 'auto' : 'none',
            touchAction: (popups.size > 0) ? 'none' : 'auto',
            cursor: isPanning ? 'grabbing' : ((popups.size > 0) ? 'grab' : 'default'),
            opacity: (popups.size > 0) ? 1 : 0,
            visibility: (popups.size > 0) ? 'visible' : 'hidden',
            contain: 'layout paint' as const,
            ...getBackdropStyle(backdropStyle), // TEMPORARY: Apply backdrop style
          }}
          data-layer="popups"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onPointerEnter={() => setIsOverlayHovered(true)}
          onPointerLeave={() => setIsOverlayHovered(false)}
          onClick={(e) => {
            // Close floating toolbar when clicking on empty space (not on popup cards)
            if (isOverlayEmptySpace(e as any)) {
              onPopupCardClick?.();
            }
          }}
        >
          {/* Transform container - applies pan/zoom to all children */}
          <div ref={containerRef} className="absolute inset-0" style={containerStyle}>
            {/* Connection lines (canvas coords) */}
            <svg className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
              <defs>
                {/* Arrow marker for connection lines */}
                <marker
                  id="connection-arrow-2"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path
                    d="M 0 0 L 8 4 L 0 8 z"
                    fill="rgba(148, 163, 184, 0.8)"
                    stroke="none"
                  />
                </marker>
              </defs>
              {connectionPaths.map((path, index) => (
                <path
                  key={index}
                  d={path.d}
                  stroke={path.stroke}
                  strokeWidth={path.strokeWidth}
                  opacity={path.opacity}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  markerEnd="url(#connection-arrow-2)"
                />
              ))}
            </svg>
            {/* Popups (canvas coords) - only render visible ones */}
            {visiblePopups.map((popup) => {
              const previewEntry = previewState[popup.id];
              const renderChildRow = renderPopupChildRow(popup.id, {
                previewEntry,
                isPanning,
                onHoverFolder,
                onLeaveFolder,
              });

              const position = popup.canvasPosition || popup.position;
              if (!position) return null;
              const zIndex = getPopupZIndex(
                popup.level,
                popup.isDragging || popup.id === draggingPopup,
                true
              );
              const cappedZIndex = Math.min(zIndex, 20000);
              const popupWidth = popup.width ?? DEFAULT_POPUP_WIDTH;
              const popupHeight = popup.height ?? DEFAULT_POPUP_HEIGHT;
              return (
                <div
                  key={popup.id}
                  id={`popup-${popup.id}`}
                  className={`popup-card absolute bg-gray-800 rounded-lg shadow-xl pointer-events-auto flex flex-col ${
                    popupEditMode.get(popup.id)
                      ? 'border-2 border-blue-500 ring-2 ring-blue-400/30'
                      : 'border border-gray-700'
                  } ${
                    isPopupDropTarget === popup.id ? 'drop-target-active ring-4 ring-blue-400 ring-offset-2 ring-offset-gray-900' : ''
                  } ${popup.isHighlighted || hoverHighlightedPopup === popup.id ? 'highlighted' : ''}`}
                  style={{
                    left: `${position.x}px`,
                    top: `${position.y}px`,
                    width: `${popupWidth}px`,
                    maxHeight: `${popupHeight}px`,
                    zIndex: cappedZIndex,
                    cursor: popup.isDragging ? 'grabbing' : 'default',
                    opacity: isPanning ? 0.99 : 1,
                    transform: 'translateZ(0)',
                    backfaceVisibility: 'hidden' as const,
                    willChange: popup.isDragging || isPanning ? 'transform' : 'auto',
                  }}
                  data-popup-id={popup.id}
                  onDragOver={(e) => {
                    const folderId = (popup as any).folderId;
                    folderId && handlePopupDragOver(popup.id, folderId, e);
                  }}
                  onDragLeave={(e) => handlePopupDragLeave(popup.id, e)}
                  onDrop={(e) => {
                    const folderId = (popup as any).folderId;
                    folderId && handlePopupDrop(folderId, popup.id, e);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPopupCardClick?.(); // Close floating toolbar when clicking popup card
                  }}
                >
                  {/* Popup Header with Breadcrumb */}
                  <div
                    className={`px-3 py-2 border-b flex items-center justify-between cursor-grab active:cursor-grabbing ${
                      popupEditMode.get(popup.id)
                        ? 'border-blue-600 bg-blue-600/20'
                        : 'border-gray-700'
                    }`}
                    onMouseDown={(e) => handlePopupHeaderMouseDown(popup.id, e)}
                    style={{
                      backgroundColor: popup.isDragging
                        ? '#374151'
                        : popupEditMode.get(popup.id)
                        ? 'rgba(37, 99, 235, 0.15)'
                        : 'transparent'
                    }}
                  >
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      {(() => {
                        const folderColor = popup.folder?.color
                        const colorTheme = getFolderColorTheme(folderColor)
                        const folderPath = (popup.folder as any)?.path || (popup as any).folder?.path
                        const folderName = popup.folder?.name || (popup.folderName && popup.folderName.trim()) || 'Loading...'
                        const isChildPopup = (popup.level && popup.level > 0) || (popup as any).parentPopupId

                        // Child popups: show just badge + name (parent relationship shown by connecting line)
                        if (isChildPopup) {
                          const isRenaming = renamingTitle === popup.id
                          return (
                            <div className="flex items-center gap-1.5 min-w-0 group">
                              {colorTheme ? (
                                <div
                                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: colorTheme.bg }}
                                />
                              ) : (
                                <Folder className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                              )}
                              {isRenaming ? (
                                /* Inline rename input */
                                <div className="flex-1 min-w-0 flex flex-col gap-1">
                                  <input
                                    ref={renameTitleInputRef}
                                    type="text"
                                    value={renamingTitleName}
                                    onChange={(e) => setRenamingTitleName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        handleSaveRenameTitle()
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault()
                                        handleCancelRenameTitle()
                                      }
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    className="px-1.5 py-0.5 text-sm bg-gray-700 border border-blue-500 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    disabled={renameLoading}
                                  />
                                  {renameError && (
                                    <span className="text-xs text-red-400">{renameError}</span>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <span className="text-sm font-medium text-white truncate">{folderName}</span>
                                  {/* Hover pencil icon for quick rename */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleStartRenameTitle(popup.id, folderName)
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-gray-700 rounded pointer-events-auto flex-shrink-0"
                                    aria-label="Rename folder"
                                  >
                                    <Pencil className="w-3 h-3 text-gray-400" />
                                  </button>
                                </>
                              )}
                            </div>
                          )
                        }

                        // Root popups: show full breadcrumb
                        const breadcrumbs = parseBreadcrumb(folderPath, folderName)
                        return (
                          <>
                            {/* Home icon */}
                            <Home className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />

                            {/* Breadcrumb trail */}
                            {breadcrumbs.map((crumb, index) => (
                              <React.Fragment key={index}>
                                {index > 0 && <ChevronRight className="w-3 h-3 text-gray-500 flex-shrink-0" />}

                                {index === breadcrumbs.length - 1 ? (
                                  // Last item: show color badge + name (or inline rename input)
                                  (() => {
                                    const isRenaming = renamingTitle === popup.id
                                    return (
                                      <div className="flex items-center gap-1.5 min-w-0 group">
                                        {colorTheme ? (
                                          <div
                                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: colorTheme.bg }}
                                          />
                                        ) : (
                                          <Folder className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                        )}
                                        {isRenaming ? (
                                          /* Inline rename input */
                                          <div className="flex-1 min-w-0 flex flex-col gap-1">
                                            <input
                                              ref={renameTitleInputRef}
                                              type="text"
                                              value={renamingTitleName}
                                              onChange={(e) => setRenamingTitleName(e.target.value)}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  e.preventDefault()
                                                  handleSaveRenameTitle()
                                                } else if (e.key === 'Escape') {
                                                  e.preventDefault()
                                                  handleCancelRenameTitle()
                                                }
                                              }}
                                              onMouseDown={(e) => e.stopPropagation()}
                                              onClick={(e) => e.stopPropagation()}
                                              className="px-1.5 py-0.5 text-sm bg-gray-700 border border-blue-500 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                              disabled={renameLoading}
                                            />
                                            {renameError && (
                                              <span className="text-xs text-red-400">{renameError}</span>
                                            )}
                                          </div>
                                        ) : (
                                          <>
                                            <span className="text-sm font-medium text-white truncate">{crumb}</span>
                                            {/* Hover pencil icon for quick rename */}
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                handleStartRenameTitle(popup.id, crumb)
                                              }}
                                              onMouseDown={(e) => e.stopPropagation()}
                                              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-gray-700 rounded pointer-events-auto flex-shrink-0"
                                              aria-label="Rename folder"
                                            >
                                              <Pencil className="w-3 h-3 text-gray-400" />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    )
                                  })()
                                ) : breadcrumbs.length > 2 && index === 0 ? (
                                  // Collapse earlier levels only if more than 2 levels
                                  <span className="text-xs text-gray-500 flex-shrink-0">...</span>
                                ) : index >= breadcrumbs.length - 2 ? (
                                  // Show parent level(s)
                                  <span className="text-xs text-gray-400 flex-shrink-0">{crumb}</span>
                                ) : null}
                              </React.Fragment>
                            ))}
                          </>
                        )
                      })()}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {/* Edit/Done toggle button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleToggleEditMode(popup.id)
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="px-2 py-0.5 text-xs font-medium rounded transition-colors pointer-events-auto"
                        style={{
                          backgroundColor: popupEditMode.get(popup.id) ? '#3b82f6' : 'transparent',
                          color: popupEditMode.get(popup.id) ? '#fff' : '#9ca3af',
                          border: `1px solid ${popupEditMode.get(popup.id) ? '#3b82f6' : '#4b5563'}`
                        }}
                        aria-label={popupEditMode.get(popup.id) ? "Exit edit mode" : "Enter edit mode"}
                      >
                        {popupEditMode.get(popup.id) ? 'Done' : 'Edit'}
                      </button>
                      {/* Close button or Close mode controls */}
                      {popup.closeMode === 'closing' ? (
                        <>
                          {/* Done button (confirm close) */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onConfirmClose?.(popup.id)
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="px-2 py-0.5 text-xs font-medium rounded transition-colors pointer-events-auto bg-green-600 hover:bg-green-500 text-white"
                            aria-label="Confirm close"
                          >
                            ✓ Done
                          </button>
                          {/* Cancel button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onCancelClose?.(popup.id)
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="px-2 py-0.5 text-xs font-medium rounded transition-colors pointer-events-auto hover:bg-gray-700 text-gray-400"
                            aria-label="Cancel close"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onInitiateClose?.(popup.id)
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="p-0.5 hover:bg-gray-700 rounded pointer-events-auto"
                          aria-label="Close popup"
                        >
                          <X className="w-4 h-4 text-gray-400" />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Popup Content */}
                  <div className="overflow-y-auto flex-1" style={{
                    contain: 'content',
                    contentVisibility: 'auto' as const,
                    paddingBottom: '40px',
                    minHeight: 0  // Required for flex child to scroll properly
                  }}>
                    {popup.isLoading ? (
                      <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
                    ) : popup.folder?.children && popup.folder.children.length > 0 ? (
                      popup.folder.children.length > 200 ? (
                    <VirtualList
                      items={popup.folder.children}
                      itemHeight={36}
                      height={300}
                      overscan={8}
                      renderItem={(child: PopupChildNode) =>
                        renderChildRow(child, popup.folder?.children ?? [])
                      }
                    />
                  ) : (
                    <div className="py-1">
                      {(popup.folder.children ?? []).map((child: PopupChildNode) =>
                        renderChildRow(child, popup.folder?.children ?? [])
                      )}
                    </div>
                  )
                    ) : (
                      <div className="p-4 text-center text-gray-500 text-sm">Empty folder</div>
                    )}
                  </div>
                  <PopupCardFooter
                    popup={popup}
                    isEditMode={Boolean(popupEditMode.get(popup.id))}
                    hasClosingAncestor={hasClosingPopup}
                    popupSelections={popupSelections}
                    onDeleteSelected={handleDeleteSelected}
                    onClearSelection={handleClearSelection}
                    creatingFolderInPopup={creatingFolderInPopup}
                    newFolderName={newFolderName}
                    onChangeNewFolderName={setNewFolderName}
                    onCancelCreateFolder={handleCancelCreateFolder}
                    onSubmitCreateFolder={handleCreateFolder}
                    onStartCreateFolder={handleStartCreateFolder}
                    folderCreationLoading={folderCreationLoading}
                    folderCreationError={folderCreationError}
                    onTogglePin={onTogglePin}
                  />
              {/* Popup Footer - also droppable for easy access */}
                  <div
                    className="px-3 py-1.5 border-t border-gray-700 text-xs text-gray-500 cursor-pointer"
                    onDragOver={(e) => {
                      const folderId = (popup as any).folderId;
                      if (folderId && draggedItems.size > 0) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setIsPopupDropTarget(popup.id);
                      }
                    }}
                    onDrop={(e) => {
                      const folderId = (popup as any).folderId;
                      folderId && handlePopupDrop(folderId, popup.id, e);
                    }}
                  >
                    Level {popup.level} • {popup.folder?.children?.length || 0} items
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
      return (
        <>
          {createPortal(fallbackOverlay, document.body)}
          {overlayMinimapPortal}
          {tooltipPortal}
          {breadcrumbFolderPopupPortal}
        </>
      );
    }
  }

  // Even if overlay is not rendered, show tooltip if active
  return (
    <>
      {overlayMinimapPortal}
      {tooltipPortal}
      {breadcrumbFolderPopupPortal}
    </>
  ) || null;
};

// Export for use in other components
export default PopupOverlay;
