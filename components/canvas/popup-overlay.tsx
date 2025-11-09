'use client';

import React, { useEffect, useRef, useMemo, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { CoordinateBridge } from '@/lib/utils/coordinate-bridge';
import { ConnectionLineAdapter } from '@/lib/rendering/connection-line-adapter';
import { Z_INDEX, getPopupZIndex } from '@/lib/constants/z-index';
import { useLayer } from '@/components/canvas/layer-provider';
import { OverlayMinimap } from '@/components/canvas/overlay-minimap';
import { X, Folder, FileText, Eye } from 'lucide-react';
import { VirtualList } from '@/components/canvas/VirtualList';
import { debugLog as baseDebugLog, isDebugEnabled } from '@/lib/utils/debug-logger';
import { getUIResourceManager } from '@/lib/ui/resource-manager';
import '@/styles/popup-overlay.css';
import { ensureFloatingOverlayHost, FLOATING_OVERLAY_HOST_ID } from '@/lib/utils/overlay-host';
import { PreviewPopover } from '@/components/shared/preview-popover';
import {
  FOLDER_PREVIEW_DELAY_MS,
  HOVER_HIGHLIGHT_DURATION_MS,
} from '@/lib/constants/ui-timings';
import {
  DEFAULT_POPUP_HEIGHT,
  DEFAULT_POPUP_WIDTH,
  IDENTITY_TRANSFORM,
  MAX_POPUP_HEIGHT,
  MAX_POPUP_WIDTH,
  MIN_POPUP_HEIGHT,
  MIN_POPUP_WIDTH,
} from './popup-overlay/constants';
import { getFolderColorTheme, parseBreadcrumb, isFolderNode, isNoteLikeNode } from './popup-overlay/helpers';
import { withWorkspaceHeaders, withWorkspacePayload } from '@/lib/workspaces/client-utils';
import { createPopupChildRowRenderer, type PopupChildRowOptions } from './popup-overlay/renderPopupChildRow';
import { PopupCardHeader } from './popup-overlay/components/PopupCardHeader';
import { PopupCardFooter } from './popup-overlay/components/PopupCardFooter';
import { useBreadcrumbs } from './popup-overlay/hooks/useBreadcrumbs';
import { useOverlayPanState } from './popup-overlay/hooks/useOverlayPanState';
import { usePopupSelectionAndDrag } from './popup-overlay/hooks/usePopupSelectionAndDrag';
import { usePopupMeasurements } from './popup-overlay/hooks/usePopupMeasurements';
import type { PreviewChildEntry, PreviewEntry, PreviewStatus, PopupChildNode, PopupData } from './popup-overlay/types';
export type { PreviewChildEntry, PreviewEntry, PreviewStatus, PopupChildNode, PopupData };

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
  workspaceId?: string | null; // legacy alias retained for compatibility
  knowledgeBaseWorkspaceId?: string | null;
  activeMoveCascadeParentId?: string | null;
  moveCascadeChildIds?: string[];
  onToggleMoveCascade?: (popupId: string) => void;
}

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
  knowledgeBaseWorkspaceId = null,
  activeMoveCascadeParentId = null,
  moveCascadeChildIds = [],
  onToggleMoveCascade,
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

  const fetchWithKnowledgeBase = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const requestInit = withWorkspaceHeaders(init, knowledgeBaseWorkspaceId);
      return fetch(input, requestInit);
    },
    [knowledgeBaseWorkspaceId]
  );
  const {
    previewState,
    requestPreview,
    popupSelections,
    handleItemSelect,
    handleClearSelection,
    handleDeleteSelected,
    setSelectionForPopup,
    setLastSelectedIdForPopup,
    hoverHighlightedPopup,
    setHoverHighlightedPopup,
    hoverHighlightTimeoutRef,
    draggedItems,
    dropTargetId,
    invalidDropTargetId,
    isPopupDropTarget,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDragEnd,
    handleDrop,
    handlePopupDragOver,
    handlePopupDragLeave,
    handlePopupDrop,
    activePreviewTooltip,
    handlePreviewTooltipHover,
    handlePreviewTooltipLeave,
    handlePreviewTooltipEnter,
    handlePreviewTooltipMouseLeave,
    dismissPreviewTooltip,
  } = usePopupSelectionAndDrag({
    popups,
    onBulkMove,
    onDeleteSelected,
    fetchWithKnowledgeBase,
    debugLog,
    debugLoggingEnabled,
  });

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

        void debugLog({
          component: 'PopupOverlay',
          action: 'note_renamed_event_received',
          metadata: { noteId, newTitle },
        });

        if (onFolderRenamedRef.current) {
          onFolderRenamedRef.current(noteId, newTitle);
          void debugLog({
            component: 'PopupOverlay',
            action: 'delegated_rename_to_parent',
            metadata: { noteId },
          });
        } else {
          console.warn('[PopupOverlay] No parent callback available for rename');
        }
      } catch (error) {
        console.error('[PopupOverlay] Error handling note rename event:', error);
      }
    };

    window.addEventListener('note-renamed', handleNoteRenamed);
    return () => {
      window.removeEventListener('note-renamed', handleNoteRenamed);
    };
  }, []);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = ensureFloatingOverlayHost();
    if (host) {
      setOverlayContainer(host);
    }
  }, []);

  // Create folder state
  const [creatingFolderInPopup, setCreatingFolderInPopup] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [folderCreationLoading, setFolderCreationLoading] = useState<string | null>(null);
  const [folderCreationError, setFolderCreationError] = useState<string | null>(null);

  // Inline rename state
  const [popupEditMode, setPopupEditMode] = useState<Map<string, boolean>>(new Map());
  const [renamingTitle, setRenamingTitle] = useState<string | null>(null);
  const [renamingTitleName, setRenamingTitleName] = useState('');
  const [renamingListFolder, setRenamingListFolder] = useState<{ popupId: string; folderId: string } | null>(null);
  const [renamingListFolderName, setRenamingListFolderName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const renameTitleInputRef = useRef<HTMLInputElement | null>(null);
  const renameListInputRef = useRef<HTMLInputElement | null>(null);

  const {
    breadcrumbDropdownOpen,
    ancestorCache,
    loadingAncestors,
    breadcrumbFolderPreview,
    handleToggleBreadcrumbDropdown,
    handleBreadcrumbFolderHover,
    handleBreadcrumbFolderHoverLeave,
    handleBreadcrumbPreviewHover,
  } = useBreadcrumbs({
    fetchWithKnowledgeBase,
    debugLog,
    folderPreviewDelayMs: FOLDER_PREVIEW_DELAY_MS,
  });

  const handleCreateFolder = useCallback(
    async (popupId: string, parentFolderId: string) => {
      if (!newFolderName.trim()) {
        setFolderCreationError('Folder name is required');
        return;
      }

      const trimmedName = newFolderName.trim();

      const popup = popups.get(popupId);
      if (!popup?.folder) {
        setFolderCreationError('Unable to find folder');
        return;
      }

      setFolderCreationLoading(popupId);
      setFolderCreationError(null);

      try {
        const response = await fetchWithKnowledgeBase('/api/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            withWorkspacePayload(
              {
                type: 'folder',
                name: trimmedName,
                parentId: parentFolderId,
              },
              knowledgeBaseWorkspaceId
            )
          ),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to create folder: ${response.status}`);
        }

        const data = await response.json();

        setNewFolderName('');
        setCreatingFolderInPopup(null);
        setFolderCreationError(null);

        if (onFolderCreated && data.item) {
          const newFolder: PopupChildNode = {
            id: data.item.id,
            type: data.item.type || 'folder',
            name: data.item.name || trimmedName,
            parentId: parentFolderId,
            hasChildren: false,
          };
          onFolderCreated(popupId, newFolder);

          setSelectionForPopup(popupId, [data.item.id]);
          setLastSelectedIdForPopup(popupId, data.item.id);
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
    },
    [debugLog, fetchWithKnowledgeBase, knowledgeBaseWorkspaceId, newFolderName, onFolderCreated, popups, setLastSelectedIdForPopup, setSelectionForPopup]
  );

  const handleCancelCreateFolder = useCallback(() => {
    setCreatingFolderInPopup(null);
    setNewFolderName('');
    setFolderCreationError(null);
  }, []);

  const handleStartCreateFolder = useCallback((popupId: string) => {
    setCreatingFolderInPopup(popupId);
    setNewFolderName('');
    setFolderCreationError(null);
  }, []);

  // === Inline Rename Handlers ===

  const handleToggleEditMode = useCallback(
    (popupId: string) => {
      setPopupEditMode((prev) => {
        const newMap = new Map(prev);
        const wasInEditMode = prev.get(popupId);
        newMap.set(popupId, !wasInEditMode);

        if (wasInEditMode) {
          if (renamingTitle === popupId) {
            setRenamingTitle(null);
            setRenamingTitleName('');
            setRenameError(null);
          }

          if (renamingListFolder?.popupId === popupId) {
            setRenamingListFolder(null);
            setRenamingListFolderName('');
            setRenameError(null);
          }
        }

        return newMap;
      });
    },
    [renamingListFolder, renamingTitle]
  );

  const handleStartRenameTitle = useCallback((popupId: string, currentName: string) => {
    setRenamingTitle(popupId);
    setRenamingTitleName(currentName);
    setRenameError(null);
    setTimeout(() => renameTitleInputRef.current?.select(), 0);
  }, []);

  const handleSaveRenameTitle = useCallback(async () => {
    if (!renamingTitle) return;

    const trimmedName = renamingTitleName.trim();
    if (!trimmedName) {
      setRenameError('Folder name cannot be empty');
      return;
    }

    const popup = popups.get(renamingTitle);
    if (!popup?.folder) {
      setRenameError('Folder not found');
      return;
    }

    if (popup.folder.name === trimmedName) {
      handleCancelRenameTitle();
      return;
    }

    const parentId = popup.folder.parent_id;
    const siblings = Array.from(popups.values())
      .map((p) => p.folder)
      .filter((f) => f && f.parent_id === parentId);

    const duplicate = siblings.find(
      (f) => f && f.id !== popup.folder!.id && f.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (duplicate) {
      setRenameError('A folder with this name already exists');
      return;
    }

    setRenameLoading(true);
    setRenameError(null);

    try {
      const response = await fetchWithKnowledgeBase(`/api/items/${popup.folder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withWorkspacePayload(
            {
              name: trimmedName,
            },
            knowledgeBaseWorkspaceId
          )
        ),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to rename folder');
      }

      popup.folder.name = trimmedName;

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
  }, [fetchWithKnowledgeBase, knowledgeBaseWorkspaceId, onFolderRenamed, popups, renamingTitle, renamingTitleName]);

  const handleCancelRenameTitle = useCallback(() => {
    setRenamingTitle(null);
    setRenamingTitleName('');
    setRenameError(null);
  }, []);

  const handleStartRenameListFolder = useCallback((popupId: string, folderId: string, currentName: string) => {
    setRenamingListFolder({ popupId, folderId });
    setRenamingListFolderName(currentName);
    setRenameError(null);
    setTimeout(() => renameListInputRef.current?.select(), 0);
  }, []);

  const handleSaveRenameListFolder = useCallback(async () => {
    if (!renamingListFolder) return;

    const trimmedName = renamingListFolderName.trim();
    if (!trimmedName) {
      setRenameError('Folder name cannot be empty');
      return;
    }

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

    if (currentFolder.name === trimmedName) {
      handleCancelRenameListFolder();
      return;
    }

    const duplicate = popup.folder.children.find(
      (c: PopupChildNode) =>
        c.id !== renamingListFolder.folderId && c.name?.toLowerCase() === trimmedName.toLowerCase()
    );

    if (duplicate) {
      setRenameError('A folder with this name already exists');
      return;
    }

    setRenameLoading(true);
    setRenameError(null);

    try {
      const response = await fetchWithKnowledgeBase(`/api/items/${renamingListFolder.folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withWorkspacePayload(
            {
              name: trimmedName,
            },
            knowledgeBaseWorkspaceId
          )
        ),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to rename folder');
      }

      popup.folder.children = popup.folder.children.map((child: PopupChildNode) =>
        child.id === renamingListFolder.folderId ? { ...child, name: trimmedName } : child
      );

      if (onFolderRenamed) {
        onFolderRenamed(renamingListFolder.folderId, trimmedName);
      }

      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(
            new CustomEvent('note-renamed', {
              detail: { noteId: renamingListFolder.folderId, newTitle: trimmedName },
            })
          );
          void debugLog({
            component: 'PopupOverlay',
            action: 'emitted_note_renamed_event',
            metadata: {
              noteId: renamingListFolder.folderId,
              newTitle: trimmedName,
            },
          });
        } catch (dispatchError) {
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
  }, [debugLog, fetchWithKnowledgeBase, knowledgeBaseWorkspaceId, onFolderRenamed, popups, renamingListFolder, renamingListFolderName]);

  const handleCancelRenameListFolder = useCallback(() => {
    setRenamingListFolder(null);
    setRenamingListFolderName('');
    setRenameError(null);
  }, []);

  // selection, preview, and drag logic managed by usePopupSelectionAndDrag

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
  
  // Use LayerProvider to gate interactivity by active layer
  const layerCtx = useLayer();
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
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if the pointer event is on empty space (not on interactive elements)
  const isOverlayEmptySpace = useCallback((event: React.PointerEvent) => {
    const target = event.target as HTMLElement;
    const isOnPopup = !!target.closest('.popup-card');
    const isOnButton = !!target.closest('button');
    return !isOnPopup && !isOnButton;
  }, []);

  const {
    activeTransform,
    hasSharedCamera,
    isActiveLayer,
    isPanning,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    applyExternalTransform,
  } = useOverlayPanState({
    overlayRef,
    containerRef,
    sidebarRectRef,
    multiLayerEnabled,
    layerCtx,
    isLocked,
    popupsCount: popups.size,
    isOverlayEmptySpace,
    overlayFullSpanEnabled,
    tracePointerLog,
  });

  const shouldBlockMeasurements =
    isPanning || popups.size === 0 || draggingPopup !== null || isLocked;

  const {
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerEnd,
  } = usePopupMeasurements({
    popups,
    overlayRef,
    activeTransform,
    onPopupPositionChange,
    onResizePopup,
    shouldBlockMeasurements,
    isLocked,
  });

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

  // measurement, resize, and auto-height handling provided by usePopupMeasurements

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
  
  const cascadeChildCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    popups.forEach((popup) => {
      const parentId = (popup as any).parentPopupId ?? popup.parentId;
      if (!parentId) return;
      counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
    });
    return counts;
  }, [popups]);
  
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
        applyExternalTransform(nextTransform);
      }
    },
    [activeTransform, applyExternalTransform, hasSharedCamera, layerCtx, viewportSize]
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
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
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
          const cascadeChildCount = cascadeChildCountMap.get(popup.id) ?? 0;

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
                isMoveCascadeParent={popup.moveMode === 'parent'}
                cascadeChildCount={cascadeChildCount}
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
                onToggleMoveCascade={onToggleMoveCascade}
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
                isMoveCascadeChild={popup.moveMode === 'child'}
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
                  if (folderId) {
                    handlePopupDragOver(popup.id, folderId, e);
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
        dismissPreviewTooltip();
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
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
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
              const cascadeChildCount = cascadeChildCountMap.get(popup.id) ?? 0;
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
                  } ${(popup.isHighlighted || hoverHighlightedPopup === popup.id || popup.moveMode) ? 'highlighted' : ''}`}
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
                  <PopupCardHeader
                    popup={popup}
                    isEditMode={Boolean(popupEditMode.get(popup.id))}
                    isMoveCascadeParent={popup.moveMode === 'parent'}
                    cascadeChildCount={cascadeChildCount}
                    renamingTitleId={renamingTitle}
                    renamingTitleName={renamingTitleName}
                    renameTitleInputRef={renameTitleInputRef}
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
                    onToggleMoveCascade={onToggleMoveCascade}
                  />

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
                isMoveCascadeChild={popup.moveMode === 'child'}
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
                if (folderId) {
                  handlePopupDragOver(popup.id, folderId, e);
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
